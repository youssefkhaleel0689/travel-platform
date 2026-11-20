import { HttpException, Logger } from '@nestjs/common';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import {
  BookingType,
  ProviderType,
} from '../../common/bookings/booking-status';
import { HoldReleaseReason } from '../../common/bookings/bookings.port';
import type { Airline } from '../schemas/airline.schema';
import { BookingStatus, FlightBooking } from '../schemas/flight-booking.schema';
import { CabinCategory } from '../schemas/flight.schema';
import type { ReferenceDataService } from '../../common/reference-data/reference-data.service';
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
const ZONES: Record<string, string> = {
  CAI: 'Africa/Cairo',
  DXB: 'Asia/Dubai',
};
// What the confirmation notice names for the round trip below (FLT-23).
const SUMMARY =
  'KD100 CAI to DXB on 20 Dec 2026, 08:30 and KD101 DXB to CAI on 27 Dec 2026, 16:00; 3 passengers';

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
        flightNumber: 'KD100',
        departureAirportId: 'CAI',
        arrivalAirportId: 'DXB',
        // 08:30 in Cairo (UTC+2).
        departureAtUtc: new Date('2026-12-20T06:30:00.000Z'),
        cabinCategory: CabinCategory.ECONOMY,
        seatsRequired: 2,
      },
      {
        flightId: INBOUND_ID,
        flightNumber: 'KD101',
        departureAirportId: 'DXB',
        arrivalAirportId: 'CAI',
        // 16:00 in Dubai (UTC+4).
        departureAtUtc: new Date('2026-12-27T12:00:00.000Z'),
        cabinCategory: CabinCategory.BUSINESS,
        seatsRequired: 2,
      },
    ],
    // Two adults and an infant on a lap.
    passengers: [{}, {}, {}],
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
  const referenceData = {
    getAirportOrThrow: jest.fn((id: string) =>
      Promise.resolve({ id, timeZone: ZONES[id] }),
    ),
  };
  // ACC-17 only: the admin list resolves airline names through this model.
  const airlineModel = {
    find: jest.fn(() => ({
      select: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }),
    })),
  };
  sessions.length = 0;
  const adapter = new FlightBookingsPortAdapter(
    bookingModel as unknown as Model<FlightBooking>,
    airlineModel as unknown as Model<Airline>,
    connection as unknown as Connection,
    seatInventory as unknown as SeatInventoryService,
    referenceData as unknown as ReferenceDataService,
  );
  return {
    adapter,
    bookingModel,
    airlineModel,
    connection,
    seatInventory,
    referenceData,
  };
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
        summary: SUMMARY,
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

    it('refuses a second payment for a booking another payment confirmed (409), so it is refunded', async () => {
      const { adapter, bookingModel, seatInventory } = setup(
        booking({
          status: BookingStatus.CONFIRMED,
          bookingReference: 'K7Q2PX',
          paymentId: new Types.ObjectId(),
        }),
      );

      const error = await failure(
        adapter.confirmAfterPayment(BOOKING_ID.toString(), PAYMENT_ID),
      );

      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toMatchObject({
        code: 'ALREADY_CONFIRMED_BY_ANOTHER_PAYMENT',
      });
      expect(bookingModel.updateOne).not.toHaveBeenCalled();
      expect(seatInventory.convertHeldToBooked).not.toHaveBeenCalled();
    });

    it('answers the confirming payment again with the same reference', async () => {
      const { adapter } = setup(
        booking({
          status: BookingStatus.CONFIRMED,
          bookingReference: 'K7Q2PX',
          paymentId: new Types.ObjectId(PAYMENT_ID),
        }),
      );

      await expect(
        adapter.confirmAfterPayment(BOOKING_ID.toString(), PAYMENT_ID),
      ).resolves.toMatchObject({ bookingReference: 'K7Q2PX' });
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
        summary: SUMMARY,
      });
      expect(bookingModel.updateOne).not.toHaveBeenCalled();
      expect(seatInventory.convertHeldToBooked).not.toHaveBeenCalled();
    });

    it('names a single passenger without a plural', async () => {
      const { adapter } = setup(
        booking({
          segments: [booking().segments[0]],
          passengers: [booking().passengers[0]],
        }),
      );

      const confirmation = await adapter.confirmAfterPayment(
        BOOKING_ID.toString(),
        PAYMENT_ID,
      );

      expect(confirmation.summary).toBe(
        'KD100 CAI to DXB on 20 Dec 2026, 08:30; 1 passenger',
      );
    });

    it('still confirms when the summary cannot be built: the notice just has less in it', async () => {
      const { adapter, referenceData } = setup();
      referenceData.getAirportOrThrow.mockImplementation(() =>
        Promise.reject(new Error('reference data unavailable')),
      );
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      const confirmation = await adapter.confirmAfterPayment(
        BOOKING_ID.toString(),
        PAYMENT_ID,
      );

      expect(confirmation).toMatchObject({
        status: BookingStatus.CONFIRMED,
        summary: undefined,
      });
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
  // ACC-17: the rows C2's admin list merges with the hotel reservations.
  describe('listForAdmin (ACC-17)', () => {
    const CREATED_AT = new Date('2026-11-17T09:00:00.000Z');

    // A booking as .lean() returns it: the two segments of the round trip
    // above, with their arrivals and the createdAt `timestamps: true` adds.
    const ARRIVALS = [
      new Date('2026-12-20T10:30:00.000Z'),
      new Date('2026-12-27T14:00:00.000Z'),
    ];

    // Spread through a plain-object view: FlightBooking is a class, and
    // spreading an instance would drop its prototype.
    const plain = (value: unknown): Record<string, unknown> =>
      value as Record<string, unknown>;

    function adminBooking(overrides: Partial<FlightBooking> = {}) {
      const base = plain(
        booking({
          status: BookingStatus.CONFIRMED,
          bookingReference: 'K7M2QX',
          ...overrides,
        }),
      );
      const segments = (base.segments as unknown[]).map((segment, index) => ({
        ...plain(segment),
        arrivalAtUtc: ARRIVALS[index],
      }));
      return {
        ...base,
        createdAt: CREATED_AT,
        segments,
      } as unknown as FlightBooking;
    }

    function adminSetup(rows: FlightBooking[], total = rows.length) {
      const find = jest.fn(() => ({
        sort: () => ({
          limit: () => ({ lean: () => ({ exec: () => Promise.resolve(rows) }) }),
        }),
      }));
      const bookingModel = {
        find,
        countDocuments: jest.fn(() => ({
          exec: () => Promise.resolve(total),
        })),
      };
      const airlineFind = jest.fn(() => ({
        select: () => ({
          lean: () => ({
            exec: () =>
              Promise.resolve([{ _id: AIRLINE_ID, name: 'KD Airways' }]),
          }),
        }),
      }));
      const adapter = new FlightBookingsPortAdapter(
        bookingModel as unknown as Model<FlightBooking>,
        { find: airlineFind } as unknown as Model<Airline>,
        {} as unknown as Connection,
        {} as unknown as SeatInventoryService,
        {} as unknown as ReferenceDataService,
      );
      return { adapter, find, airlineFind, bookingModel };
    }

    it('maps a booking to the row the admin list shows', async () => {
      const { adapter } = adminSetup([adminBooking()]);

      const { rows, total } = await adapter.listForAdmin({ limit: 10 });

      expect(total).toBe(1);
      expect(rows[0]).toEqual({
        bookingId: BOOKING_ID.toString(),
        bookingType: BookingType.FLIGHT,
        bookingReference: 'K7M2QX',
        userId: USER_ID.toString(),
        providerType: ProviderType.AIRLINE,
        providerId: AIRLINE_ID.toString(),
        providerName: 'KD Airways',
        // The whole trip: the first departure to the last arrival.
        startsAt: new Date('2026-12-20T06:30:00.000Z'),
        endsAt: new Date('2026-12-27T14:00:00.000Z'),
        // A string, never a number: the total is Decimal128 in the database.
        totalAmount: '420.00',
        currency: 'USD',
        status: BookingStatus.CONFIRMED,
        createdAt: CREATED_AT,
      });
    });

    it('asks for nothing in particular when there is no filter', async () => {
      const { adapter, find } = adminSetup([]);

      await adapter.listForAdmin({ limit: 10 });

      expect(find).toHaveBeenCalledWith({});
    });

    it('turns the filters into one query, with a half-open date range', async () => {
      const { adapter, find, bookingModel } = adminSetup([]);
      const createdFrom = new Date('2026-11-01T00:00:00.000Z');
      const createdTo = new Date('2026-12-01T00:00:00.000Z');

      await adapter.listForAdmin({
        limit: 20,
        status: BookingStatus.CANCELLED,
        reference: 'K7M2QX',
        createdFrom,
        createdTo,
      });

      const expected = {
        status: BookingStatus.CANCELLED,
        bookingReference: 'K7M2QX',
        createdAt: { $gte: createdFrom, $lt: createdTo },
      };
      expect(find).toHaveBeenCalledWith(expected);
      // The count must use the same filter, or the page says 12 and shows 3.
      expect(bookingModel.countDocuments).toHaveBeenCalledWith(expected);
    });

    it('shows an unpaid booking with no reference', async () => {
      const { adapter } = adminSetup([
        adminBooking({
          status: BookingStatus.PENDING_PAYMENT,
          bookingReference: undefined,
        }),
      ]);

      const { rows } = await adapter.listForAdmin({ limit: 10 });

      expect(rows[0].bookingReference).toBeNull();
    });

    it('does not look an airline up when the page is empty', async () => {
      const { adapter, airlineFind } = adminSetup([]);

      const { rows } = await adapter.listForAdmin({ limit: 10 });

      expect(rows).toEqual([]);
      expect(airlineFind).not.toHaveBeenCalled();
    });

    // One query for the whole page, not one per row.
    it('asks for the airlines of a page once', async () => {
      const { adapter, airlineFind } = adminSetup([
        adminBooking(),
        adminBooking(),
        adminBooking(),
      ]);

      await adapter.listForAdmin({ limit: 10 });

      expect(airlineFind).toHaveBeenCalledTimes(1);
      expect(airlineFind).toHaveBeenCalledWith({ _id: { $in: [AIRLINE_ID] } });
    });

    it('leaves the name null when the airline row has gone', async () => {
      const { adapter } = adminSetup([
        adminBooking({
          policySnapshot: {
            ...plain(booking().policySnapshot),
            airlineId: new Types.ObjectId(),
          },
        } as Partial<FlightBooking>),
      ]);

      const { rows } = await adapter.listForAdmin({ limit: 10 });

      expect(rows[0].providerName).toBeNull();
    });
  });
});
