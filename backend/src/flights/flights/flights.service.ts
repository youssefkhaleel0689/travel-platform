import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { ReferenceDataService } from '../../common/reference-data/reference-data.service';
import {
  toAirportLocalDateKey,
  toUtcFromAirportLocal,
} from '../../common/time/airport-time';
import { AirlineModeratorAssignment } from '../schemas/airline-moderator-assignment.schema';
import { Flight, FlightStatus } from '../schemas/flight.schema';
import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightDto } from './dto/flight.dto';
import { toFlightDto } from './flight.mapper';

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
    private readonly referenceData: ReferenceDataService,
  ) {}

  /**
   * FLT-03: an airline moderator creates a SCHEDULED flight for their own airline.
   * Date-times are entered in each airport's local time and stored in UTC. Rejects
   * identical airports, an unknown airport, an arrival not after the departure (compared
   * in UTC), a departure in the past, and a duplicate airline + flight number + departure
   * date. Cabins are added later (FLT-04).
   */
  async create(
    dto: CreateFlightDto,
    actor: AuthenticatedUser,
  ): Promise<FlightDto> {
    const airlineId = await this.assignedAirlineId(actor);

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

  // The airline the moderator is assigned to. No assignment document means 403: a
  // moderator without an airline manages nothing.
  private async assignedAirlineId(
    actor: AuthenticatedUser,
  ): Promise<Flight['airlineId']> {
    const assignment = await this.assignmentModel
      .findOne({ moderatorId: new Types.ObjectId(actor.userId) })
      .lean<AirlineModeratorAssignment>()
      .exec();
    if (!assignment) {
      throw new ForbiddenException({
        code: 'NO_AIRLINE_ASSIGNED',
        message: 'You are not assigned to an airline',
      });
    }
    return assignment.airlineId;
  }
}
