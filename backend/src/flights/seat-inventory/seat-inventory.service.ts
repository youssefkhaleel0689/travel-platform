import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model, Types } from 'mongoose';
import { CabinCategory, Flight, FlightStatus } from '../schemas/flight.schema';

/** A number of seats in one cabin of one flight (FLT-22). */
export interface SeatChange {
  flightId: Types.ObjectId;
  category: CabinCategory;
  // Adults + children. Infants take no seat, so they are never counted here.
  seats: number;
}

// The two counters that releases and conversions move seats between.
type Counter = 'heldSeats' | 'bookedSeats';

// A wrong count is a bug in the caller, not bad user input: the DTOs validate passengers.
function assertSeats(seats: number): void {
  if (!Number.isInteger(seats) || seats < 1) {
    throw new Error(`seats must be a whole number >= 1, got ${seats}`);
  }
}

// The only code that writes bookedSeats and heldSeats (flight schema comment, FLT-22).
// Every method is one atomic update whose filter contains the safety condition, so two
// concurrent requests can never both pass it. `session` lets a caller run the update
// inside its transaction together with the booking status change.
@Injectable()
export class SeatInventoryService {
  constructor(
    @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
  ) {}

  /**
   * Holds seats for a new PENDING_PAYMENT booking (FLT-22). Succeeds only on a SCHEDULED
   * flight that has not departed and only while bookedSeats + heldSeats + seats <= totalSeats.
   */
  async hold(change: SeatChange, session?: ClientSession): Promise<void> {
    assertSeats(change.seats);
    const { flightId, category, seats } = change;
    const now = new Date();

    const result = await this.flightModel
      .updateOne(
        {
          _id: flightId,
          status: FlightStatus.SCHEDULED,
          departureAtUtc: { $gt: now },
          // Option A: true if the cabin of this category still has room for `seats`.
          $expr: {
            $anyElementTrue: [
              {
                $map: {
                  input: '$cabinInventory',
                  as: 'cabin',
                  in: {
                    $and: [
                      { $eq: ['$$cabin.category', category] },
                      {
                        $lte: [
                          {
                            $add: [
                              '$$cabin.bookedSeats',
                              '$$cabin.heldSeats',
                              seats,
                            ],
                          },
                          '$$cabin.totalSeats',
                        ],
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
        { $inc: { 'cabinInventory.$[cabin].heldSeats': seats } },
        { arrayFilters: [{ 'cabin.category': category }], session },
      )
      .exec();

    if (result.modifiedCount !== 1) {
      throw await this.holdFailure(change, now, session);
    }
  }

  /**
   * Gives held seats back: the hold expired, the payment failed or the flight was
   * cancelled (FLT-22, FLT-06). Works on any flight status.
   */
  releaseHeld(change: SeatChange, session?: ClientSession): Promise<void> {
    return this.moveSeats(change, 'heldSeats', null, session);
  }

  /** Turns held seats into booked seats after a verified payment (FLT-23). */
  convertHeldToBooked(
    change: SeatChange,
    session?: ClientSession,
  ): Promise<void> {
    return this.moveSeats(change, 'heldSeats', 'bookedSeats', session);
  }

  /**
   * Gives booked seats back when a confirmed booking is cancelled by the user (FLT-26)
   * or with its flight (FLT-06). Works on any flight status.
   */
  releaseBooked(change: SeatChange, session?: ClientSession): Promise<void> {
    return this.moveSeats(change, 'bookedSeats', null, session);
  }

  // One update that takes `seats` from the `from` counter (and adds them to `to`, if
  // given). It only matches while the cabin has at least `seats` in `from`, so no
  // counter can go below 0, and booked + held never grows.
  private async moveSeats(
    change: SeatChange,
    from: Counter,
    to: Counter | null,
    session?: ClientSession,
  ): Promise<void> {
    assertSeats(change.seats);
    const { flightId, category, seats } = change;

    const inc: Record<string, number> = {
      [`cabinInventory.$.${from}`]: -seats,
    };
    if (to) {
      inc[`cabinInventory.$.${to}`] = seats;
    }

    const result = await this.flightModel
      .updateOne(
        {
          _id: flightId,
          cabinInventory: {
            $elemMatch: { category, [from]: { $gte: seats } },
          },
        },
        { $inc: inc },
        { session },
      )
      .exec();

    if (result.modifiedCount !== 1) {
      // The cabin has fewer seats in `from` than this booking accounts for: an update
      // ran twice or a count is wrong. That is our bug, so it is a 500 and it aborts
      // the caller's transaction.
      throw new Error(
        `Seat counters out of sync: cannot take ${seats} ${from} from ${category} on flight ${flightId.toString()}`,
      );
    }
  }

  // The update already decided atomically; this read only explains why it matched nothing.
  private async holdFailure(
    { flightId, category, seats }: SeatChange,
    now: Date,
    session?: ClientSession,
  ): Promise<HttpException> {
    const flight = await this.flightModel
      .findById(flightId, { status: 1, departureAtUtc: 1, cabinInventory: 1 })
      .session(session ?? null)
      .lean<Flight>()
      .exec();

    if (!flight) {
      return new NotFoundException({
        code: 'FLIGHT_NOT_FOUND',
        message: 'Flight not found',
      });
    }
    if (
      flight.status !== FlightStatus.SCHEDULED ||
      flight.departureAtUtc.getTime() <= now.getTime()
    ) {
      return new ConflictException({
        code: 'FLIGHT_NOT_BOOKABLE',
        message: 'This flight can no longer be booked',
      });
    }
    const cabin = flight.cabinInventory.find((c) => c.category === category);
    if (!cabin) {
      return new BadRequestException({
        code: 'CABIN_NOT_OFFERED',
        message: `This flight has no ${category} cabin`,
      });
    }
    const left = Math.max(
      cabin.totalSeats - cabin.bookedSeats - cabin.heldSeats,
      0,
    );
    let message: string;
    if (left >= seats) {
      // Seats were freed between the update and this read.
      message = `The ${category} seats changed while booking, please try again`;
    } else if (left === 0) {
      message = `No seats left in ${category}`;
    } else {
      message = `Only ${left} seat${left === 1 ? '' : 's'} left in ${category}`;
    }
    return new ConflictException({ code: 'SEAT_UNAVAILABLE', message });
  }
}
