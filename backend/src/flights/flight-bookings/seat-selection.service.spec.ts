import { HttpException } from '@nestjs/common';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { Role } from '../../common/auth/auth.enums';
import { BookingStatus } from '../../common/bookings/booking-status';
import type { FlightBookingDocument } from '../schemas/flight-booking.schema';
import type { FlightSeatClaimDocument } from '../schemas/flight-seat-claim.schema';
import type { FlightDocument } from '../schemas/flight.schema';
import { CabinCategory } from '../schemas/flight.schema';
import { SeatSelectionService, seatIndex } from './seat-selection.service';

const USER: AuthenticatedUser = {
  userId: new Types.ObjectId().toString(),
  role: Role.USER,
  sessionId: new Types.ObjectId().toString(),
};
const FLIGHT_ID = new Types.ObjectId();
const PASSENGER_ID = new Types.ObjectId();
const OTHER_BOOKING = new Types.ObjectId();
const SESSION = {} as ClientSession;

function booking(inDays = 10, status = BookingStatus.CONFIRMED) {
  return {
    _id: new Types.ObjectId(),
    status,
    passengers: [{ _id: PASSENGER_ID, seatRequired: true }],
    segments: [
      {
        flightId: FLIGHT_ID,
        cabinCategory: CabinCategory.ECONOMY,
        departureAtUtc: new Date(Date.now() + inDays * 24 * 60 * 60 * 1000),
        seatAssignments: [] as unknown[],
      },
    ],
    save: jest.fn().mockResolvedValue(undefined),
  } as unknown as FlightBookingDocument & { save: jest.Mock };
}

function setup(
  doc: FlightBookingDocument,
  options: { existingClaim?: unknown; holderStillConfirmed?: boolean; insertError?: unknown } = {},
) {
  const exec = (value: unknown) => ({ exec: jest.fn().mockResolvedValue(value) });
  const bookingModel = {
    findOne: jest.fn().mockReturnValue(exec(doc)),
    exists: jest.fn().mockReturnValue({
      session: () => exec(options.holderStillConfirmed ? { _id: OTHER_BOOKING } : null),
    }),
  };
  const flightModel = {
    findById: jest.fn().mockReturnValue(
      exec({ cabinInventory: [{ category: CabinCategory.ECONOMY, totalSeats: 120 }] }),
    ),
  };
  const claimModel = {
    deleteMany: jest.fn().mockReturnValue(exec({})),
    deleteOne: jest.fn().mockReturnValue(exec({})),
    findOne: jest.fn().mockReturnValue(exec(options.existingClaim ?? null)),
    insertMany: options.insertError
      ? jest.fn().mockRejectedValue(options.insertError)
      : jest.fn().mockResolvedValue([]),
  };
  const connection = {
    transaction: jest.fn(async (fn: (s: ClientSession) => Promise<void>) => fn(SESSION)),
  };
  const service = new SeatSelectionService(
    bookingModel as unknown as Model<FlightBookingDocument>,
    flightModel as unknown as Model<FlightDocument>,
    claimModel as unknown as Model<FlightSeatClaimDocument>,
    connection as unknown as Connection,
  );
  return { service, claimModel };
}

const pick = (seatNumber: string) => ({
  assignments: [{ passengerId: PASSENGER_ID.toString(), seatNumber }],
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return ((error as HttpException).getResponse() as { code: string }).code;
  }
  throw new Error('expected an error');
}

describe('SeatSelectionService (FLT-28)', () => {
  it('maps seat labels to positions in the cabin', () => {
    expect(seatIndex('1A')).toBe(0);
    expect(seatIndex('2B')).toBe(7);
  });

  it('claims a free seat and saves it on the booking', async () => {
    const doc = booking();
    const { service, claimModel } = setup(doc);
    const result = await service.select(USER, doc._id.toString(), pick('12a'.toUpperCase()));
    expect(result.seats).toEqual([{ passengerId: PASSENGER_ID.toString(), seatNumber: '12A' }]);
    expect(claimModel.insertMany).toHaveBeenCalled();
    expect(doc.save).toHaveBeenCalledWith({ session: SESSION });
  });

  it('answers 409 when another confirmed booking holds the seat', async () => {
    const doc = booking();
    const { service } = setup(doc, {
      existingClaim: { _id: new Types.ObjectId(), bookingId: OTHER_BOOKING },
      holderStillConfirmed: true,
    });
    expect(await codeOf(service.select(USER, doc._id.toString(), pick('3C')))).toBe('SEAT_ALREADY_TAKEN');
  });

  it('takes over a seat whose holder was cancelled or changed', async () => {
    const doc = booking();
    const stale = { _id: new Types.ObjectId(), bookingId: OTHER_BOOKING };
    const { service, claimModel } = setup(doc, { existingClaim: stale, holderStillConfirmed: false });
    await service.select(USER, doc._id.toString(), pick('3C'));
    expect(claimModel.deleteOne).toHaveBeenCalledWith({ _id: stale._id }, { session: SESSION });
    expect(claimModel.insertMany).toHaveBeenCalled();
  });

  it('turns a lost race (duplicate key) into 409, not 500', async () => {
    const doc = booking();
    const { service } = setup(doc, { insertError: { code: 11000 } });
    expect(await codeOf(service.select(USER, doc._id.toString(), pick('3C')))).toBe('SEAT_ALREADY_TAKEN');
  });

  it('refuses seats after departure', async () => {
    const doc = booking(-1);
    const { service } = setup(doc);
    expect(await codeOf(service.select(USER, doc._id.toString(), pick('3C')))).toBe('SEGMENT_ALREADY_DEPARTED');
  });

  it('refuses a booking that is not confirmed', async () => {
    const doc = booking(10, BookingStatus.CANCELLED);
    const { service } = setup(doc);
    expect(await codeOf(service.select(USER, doc._id.toString(), pick('3C')))).toBe('BOOKING_NOT_CONFIRMED');
  });
});
