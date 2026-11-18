import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import {
  BookingStatus,
  BookingType,
} from '../../common/bookings/booking-status';
import { decimal128ToString, toDecimal128 } from '../../common/money/money';
import {
  NotificationResourceType,
  NotificationType,
} from '../../notifications/notification-type.enum';
import { NotificationsService } from '../../notifications/notifications.service';
import { CancelledBy } from '../../payments/refund-status.enum';
import { RefundsService } from '../../payments/refunds.service';
import { assertAirlineActive, assignedAirlineId } from '../airline-assignment';
import { toFlightDto } from '../flights/flight.mapper';
import { AirlineModeratorAssignment } from '../schemas/airline-moderator-assignment.schema';
import { Airline } from '../schemas/airline.schema';
import { FlightBooking, FlightSegment } from '../schemas/flight-booking.schema';
import { Flight, FlightStatus } from '../schemas/flight.schema';
import { SeatInventoryService } from '../seat-inventory/seat-inventory.service';
import type {
  CancelFlightDto,
  CancelledFlightResultDto,
} from './dto/cancel-flight.dto';

// A route id is 24 hex characters, the same check as the flight and cabin services.
const OBJECT_ID = /^[0-9a-f]{24}$/i;

type LeanBooking = FlightBooking & { _id: Types.ObjectId };
type LeanFlight = Flight & { _id: Types.ObjectId };

// The seats one segment holds, as SeatInventoryService takes them (infants take none).
function seatsOf(segment: FlightSegment) {
  return {
    flightId: segment.flightId,
    category: segment.cabinCategory,
    seats: segment.seatsRequired,
  };
}

interface Transition {
  flight: LeanFlight;
  cancelled: LeanBooking[];
  releasedHolds: number;
}

// FLT-06: the airline cancels one of its flights. In ONE transaction the flight becomes
// CANCELLED (so nothing can hold or book it any more), every CONFIRMED booking on it
// becomes CANCELLED (a round trip as a whole) and its booked seats go back, and every
// unpaid hold is released. After the commit every cancelled booking gets a full refund
// (PAY-03, always 100% for an airline cancellation) and its passenger a notice (GEN-01).
// A refund that fails never undoes the cancellation: PAY-03 keeps it on record to retry.
@Injectable()
export class FlightCancellationService {
  private readonly logger = new Logger(FlightCancellationService.name);

  constructor(
    @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
    @InjectModel(AirlineModeratorAssignment.name)
    private readonly assignmentModel: Model<AirlineModeratorAssignment>,
    @InjectModel(Airline.name) private readonly airlineModel: Model<Airline>,
    @InjectConnection() private readonly connection: Connection,
    private readonly seatInventory: SeatInventoryService,
    private readonly notifications: NotificationsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async cancel(
    flightId: string,
    dto: CancelFlightDto,
    actor: AuthenticatedUser,
  ): Promise<CancelledFlightResultDto> {
    const airlineId = await assignedAirlineId(this.assignmentModel, actor);
    await assertAirlineActive(
      this.airlineModel,
      airlineId,
      'Your airline is deactivated and cannot cancel flights',
    );
    if (!OBJECT_ID.test(flightId)) {
      throw this.notFound();
    }
    const id = new Types.ObjectId(flightId);
    const reason = dto.reason ?? null;
    const now = new Date();

    const transition = await this.connection.transaction(
      async (session): Promise<Transition | null> => {
        // The filter holds every rule: own airline, still SCHEDULED, not yet departed.
        const flight = await this.flightModel
          .findOneAndUpdate(
            {
              _id: id,
              airlineId,
              status: FlightStatus.SCHEDULED,
              departureAtUtc: { $gt: now },
            },
            { $set: { status: FlightStatus.CANCELLED } },
            { session, returnDocument: 'after' },
          )
          .lean<LeanFlight>()
          .exec();
        if (!flight) {
          return null;
        }

        const bookings = await this.bookingModel
          .find({
            'segments.flightId': id,
            status: {
              $in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT],
            },
          })
          .session(session)
          .sort({ _id: 1 })
          .lean<LeanBooking[]>()
          .exec();

        const cancelled: LeanBooking[] = [];
        let releasedHolds = 0;
        for (const booking of bookings) {
          if (booking.status === BookingStatus.CONFIRMED) {
            const updated = await this.cancelConfirmed(
              booking,
              actor,
              reason,
              now,
              session,
            );
            if (updated) {
              cancelled.push(updated);
            }
          } else if (await this.releaseHold(booking, now, session)) {
            releasedHolds += 1;
          }
        }
        return { flight, cancelled, releasedHolds };
      },
    );

    if (!transition) {
      throw await this.rejection(id, airlineId, now);
    }

    const { refundsRequested, refundsFailed } = await this.refundAll(
      transition.cancelled,
      reason,
    );
    await this.notifyAll(transition.flight, transition.cancelled, reason);

    // TODO(GEN-07): FLT-06 asks for an audit log entry through the shared audit service.
    // None exists in the codebase yet (D2), so this is only a log line until it does.
    this.logger.log(
      `AUDIT FLT-06: moderator ${actor.userId} cancelled flight ${transition.flight._id.toString()}: ` +
        `${transition.cancelled.length} bookings cancelled, ${transition.releasedHolds} holds released`,
    );

    return {
      flight: toFlightDto(transition.flight),
      cancelledBookings: transition.cancelled.length,
      releasedHolds: transition.releasedHolds,
      refundsRequested,
      refundsFailed,
    };
  }

  // CONFIRMED -> CANCELLED at 100%, and the booked seats of EVERY segment go back (a round
  // trip is one booking over two flights). The status filter makes it safe to meet a
  // booking that a user cancelled a moment ago: it is skipped.
  private async cancelConfirmed(
    booking: LeanBooking,
    actor: AuthenticatedUser,
    reason: string | null,
    now: Date,
    session: Parameters<SeatInventoryService['releaseBooked']>[1],
  ): Promise<LeanBooking | null> {
    const total = decimal128ToString(booking.priceSnapshot.total) ?? '0.00';
    const updated = await this.bookingModel
      .findOneAndUpdate(
        { _id: booking._id, status: BookingStatus.CONFIRMED },
        {
          $set: {
            status: BookingStatus.CANCELLED,
            cancelledAt: now,
            cancellation: {
              cancelledBy: new Types.ObjectId(actor.userId),
              reason,
              refundPercentage: 100,
              refundAmount: toDecimal128(total),
              refundId: null,
              cancelledAt: now,
              tiersSnapshot: [],
            },
          },
        },
        { session, returnDocument: 'after' },
      )
      .lean<LeanBooking>()
      .exec();
    if (!updated) {
      return null;
    }
    for (const segment of updated.segments) {
      await this.seatInventory.releaseBooked(seatsOf(segment), session);
    }
    return updated;
  }

  // PENDING_PAYMENT -> EXPIRED and the held seats of every segment go back: the same
  // change the hold-expiry job makes (FLT-22), done here so the flight is empty of holds
  // when it is cancelled.
  private async releaseHold(
    booking: LeanBooking,
    now: Date,
    session: Parameters<SeatInventoryService['releaseHeld']>[1],
  ): Promise<boolean> {
    const updated = await this.bookingModel
      .findOneAndUpdate(
        { _id: booking._id, status: BookingStatus.PENDING_PAYMENT },
        { $set: { status: BookingStatus.EXPIRED, expiredAt: now } },
        { session, returnDocument: 'after' },
      )
      .lean<LeanBooking>()
      .exec();
    if (!updated) {
      return false;
    }
    for (const segment of updated.segments) {
      await this.seatInventory.releaseHeld(seatsOf(segment), session);
    }
    return true;
  }

  // RefundsService is looked up when needed, not injected: payments reaches flights only
  // through FLIGHT_BOOKINGS_PORT, and injecting it would close a provider cycle (the same
  // reason the hotel adapter does it).
  private async refundAll(
    bookings: LeanBooking[],
    reason: string | null,
  ): Promise<{ refundsRequested: number; refundsFailed: number }> {
    let refundsRequested = 0;
    let refundsFailed = 0;
    if (bookings.length === 0) {
      return { refundsRequested, refundsFailed };
    }
    const refunds = this.moduleRef.get(RefundsService, { strict: false });
    for (const booking of bookings) {
      try {
        const refund = await refunds.issueForCancellation({
          bookingType: BookingType.FLIGHT,
          bookingId: booking._id.toString(),
          cancelledBy: CancelledBy.PROVIDER,
          refundPercentage: 100,
          reason: reason ?? 'Flight cancelled by the airline',
          policySnapshot: null,
        });
        if (refund) {
          refundsRequested += 1;
          await this.bookingModel
            .updateOne(
              { _id: booking._id },
              {
                $set: {
                  'cancellation.refundId': refund._id,
                  'cancellation.refundAmount': refund.amount,
                },
              },
            )
            .exec();
        }
      } catch (error) {
        refundsFailed += 1;
        this.logger.error(
          `Refund of flight booking ${booking._id.toString()} failed after the flight was cancelled`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return { refundsRequested, refundsFailed };
  }

  // GEN-01: one FLIGHT_CANCELLED notice per cancelled booking. notifyMany never throws.
  private async notifyAll(
    flight: LeanFlight,
    bookings: LeanBooking[],
    reason: string | null,
  ): Promise<void> {
    if (bookings.length === 0) {
      return;
    }
    const detail = reason ? ` Reason: ${reason}.` : '';
    await this.notifications.notifyMany(
      bookings.map((booking) => ({
        userId: booking.userId,
        type: NotificationType.FLIGHT_CANCELLED,
        title: 'Your flight was cancelled',
        message:
          `Flight ${flight.flightNumber} on ${flight.departureDateKey} ` +
          `(${flight.departureAirportId} to ${flight.arrivalAirportId}) was cancelled by the airline. ` +
          `Booking ${booking.bookingReference ?? ''} is cancelled and you will be refunded in full.${detail}`,
        resourceType: NotificationResourceType.FLIGHT_BOOKING,
        resourceId: booking._id.toString(),
      })),
    );
  }

  // The transition missed: say why with one read-only look at the flight.
  private async rejection(
    id: Types.ObjectId,
    airlineId: Types.ObjectId,
    now: Date,
  ): Promise<Error> {
    const current = await this.flightModel
      .findOne({ _id: id, airlineId })
      .select('status departureAtUtc')
      .lean<Pick<Flight, 'status' | 'departureAtUtc'>>()
      .exec();
    if (!current) {
      return this.notFound();
    }
    if (current.status === FlightStatus.CANCELLED) {
      return new ConflictException({
        code: 'FLIGHT_ALREADY_CANCELLED',
        message: 'This flight is already cancelled',
      });
    }
    if (
      current.status === FlightStatus.DEPARTED ||
      current.departureAtUtc.getTime() <= now.getTime()
    ) {
      return new ConflictException({
        code: 'FLIGHT_ALREADY_DEPARTED',
        message: 'This flight has already departed and cannot be cancelled',
      });
    }
    return new ConflictException({
      code: 'FLIGHT_CHANGED',
      message: 'The flight changed while it was being cancelled; try again',
    });
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'FLIGHT_NOT_FOUND',
      message: 'Flight not found',
    });
  }
}
