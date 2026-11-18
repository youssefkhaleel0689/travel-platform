import { HttpException, Logger } from '@nestjs/common';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import {
  BookingType,
  ProviderType,
} from '../../common/bookings/booking-status';
import { HoldReleaseReason } from '../../common/bookings/bookings.port';
import { BookingStatus, FlightBooking } from '../schemas/flight-booking.schema';
import { CabinCategory } from '../schemas/flight.schema';
import type { SeatInventoryService } from '../seat-inventory/seat-inventory.service';
import {
  FlightBookingsPortAdapter,
  newBookingReference,
} from './flight-bookings-port.adapter';

const NOW = new Date('2026-11-18T12:00:00.000Z');
const BOOKING_ID = new Types.ObjectId();
const USER_ID = new Types.ObjectId();
const AIRLINE_ID = new Types.ObjectId();
const OUTBOUND_ID = new Types.ObjectId();
const INBOUND_ID = new Types.ObjectId();
const PAYMENT_ID = new Types.ObjectId().toString();
const SESSION = { id: 'test-session' } as unknown as ClientSession;

// No 0, O, 1 or I: they are easy to misread on a ticket.
const REFERENCE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

// A round trip for two seated passengers, held until 12:10.
function booking(overrides: Partial<FlightBooking> = {}): FlightBooking {
  return {
    _id: BOOKING_ID,
    userId: USER_ID,
    status: BookingStatus.PENDING_PAYMENT,
    holdExpiresAt: new Date('2026-11-18T12:10:00.000Z'),
    segments: [
      {
        flightId: OUTBOUND_ID,
        cabinCategory: CabinCategory.ECONOMY,
        seatsRequired: 2,
      },
      {
        flightId: INBOUND_ID,
        cabinCategory: CabinCategory.BUSINESS,
        seatsRequired: 2,
      },
    ],
    priceSnapshot: {
      subtotal: Types.Decimal128.fromString('400.00'),
      baggageTotal: Types.Decimal128.fromString('20.00'),
      total: Types.Decimal128.fromString('420.00'),
      currency: 'USD',
    },
    policySnapshot: {
      airlineId: AIRLINE_ID,
      version: 3,
      extraBagPrice: Types.Decimal128.fromString('10.00'),
      maxExtraBagsPerPassenger: 2,
      cancellationTiers: [
        { daysBeforeDeparture: 7, refundPercentage: 80 },
        { daysBeforeDeparture: 0, refundPercentage: 0 },
      ],
    },
    ...overrides,
  } as FlightBooking;
}

// A query stand-in: session(), lean() and exec() resolve to the given result. Every
// session() call is recorded, to prove the read runs inside the transaction.
const sessions: unknown[] = [];
function query<R>(result: R) {
  const chain = {
    session: (session: unknown) => {
      sessions.push(session);
      return chain;
    },
    lean: () => chain,
    exec: () => Promise.resolve(result),
  };
  return chain;
}

function duplicateReference() {
  return Object.assign(new Error('E11000 duplicate key error'), {
    code: 11000,
    keyPattern: { bookingReference: 1 },
  });
}

function setup(found: FlightBooking | null = booking()) {
  const bookingModel = {
    findById: jest.fn(() => query(found)),
    updateOne: jest.fn(() => ({
      exec: () => Promise.resolve({ modifiedCount: 1 }),
    })),
    findOneAndUpdate: jest.fn(() => query<FlightBooking | null>(found)),
    exists: jest.fn(() => ({
      exec: () => Promise.resolve<{ _id: Types.ObjectId } | null>(null),
    })),
  };
  // Runs the callback once with the stand-in session, as a committed transaction would.
  const connection = {
    transaction: jest.fn((fn: (session: ClientSession) => Promise<unknown>) =>
      fn(SESSION),
    ),
  };
  const seatInventory = {
    convertHeldToBooked: jest.fn(() => Promise.resolve()),
    releaseHeld: jest.fn(() => Promise.resolve()),
  };
  sessions.length = 0;
  const adapter = new FlightBookingsPortAdapter(
    bookingModel as unknown as Model<FlightBooking>,
    connection as unknown as Connection,
    seatInventory as unknown as SeatInventoryService,
  );
  return { adapter, bookingModel, connection, seatInventory };
}

async function failure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('expected the call to fail');
}

describe('FlightBookingsPortAdapter (GEN-11, PAY-01)', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('findPayable', () => {
    it('gives payments the total, the hold and the airline', async () => {
      const { adapter } = setup();

      await expect(adapter.findPayable(BOOKING_ID.toString())).resolves.toEqual(
        {
          bookingId: BOOKING_ID.toString(),
          bookingType: BookingType.FLIGHT,
          userId: USER_ID.toString(),
          status: BookingStatus.PENDING_PAYMENT,
          totalAmount: '420.00',
          currency: 'USD',
          holdExpiresAt: new Date('2026-11-18T12:10:00.000Z'),
          bookingReference: null,
          providerType: ProviderType.AIRLINE,
          providerId: AIRLINE_ID.toString(),
        },
      );
    });

    it('has no hold expiry once the booking is confirmed', async () => {
      const { adapter } = setup(
        booking({
          status: BookingStatus.CONFIRMED,
          bookingReference: 'K7Q2PX',
        }),
      );

      const payable = await adapter.findPayable(BOOKING_ID.toString());

      expect(payable?.holdExpiresAt).toBeNull();
      expect(payable?.bookingReference).toBe('K7Q2PX');
    });

    it('is null for a booking that does not exist', async () => {
      const { adapter } = setup(null);

      await expect(
        adapter.findPayable(BOOKING_ID.toString()),
      ).resolves.toBeNull();
    });
  });

  describe('findPolicies (PAY-02)', () => {
    it('gives the terms the booking was made under, from its snapshot', async () => {
      const { adapter } = setup();

      await expect(
        adapter.findPolicies(BOOKING_ID.toString()),
      ).resolves.toEqual({
        bookingId: BOOKING_ID.toString(),
        bookingType: BookingType.FLIGHT,
        providerType: ProviderType.AIRLINE,
        providerId: AIRLINE_ID.toString(),
        policyVersion: 3,
        policySnapshot: {
          airlineId: AIRLINE_ID.toString(),
          version: 3,
          extraBagPrice: '10.00',
          maxExtraBagsPerPassenger: 2,
          cancellationTiers: [
            { daysBeforeDeparture: 7, refundPercentage: 80 },
            { daysBeforeDeparture: 0, refundPercentage: 0 },
          ],
        },
      });
    });

    it('is null for a booking that does not exist', async () => {
      const { adapter } = setup(null);

      await expect(
        adapter.findPolicies(BOOKING_ID.toString()),
      ).resolves.toBeNull();
    });
  });

  describe('confirmAfterPayment (FLT-23)', () => {
    it('confirms with a new reference and books the held seats, in one transaction', async () => {
      const { adapter, bookingModel, connection, seatInventory } = setup();

      const confirmation = await adapter.confirmAfterPayment(
        BOOKING_ID.toString(),
        PAYMENT_ID,
      );

      expect(confirmation).toEqual({
        bookingId: BOOKING_ID.toString(),
        status: BookingStatus.CONFIRMED,
        bookingReference: expect.stringMatching(REFERENCE) as string,
      });
      expect(connection.transaction).toHaveBeenCalledTimes(1);
      expect(sessions).toEqual([SESSION]);
      expect(bookingModel.updateOne).toHaveBeenCalledWith(
        { _id: BOOKING_ID, status: BookingStatus.PENDING_PAYMENT },
        {
          $set: {
            status: BookingStatus.CONFIRMED,
            confirmedAt: NOW,
            bookingReference: confirmation.bookingReference,
            paymentId: new Types.ObjectId(PAYMENT_ID),
          },
        },
        { session: SESSION },
      );
      expect(seatInventory.convertHeldToBooked.mock.calls).toEqual([
        [
          {
            flightId: OUTBOUND_ID,
            category: CabinCategory.ECONOMY,
            seats: 2,
          },
          SESSION,
        ],
        [
          {
            flightId: INBOUND_ID,
            category: CabinCategory.BUSINESS,
            seats: 2,
          },
          SESSION,
        ],
      ]);
    });

    it('answers a repeated webhook with the same reference and changes nothing', async () => {
      const { adapter, bookingModel, seatInventory } = setup(
        booking({
          status: BookingStatus.CONFIRMED,
          bookingReference: 'K7Q2PX',
        }),
      );

      await expect(
        adapter.confirmAfterPayment(BOOKING_ID.toString(), PAYMENT_ID),
      ).resolves.toEqual({
        bookingId: BOOKING_ID.toString(),
        status: BookingStatus.CONFIRMED,
        bookingReference: 'K7Q2PX',
      });
      expect(bookingModel.updateOne).not.toHaveBeenCalled();
      expect(seatInventory.convertHeldToBooked).not.toHaveBeenCalled();
    });

    it('refuses once the hold has expired, because its seats have gone back', async () => {
      const { adapter, bookingModel, seatInventory } = setup(
        booking({ holdExpiresAt: NOW }),
      );

      const error = await failure(
        adapter.confirmAfterPayment(BOOKING_ID.toString(), PAYMENT_ID),
      );

      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toEqual({
        code: 'HOLD_EXPIRED',
        message: 'The hold expired before the payment was confirmed',
      });
      expect(bookingModel.updateOne).not.toHaveBeenCalled();
      expect(seatInventory.convertHeldToBooked).not.toHaveBeenCalled();
    });

    it('refuses a booking that is no longer PENDING_PAYMENT (GEN-11)', async () => {
      const { adapter, bookingModel } = setup(
        booking({ status: BookingStatus.EXPIRED }),
      );

      const error = await failure(
        adapter.confirmAfterPayment(BOOKING_ID.toString(), PAYMENT_ID),
      );

      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toMatchObject({
        code: 'INVALID_BOOKING_STATE',
      });
      expect(bookingModel.updateOne).not.toHaveBeenCalled();
    });

    it('is a 404 for a booking that does not exist', async () => {
      const { adapter } = setup(null);

      const error = await failure(
        adapter.confirmAfterPayment(BOOKING_ID.toString(), PAYMENT_ID),
      );

      expect(error.getStatus()).toBe(404);
      expect(error.getResponse()).toEqual({
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking not found',
      });
    });

    it('books no seats when the booking changed between the read and the update', async () => {
      const { adapter, bookingModel, seatInventory } = setup();
      bookingModel.updateOne.mockReturnValue({
        exec: () => Promise.resolve({ modifiedCount: 0 }),
      });

      const error = await failure(
        adapter.confirmAfterPayment(BOOKING_ID.toString(), PAYMENT_ID),
      );

      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toMatchObject({
        code: 'INVALID_BOOKING_STATE',
      });
      expect(seatInventory.convertHeldToBooked).not.toHaveBeenCalled();
    });

    it('tries a new reference when the first one is taken', async () => {
      const { adapter, bookingModel, connection } = setup();
      bookingModel.updateOne
        .mockReturnValueOnce({
          exec: () => Promise.reject(duplicateReference()),
        })
        .mockReturnValueOnce({
          exec: () => Promise.reject(duplicateReference()),
        });

      const confirmation = await adapter.confirmAfterPayment(
        BOOKING_ID.toString(),
        PAYMENT_ID,
      );

      expect(confirmation.bookingReference).toMatch(REFERENCE);
      expect(connection.transaction).toHaveBeenCalledTimes(3);
    });

    it('gives up after three taken references', async () => {
      const { adapter, bookingModel, connection } = setup();
      bookingModel.updateOne.mockReturnValue({
        exec: () => Promise.reject(duplicateReference()),
      });

      await expect(
        adapter.confirmAfterPayment(BOOKING_ID.toString(), PAYMENT_ID),
      ).rejects.toMatchObject({ code: 11000 });
      expect(connection.transaction).toHaveBeenCalledTimes(3);
    });

    it('does not retry any other error', async () => {
      const { adapter, bookingModel, connection } = setup();
      bookingModel.updateOne.mockReturnValue({
        exec: () => Promise.reject(new Error('connection lost')),
      });

      await expect(
        adapter.confirmAfterPayment(BOOKING_ID.toString(), PAYMENT_ID),
      ).rejects.toThrow('connection lost');
      expect(connection.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('releaseHold (FLT-22)', () => {
    it('expires a held booking and gives its seats back, in one transaction', async () => {
      const { adapter, bookingModel, seatInventory } = setup(
        booking({ status: BookingStatus.EXPIRED }),
      );

      await adapter.releaseHold(
        BOOKING_ID.toString(),
        HoldReleaseReason.HOLD_EXPIRED,
      );

      expect(bookingModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: BOOKING_ID.toString(),
          status: BookingStatus.PENDING_PAYMENT,
        },
        { $set: { status: BookingStatus.EXPIRED, expiredAt: NOW } },
        { session: SESSION, returnDocument: 'after' },
      );
      expect(seatInventory.releaseHeld.mock.calls).toEqual([
        [
          {
            flightId: OUTBOUND_ID,
            category: CabinCategory.ECONOMY,
            seats: 2,
          },
          SESSION,
        ],
        [
          {
            flightId: INBOUND_ID,
            category: CabinCategory.BUSINESS,
            seats: 2,
          },
          SESSION,
        ],
      ]);
      expect(logSpy).toHaveBeenCalledWith(
        `Released the hold of flight booking ${BOOKING_ID.toString()} (HOLD_EXPIRED)`,
      );
    });

    it('gives nothing back when the booking is no longer held, so a repeat is safe', async () => {
      const { adapter, bookingModel, seatInventory } = setup();
      bookingModel.findOneAndUpdate.mockReturnValue(query(null));

      await adapter.releaseHold(
        BOOKING_ID.toString(),
        HoldReleaseReason.PAYMENT_FAILED,
      );

      expect(seatInventory.releaseHeld).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('hasUpcomingConfirmedBookings (ACC-12)', () => {
    it('looks for a confirmed booking with a segment still to fly', async () => {
      const { adapter, bookingModel } = setup();
      bookingModel.exists.mockReturnValue({
        exec: () => Promise.resolve({ _id: BOOKING_ID }),
      });

      await expect(
        adapter.hasUpcomingConfirmedBookings(USER_ID.toString()),
      ).resolves.toBe(true);
      expect(bookingModel.exists).toHaveBeenCalledWith({
        userId: USER_ID.toString(),
        status: BookingStatus.CONFIRMED,
        'segments.departureAtUtc': { $gt: NOW },
      });
    });

    it('is false when there is none', async () => {
      const { adapter } = setup();

      await expect(
        adapter.hasUpcomingConfirmedBookings(USER_ID.toString()),
      ).resolves.toBe(false);
    });
  });

  describe('newBookingReference', () => {
    it('is 6 characters that cannot be misread', () => {
      const references = Array.from({ length: 200 }, newBookingReference);

      for (const reference of references) {
        expect(reference).toMatch(REFERENCE);
      }
      // Random, not a counter: 200 draws from about a billion are all different.
      expect(new Set(references).size).toBe(200);
    });
  });
});
