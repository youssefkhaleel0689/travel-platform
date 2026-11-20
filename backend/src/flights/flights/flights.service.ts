import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { BookingStatus } from '../../common/bookings/booking-status';
import { ReferenceDataService } from '../../common/reference-data/reference-data.service';
import {
  toAirportLocalDateKey,
  toUtcFromAirportLocal,
} from '../../common/time/airport-time';
import {
  NotificationResourceType,
  NotificationType,
} from '../../notifications/notification-type.enum';
import { NotificationsService } from '../../notifications/notifications.service';
import { assertAirlineActive, assignedAirlineId } from '../airline-assignment';
import { AirlineModeratorAssignment } from '../schemas/airline-moderator-assignment.schema';
import { Airline } from '../schemas/airline.schema';
import { FlightBooking } from '../schemas/flight-booking.schema';
import { Flight, FlightStatus } from '../schemas/flight.schema';
import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightDto } from './dto/flight.dto';
import { UpdateFlightDto } from './dto/update-flight.dto';
import { toFlightDto } from './flight.mapper';

// A route id is 24 hex characters, the same check as the cabin service and ownership.ts.
const OBJECT_ID = /^[0-9a-f]{24}$/i;

// MongoDB error code of a violated unique index.
const DUPLICATE_KEY_ERROR = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY_ERROR
  );
}

function fieldError(
  code: string,
  field: string,
  message: string,
): BadRequestException {
  return new BadRequestException({
    code,
    message,
    errors: [{ field, messages: [message] }],
  });
}

// Flights of the airline (FLT-03). Every method that takes an actor first resolves the
// airline from airlineModeratorAssignment (ACC-11): the link lives only there, and the
// client never says which airline it acts for.
@Injectable()
export class FlightsService {
  constructor(
    @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
    @InjectModel(AirlineModeratorAssignment.name)
    private readonly assignmentModel: Model<AirlineModeratorAssignment>,
    @InjectModel(Airline.name) private readonly airlineModel: Model<Airline>,
    private readonly referenceData: ReferenceDataService,
    // FLT-05 looks up the CONFIRMED bookings of a flight to notify them, and moves the
    // flight times its open bookings copied when the times change. Every other write to
    // this collection belongs to the booking module.
    @InjectModel(FlightBooking.name)
    private readonly flightBookingModel: Model<FlightBooking>,
    private readonly notifications: NotificationsService,
    // FLT-05: a time change and the booking times that follow it commit together.
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * FLT-03: an airline moderator creates a SCHEDULED flight for their own airline.
   * Date-times are entered in each airport's local time and stored in UTC. Rejects
   * identical airports, an unknown airport, an arrival not after the departure (compared
   * in UTC), a departure in the past, and a duplicate airline + flight number + departure
   * date. A DEACTIVATED airline cannot add flights (ACC-15, team leader decision).
   * Cabins are added later (FLT-04).
   */
  async create(
    dto: CreateFlightDto,
    actor: AuthenticatedUser,
  ): Promise<FlightDto> {
    const airlineId = await this.assignedAirlineId(actor);
    await assertAirlineActive(
      this.airlineModel,
      airlineId,
      'Your airline is deactivated and cannot add flights',
    );

    if (dto.departureAirportId === dto.arrivalAirportId) {
      throw fieldError(
        'SAME_AIRPORTS',
        'arrivalAirportId',
        'arrivalAirportId must differ from departureAirportId',
      );
    }

    // FLT-02: only seeded airports are accepted. Their IANA time zone drives the UTC
    // conversion and the departure date.
    const departureAirport = await this.referenceData.getAirportOrThrow(
      dto.departureAirportId,
    );
    const arrivalAirport = await this.referenceData.getAirportOrThrow(
      dto.arrivalAirportId,
    );

    const departureAtUtc = toUtcFromAirportLocal(
      dto.departureLocalInput,
      departureAirport.timeZone,
      'departureLocalInput',
    );
    const arrivalAtUtc = toUtcFromAirportLocal(
      dto.arrivalLocalInput,
      arrivalAirport.timeZone,
      'arrivalLocalInput',
    );

    if (departureAtUtc.getTime() <= Date.now()) {
      throw fieldError(
        'DEPARTURE_IN_PAST',
        'departureLocalInput',
        'Departure must be in the future',
      );
    }
    // Compared in UTC, never as local clock readings.
    if (arrivalAtUtc.getTime() <= departureAtUtc.getTime()) {
      throw fieldError(
        'ARRIVAL_NOT_AFTER_DEPARTURE',
        'arrivalLocalInput',
        'Arrival must be after departure',
      );
    }

    try {
      const created = await this.flightModel.create({
        airlineId,
        flightNumber: dto.flightNumber,
        departureAirportId: dto.departureAirportId,
        arrivalAirportId: dto.arrivalAirportId,
        departureLocalInput: dto.departureLocalInput,
        arrivalLocalInput: dto.arrivalLocalInput,
        departureAtUtc,
        arrivalAtUtc,
        // The calendar date at the departure airport (helper from GEN-06, never by hand).
        departureDateKey: toAirportLocalDateKey(
          departureAtUtc,
          departureAirport.timeZone,
        ),
        status: FlightStatus.SCHEDULED,
        cabinInventory: [],
      });
      return toFlightDto(created.toObject());
    } catch (error) {
      // The unique index airlineId + flightNumber + departureDateKey is the real guard:
      // two parallel requests cannot both pass a check-then-insert.
      if (isDuplicateKeyError(error)) {
        throw new ConflictException({
          code: 'FLIGHT_ALREADY_EXISTS',
          message:
            'This airline already has a flight with this number on this departure date',
          errors: [
            {
              field: 'flightNumber',
              messages: ['already used on this departure date'],
            },
          ],
        });
      }
      throw error;
    }
  }

  /**
   * FLT-05: change the airports and the departure and arrival times of a SCHEDULED flight
   * of the moderator's airline. Cabin prices and seat counts are changed on the cabin
   * endpoint (FLT-04, FLT-05).
   *
   * Times are entered in each airport's local time and stored in UTC; departureDateKey is
   * recomputed with the GEN-06 helper. The airports can only change while no seat is
   * booked or held: that rule sits in the update's filter (the counters live on the flight
   * and only SeatInventoryService changes them), so a hold made at the same moment cannot
   * slip past it. Existing bookings keep their own snapshot (segments, price), so a change
   * never rewrites them. Any change of a time notifies the passengers with a CONFIRMED
   * booking (GEN-01).
   */
  async update(
    flightId: string,
    dto: UpdateFlightDto,
    actor: AuthenticatedUser,
  ): Promise<FlightDto> {
    const airlineId = await this.assignedAirlineId(actor);
    await assertAirlineActive(
      this.airlineModel,
      airlineId,
      'Your airline is deactivated and cannot change its flights',
    );
    if (!OBJECT_ID.test(flightId)) {
      throw this.flightNotFound();
    }
    if (
      dto.departureAirportId === undefined &&
      dto.arrivalAirportId === undefined &&
      dto.departureLocalInput === undefined &&
      dto.arrivalLocalInput === undefined
    ) {
      throw new BadRequestException({
        code: 'EMPTY_UPDATE',
        message:
          'Send at least one of departureAirportId, arrivalAirportId, departureLocalInput, arrivalLocalInput',
        errors: [
          {
            field: 'body',
            messages: [
              'send at least one of departureAirportId, arrivalAirportId, departureLocalInput, arrivalLocalInput',
            ],
          },
        ],
      });
    }

    const current = await this.flightModel
      .findOne({ _id: flightId, airlineId })
      .lean<Flight>()
      .exec();
    if (!current) {
      throw this.flightNotFound();
    }
    this.assertEditable(current);

    const departureAirportId =
      dto.departureAirportId ?? current.departureAirportId;
    const arrivalAirportId = dto.arrivalAirportId ?? current.arrivalAirportId;
    const departureAirportChanged =
      departureAirportId !== current.departureAirportId;
    const arrivalAirportChanged = arrivalAirportId !== current.arrivalAirportId;
    const airportsChanged = departureAirportChanged || arrivalAirportChanged;

    // The same clock reading means a different instant at another airport, so the
    // moderator has to say which time they mean.
    if (departureAirportChanged && dto.departureLocalInput === undefined) {
      throw fieldError(
        'LOCAL_TIME_REQUIRED',
        'departureLocalInput',
        'Send departureLocalInput when you change the departure airport',
      );
    }
    if (arrivalAirportChanged && dto.arrivalLocalInput === undefined) {
      throw fieldError(
        'LOCAL_TIME_REQUIRED',
        'arrivalLocalInput',
        'Send arrivalLocalInput when you change the arrival airport',
      );
    }
    if (departureAirportId === arrivalAirportId) {
      throw fieldError(
        'SAME_AIRPORTS',
        'arrivalAirportId',
        'arrivalAirportId must differ from departureAirportId',
      );
    }

    // FLT-02: only seeded airports are accepted.
    const departureAirport =
      await this.referenceData.getAirportOrThrow(departureAirportId);
    const arrivalAirport =
      await this.referenceData.getAirportOrThrow(arrivalAirportId);

    // A time that is not sent keeps the stored instant (no recomputation, no drift).
    const departureAtUtc =
      dto.departureLocalInput === undefined
        ? current.departureAtUtc
        : toUtcFromAirportLocal(
            dto.departureLocalInput,
            departureAirport.timeZone,
            'departureLocalInput',
          );
    const arrivalAtUtc =
      dto.arrivalLocalInput === undefined
        ? current.arrivalAtUtc
        : toUtcFromAirportLocal(
            dto.arrivalLocalInput,
            arrivalAirport.timeZone,
            'arrivalLocalInput',
          );

    if (departureAtUtc.getTime() <= Date.now()) {
      throw fieldError(
        'DEPARTURE_IN_PAST',
        'departureLocalInput',
        'Departure must be in the future',
      );
    }
    // Compared in UTC, never as local clock readings.
    if (arrivalAtUtc.getTime() <= departureAtUtc.getTime()) {
      throw fieldError(
        'ARRIVAL_NOT_AFTER_DEPARTURE',
        'arrivalLocalInput',
        'Arrival must be after departure',
      );
    }

    const departureChanged =
      departureAtUtc.getTime() !== current.departureAtUtc.getTime();
    const arrivalChanged =
      arrivalAtUtc.getTime() !== current.arrivalAtUtc.getTime();

    const changes: Partial<Flight> = {
      ...(departureAirportChanged && { departureAirportId }),
      ...(arrivalAirportChanged && { arrivalAirportId }),
      ...(dto.departureLocalInput !== undefined &&
        dto.departureLocalInput !== current.departureLocalInput && {
          departureLocalInput: dto.departureLocalInput,
        }),
      ...(dto.arrivalLocalInput !== undefined &&
        dto.arrivalLocalInput !== current.arrivalLocalInput && {
          arrivalLocalInput: dto.arrivalLocalInput,
        }),
      ...(departureChanged && { departureAtUtc }),
      ...(arrivalChanged && { arrivalAtUtc }),
      // The calendar date at the departure airport (helper from GEN-06, never by hand).
      ...((departureChanged || departureAirportChanged) && {
        departureDateKey: toAirportLocalDateKey(
          departureAtUtc,
          departureAirport.timeZone,
        ),
      }),
    };
    if (Object.keys(changes).length === 0) {
      // Nothing differs from what is stored: nothing to write and nobody to notify.
      return toFlightDto(current);
    }

    // ONE conditional update. The filter repeats what was read (so a parallel edit cannot
    // be overwritten) and, for an airport change, requires that no seat is booked or held.
    // A time change also moves the times the flight's open bookings copied, in the same
    // transaction: both change or neither does.
    let updated: Flight | null;
    try {
      updated = await this.connection.transaction(async (session) => {
        const flight = await this.flightModel
          .findOneAndUpdate(
            {
              _id: flightId,
              airlineId,
              status: FlightStatus.SCHEDULED,
              departureAtUtc: {
                $eq: current.departureAtUtc,
                $gt: new Date(Date.now()),
              },
              arrivalAtUtc: current.arrivalAtUtc,
              departureAirportId: current.departureAirportId,
              arrivalAirportId: current.arrivalAirportId,
              ...(airportsChanged && {
                cabinInventory: {
                  $not: {
                    $elemMatch: {
                      $or: [
                        { bookedSeats: { $gt: 0 } },
                        { heldSeats: { $gt: 0 } },
                      ],
                    },
                  },
                },
              }),
            },
            { $set: changes },
            { new: true, session },
          )
          .lean<Flight>()
          .exec();
        if (flight && (departureChanged || arrivalChanged)) {
          await this.moveBookingTimes(flight, session);
        }
        return flight;
      });
    } catch (error) {
      // The unique index airlineId + flightNumber + departureDateKey is the real guard:
      // moving the flight to a date this flight number already uses is a conflict.
      if (isDuplicateKeyError(error)) {
        throw new ConflictException({
          code: 'FLIGHT_ALREADY_EXISTS',
          message:
            'This airline already has a flight with this number on the new departure date',
          errors: [
            {
              field: 'departureLocalInput',
              messages: ['flight number already used on this departure date'],
            },
          ],
        });
      }
      throw error;
    }
    if (!updated) {
      throw await this.rejection(flightId, airlineId, airportsChanged);
    }

    if (departureChanged || arrivalChanged) {
      await this.notifyScheduleChange(updated);
    }
    return toFlightDto(updated);
  }

  // Only a SCHEDULED flight that has not departed can be edited (FLT-05, FLT-30). The
  // departure check matters until the DEPARTED job has moved a flight whose time passed.
  private assertEditable(
    flight: Pick<Flight, 'status' | 'departureAtUtc'>,
  ): void {
    if (flight.status !== FlightStatus.SCHEDULED) {
      throw new ConflictException({
        code: 'FLIGHT_NOT_SCHEDULED',
        message: `Only a SCHEDULED flight can be changed (this one is ${flight.status})`,
      });
    }
    if (flight.departureAtUtc.getTime() <= Date.now()) {
      throw new ConflictException({
        code: 'FLIGHT_ALREADY_DEPARTED',
        message:
          'This flight has already departed and can no longer be changed',
      });
    }
  }

  // Why the conditional update matched nothing. Read-only: the rules were already
  // enforced by the update's filter, this only explains the miss.
  private async rejection(
    flightId: string,
    airlineId: Types.ObjectId,
    airportsChanged: boolean,
  ): Promise<HttpException> {
    const flight = await this.flightModel
      .findOne({ _id: flightId, airlineId })
      .lean<Flight>()
      .exec();
    if (!flight) {
      return this.flightNotFound();
    }
    try {
      this.assertEditable(flight);
    } catch (error) {
      return error as HttpException;
    }
    const seatsInUse = flight.cabinInventory.some(
      (cabin) => cabin.bookedSeats > 0 || cabin.heldSeats > 0,
    );
    if (airportsChanged && seatsInUse) {
      return new ConflictException({
        code: 'AIRPORTS_LOCKED',
        message:
          'The airports cannot be changed once the flight has a booking or a seat hold',
      });
    }
    // The flight changed between the read and the update: ask the caller to retry.
    return new ConflictException({
      code: 'FLIGHT_CHANGED',
      message: 'The flight was changed at the same time, please try again',
    });
  }

  // FLT-05: price changes do not affect existing bookings, but time changes do. A booking
  // keeps a copy of its flight times (for the e-ticket, "My bookings", the cancellation
  // tier and completion), so the copies of every PENDING_PAYMENT and CONFIRMED booking on
  // this flight move with it. A round trip has two segments: arrayFilters changes only the
  // one on this flight. CANCELLED and EXPIRED bookings keep the times they ended with.
  private async moveBookingTimes(
    flight: Flight,
    session: ClientSession,
  ): Promise<void> {
    await this.flightBookingModel
      .updateMany(
        {
          'segments.flightId': flight._id,
          status: {
            $in: [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED],
          },
        },
        {
          $set: {
            'segments.$[segment].departureAtUtc': flight.departureAtUtc,
            'segments.$[segment].arrivalAtUtc': flight.arrivalAtUtc,
          },
        },
        { arrayFilters: [{ 'segment.flightId': flight._id }], session },
      )
      .exec();
  }

  // GEN-01: one in-app notice per CONFIRMED booking of the flight. The notification
  // service never throws, so a failed notice cannot undo the edit.
  private async notifyScheduleChange(flight: Flight): Promise<void> {
    const bookings = await this.flightBookingModel
      .find({
        'segments.flightId': flight._id,
        status: BookingStatus.CONFIRMED,
      })
      .select('_id userId')
      .lean<{ _id: Types.ObjectId; userId: Types.ObjectId }[]>()
      .exec();
    await this.notifications.notifyMany(
      bookings.map((booking) => ({
        userId: booking.userId,
        type: NotificationType.FLIGHT_SCHEDULE_CHANGED,
        title: `Flight ${flight.flightNumber} has a new schedule`,
        message:
          `Flight ${flight.flightNumber} now departs ${flight.departureAirportId} on ` +
          `${flight.departureLocalInput.replace('T', ' at ')} (local time) and arrives at ` +
          `${flight.arrivalAirportId} on ${flight.arrivalLocalInput.replace('T', ' at ')} (local time).`,
        resourceType: NotificationResourceType.FLIGHT_BOOKING,
        resourceId: booking._id.toString(),
      })),
    );
  }

  private flightNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'FLIGHT_NOT_FOUND',
      message: 'Flight not found',
    });
  }

  // The airline the moderator is assigned to (shared with the cabin service).
  private assignedAirlineId(
    actor: AuthenticatedUser,
  ): Promise<Flight['airlineId']> {
    return assignedAirlineId(this.assignmentModel, actor);
  }
}
