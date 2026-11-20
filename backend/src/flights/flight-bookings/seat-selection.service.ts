import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { ownerFilter } from '../../common/auth/ownership';
import { BookingStatus } from '../../common/bookings/booking-status';
import { SelectSeatsDto } from './dto/seat-selection.dto';
import {
  FlightBooking,
  FlightBookingDocument,
} from '../schemas/flight-booking.schema';
import { Flight, FlightDocument } from '../schemas/flight.schema';
import {
  FlightSeatClaim,
  FlightSeatClaimDocument,
} from '../schemas/flight-seat-claim.schema';

const DUPLICATE_KEY = 11000;

const SEAT_LETTERS = 'ABCDEF';

/** A seat label ("12A") to its zero-based position in the cabin. */
export function seatIndex(seat: string): number {
  const match = /^([1-9]\d*)([A-F])$/.exec(seat);
  if (!match) {
    throw new BadRequestException({
      code: 'INVALID_SEAT',
      message: 'seatNumber must look like 12A',
    });
  }
  return (Number(match[1]) - 1) * 6 + SEAT_LETTERS.indexOf(match[2]);
}

@Injectable()
export class SeatSelectionService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBookingDocument>,
    @InjectModel(Flight.name)
    private readonly flightModel: Model<FlightDocument>,
    @InjectModel(FlightSeatClaim.name)
    private readonly claimModel: Model<FlightSeatClaimDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** FLT-28: choose seats on one segment of your own CONFIRMED booking. */
  async select(
    user: AuthenticatedUser,
    bookingId: string,
    dto: SelectSeatsDto,
  ) {
    if (!Types.ObjectId.isValid(bookingId)) {
      throw new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'Booking not found' });
    }
    const booking = await this.bookingModel
      .findOne({ _id: bookingId, ...ownerFilter(user) })
      .exec();
    if (!booking) {
      throw new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'Booking not found' });
    }
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException({
        code: 'BOOKING_NOT_CONFIRMED',
        message: 'Only a Confirmed booking can have seats selected',
      });
    }

    const index = dto.segmentIndex ?? 0;
    const segment = booking.segments[index];
    if (!segment) {
      throw new NotFoundException({ code: 'SEGMENT_NOT_FOUND', message: 'Segment not found' });
    }

    const flight = await this.flightModel.findById(segment.flightId).exec();
    if (!flight) {
      throw new NotFoundException({ code: 'FLIGHT_NOT_FOUND', message: 'Flight not found' });
    }
    const cabin = flight.cabinInventory.find(
      (c) => c.category === segment.cabinCategory,
    );
    if (!cabin) {
      throw new BadRequestException({
        code: 'CABIN_NOT_FOUND',
        message: 'The booking cabin no longer exists on this flight',
      });
    }

    const requested = dto.assignments;
    const seatPositions = requested.map((a) => seatIndex(a.seatNumber));
    if (seatPositions.some((position) => position >= cabin.totalSeats)) {
      throw new BadRequestException({
        code: 'SEAT_OUT_OF_RANGE',
        message: 'A chosen seat is outside this cabin',
      });
    }
    if (new Set(seatPositions).size !== seatPositions.length) {
      throw new ConflictException({
        code: 'SEAT_ALREADY_TAKEN',
        message: 'Two passengers cannot take the same seat',
      });
    }

    const passengerIds = new Set(
      booking.passengers
        .filter((p) => p.seatRequired)
        .map((p) => p._id.toString()),
    );
    if (requested.some((a) => !passengerIds.has(a.passengerId))) {
      throw new BadRequestException({
        code: 'INVALID_PASSENGER',
        message: 'A passenger does not need or does not belong to this booking',
      });
    }
    if (new Set(requested.map((a) => a.passengerId)).size !== requested.length) {
      throw new BadRequestException({
        code: 'DUPLICATE_PASSENGER',
        message: 'A passenger can hold only one seat',
      });
    }

    if (segment.departureAtUtc.getTime() <= Date.now()) {
      throw new ConflictException({
        code: 'SEGMENT_ALREADY_DEPARTED',
        message: 'Seats cannot be chosen after departure',
      });
    }

    const assignments = requested.map((a) => ({
      passengerId: new Types.ObjectId(a.passengerId),
      seatNumber: a.seatNumber.toUpperCase(),
    }));

    // One transaction: this booking's old claims on the segment go, the new
    // ones are inserted, and the booking is saved. The unique index decides a
    // race; a duplicate key aborts everything and nothing changes.
    try {
      await this.connection.transaction(async (session) => {
        await this.claimModel
          .deleteMany({ bookingId: booking._id, flightId: segment.flightId }, { session })
          .exec();
        for (const a of assignments) {
          await this.releaseIfStale(
            segment.flightId,
            segment.cabinCategory,
            a.seatNumber,
            booking._id,
            session,
          );
        }
        await this.claimModel.insertMany(
          assignments.map((a) => ({
            flightId: segment.flightId,
            cabinCategory: segment.cabinCategory,
            seatNumber: a.seatNumber,
            bookingId: booking._id,
            passengerId: a.passengerId,
          })),
          { session },
        );
        segment.seatAssignments = assignments;
        await booking.save({ session });
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException({
          code: 'SEAT_ALREADY_TAKEN',
          message: 'One of the chosen seats is already taken',
        });
      }
      throw error;
    }
    return {
      bookingId: String(booking._id),
      segmentIndex: index,
      flightId: String(segment.flightId),
      seats: assignments.map((s) => ({
        passengerId: String(s.passengerId),
        seatNumber: s.seatNumber,
      })),
    };
  }

  /**
   * A claim held by another booking blocks the seat only while that booking
   * is CONFIRMED and still has this seat on this flight (a cancelled or
   * changed booking leaves its claim behind). A stale claim is removed.
   */
  private async releaseIfStale(
    flightId: Types.ObjectId,
    cabinCategory: string,
    seatNumber: string,
    bookingId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    const claim = await this.claimModel
      .findOne({ flightId, cabinCategory, seatNumber }, null, { session })
      .exec();
    if (!claim || claim.bookingId.equals(bookingId)) return;
    const holder = await this.bookingModel
      .exists({
        _id: claim.bookingId,
        status: BookingStatus.CONFIRMED,
        segments: {
          $elemMatch: {
            flightId,
            cabinCategory,
            'seatAssignments.seatNumber': seatNumber,
          },
        },
      })
      .session(session)
      .exec();
    if (holder) {
      throw new ConflictException({
        code: 'SEAT_ALREADY_TAKEN',
        message: 'One of the chosen seats is already taken',
      });
    }
    await this.claimModel.deleteOne({ _id: claim._id }, { session }).exec();
  }
}

function isDuplicateKey(error: unknown): boolean {
  const e = error as { code?: number; writeErrors?: { code?: number }[] } | null;
  return (
    e?.code === DUPLICATE_KEY ||
    (Array.isArray(e?.writeErrors) && e.writeErrors.some((w) => w.code === DUPLICATE_KEY))
  );
}

