import { HttpException } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { Role } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { BookingStatus } from '../../common/bookings/booking-status';
import type { NotificationsService } from '../../notifications/notifications.service';
import { CancelledBy } from '../../payments/refund-status.enum';
import {
  FlightBooking,
  PassengerType,
  TripType,
} from '../schemas/flight-booking.schema';
import { CabinCategory } from '../schemas/flight.schema';
import type { SeatInventoryService } from '../seat-inventory/seat-inventory.service';
import { FlightBookingGroup } from './dto/my-flight-bookings.dto';
import {
  MyFlightBookingsService,
  wholeDaysUntil,
} from './my-flight-bookings.service';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const USER_ID = new Types.ObjectId();
const BOOKING_ID = new Types.ObjectId();
const OUTBOUND_FLIGHT = new Types.ObjectId();
const INBOUND_FLIGHT = new Types.ObjectId();

const user: AuthenticatedUser = {
  userId: USER_ID.toString(),
  role: Role.USER,
  sessionId: new Types.ObjectId().toString(),
};

// Departures are relative to the real clock, with an hour of margin, so the whole days
// left are exact whatever time the test runs.
const inDays = (days: number): Date => new Date(Date.now() + days * DAY + HOUR);

function segment(flightId: Types.ObjectId, departure: Date, seats = 2) {
  return {
    flightId,
    airlineId: new Types.ObjectId(),
    flightNumber: 'MS777',
    departureAirportId: 'CAI',
    arrivalAirportId: 'DXB',
    departureAtUtc: departure,
    arrivalAtUtc: new Date(departure.getTime() + 4 * HOUR),
    cabinCategory: CabinCategory.ECONOMY,
    seatsRequired: seats,
  };
}

function booking(overrides: Record<string, unknown> = {}) {
  return {
    _id: BOOKING_ID,
    userId: USER_ID,
    bookingReference: 'K7M2QX',
    tripType: TripType.ONE_WAY,
    status: BookingStatus.CONFIRMED,
    confirmedAt: new Date('2026-11-18T09:15:00.000Z'),
    cancelledAt: null,
    cancellation: null,
    passengers: [
      { fullName: 'Amira Hassan', passengerType: PassengerType.ADULT },
      { fullName: 'Omar Hassan', passengerType: PassengerType.ADULT },
    ],
    segments: [segment(OUTBOUND_FLIGHT, inDays(10))],
    priceSnapshot: {
      total: Types.Decimal128.fromString('400.00'),
      currency: 'USD',
    },
    policySnapshot: {
      airlineId: new Types.ObjectId(),
      version: 3,
      cancellationTiers: [
        { daysBeforeDeparture: 14, refundPercentage: 100 },
        { daysBeforeDeparture: 7, refundPercentage: 50 },
        { daysBeforeDeparture: 1, refundPercentage: 20 },
      ],
    },
    ...overrides,
  };
}

interface QueryChain {
  select: () => QueryChain;
  sort: (sort: Record<string, 1 | -1>) => QueryChain;
  skip: () => QueryChain;
  limit: () => QueryChain;
  lean: () => QueryChain;
  exec: () => Promise<unknown>;
}

// A query stand-in: every chained call returns the chain and exec() resolves the result.
function query(result: unknown): QueryChain {
  const chain: QueryChain = {
    select: () => chain,
    sort: jest.fn((_sort: Record<string, 1 | -1>): QueryChain => chain),
    skip: () => chain,
    limit: () => chain,
    lean: () => chain,
    exec: () => Promise.resolve(result),
  };
  return chain;
}

function setup(
  options: {
    found?: object | null;
    foundAfter?: object | null;
    updated?: object | null;
    page?: object[];
    counts?: [number, number, number];
    refund?: object | null;
    refundFails?: boolean;
  } = {},
) {
  const found = options.found === undefined ? booking() : options.found;
  const findOne = jest
    .fn()
    .mockImplementationOnce(() => query(found))
    .mockImplementation(() =>
      query(options.foundAfter === undefined ? found : options.foundAfter),
    );
  const counts = options.counts ?? [0, 0, 0];
  const findChain = query(options.page ?? []);
  const bookingModel = {
    findOne,
    find: jest.fn(() => findChain),
    // The page total and the three group counts, told apart by their filter.
    countDocuments: jest.fn((filter: { status?: string; $or?: unknown }) => {
      if (filter.$or) {
        return query(counts[1]);
      }
      return query(filter.status === 'CANCELLED' ? counts[2] : counts[0]);
    }),
    findOneAndUpdate: jest.fn(() =>
      query(options.updated === undefined ? booking() : options.updated),
    ),
    updateOne: jest.fn(() => query({ modifiedCount: 1 })),
  };
  const session = { id: 'session' };
  const connection = {
    transaction: jest.fn((work: (s: unknown) => Promise<unknown>) =>
      work(session),
    ),
  };
  const seatInventory = {
    releaseBooked: jest.fn(() => Promise.resolve()),
  };
  const notifications = { notify: jest.fn(() => Promise.resolve()) };
  const issueForCancellation = jest.fn(() =>
    options.refundFails
      ? Promise.reject(new Error('stripe is down'))
      : Promise.resolve(options.refund ?? null),
  );
  const moduleRef = {
    get: jest.fn(() => ({ issueForCancellation })),
  };
  const service = new MyFlightBookingsService(
    bookingModel as unknown as Model<FlightBooking>,
    connection as unknown as Connection,
    seatInventory as unknown as SeatInventoryService,
    notifications as unknown as NotificationsService,
    moduleRef as unknown as ModuleRef,
  );
  return {
    service,
    bookingModel,
    connection,
    seatInventory,
    notifications,
    issueForCancellation,
    findChain,
    session,
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

const codeOf = (error: HttpException): string =>
  (error.getResponse() as { code: string }).code;

describe('wholeDaysUntil (FLT-09, FLT-26)', () => {
  const now = new Date('2026-12-01T10:00:00.000Z');

  it('counts whole 24-hour periods', () => {
    expect(wholeDaysUntil(new Date(now.getTime() + 7 * DAY), now)).toBe(7);
    expect(wholeDaysUntil(new Date(now.getTime() + 7 * DAY - 1), now)).toBe(6);
    expect(wholeDaysUntil(new Date(now.getTime() + 23 * HOUR), now)).toBe(0);
  });

  it('is 0 once the departure has passed', () => {
    expect(wholeDaysUntil(new Date(now.getTime() - DAY), now)).toBe(0);
  });
});

describe('MyFlightBookingsService.list (FLT-25)', () => {
  it('lists the upcoming group of the user, soonest first, with the group counts', async () => {
    const { service, bookingModel, findChain } = setup({
      page: [booking()],
      counts: [3, 5, 1],
    });

    const result = await service.list(
      { page: 1, group: FlightBookingGroup.UPCOMING },
      user,
    );

    const filter = bookingModel.find.mock.calls[0] as unknown as [object];
    expect(filter[0]).toMatchObject({
      userId: user.userId,
      status: BookingStatus.CONFIRMED,
      'segments.departureAtUtc': { $gt: expect.any(Date) },
    });
    expect(findChain.sort).toHaveBeenCalledWith({
      'segments.0.departureAtUtc': 1,
      _id: 1,
    });
    expect(result.group).toBe('UPCOMING');
    expect(result.counts).toEqual({ upcoming: 3, past: 5, cancelled: 1 });
    expect(result.bookings.meta).toMatchObject({ page: 1, pageSize: 10 });
    expect(result.bookings.items[0]).toEqual({
      id: BOOKING_ID.toString(),
      bookingReference: 'K7M2QX',
      status: 'CONFIRMED',
      tripType: 'ONE_WAY',
      segments: [
        {
          flightNumber: 'MS777',
          departureAirportId: 'CAI',
          arrivalAirportId: 'DXB',
          departureAtUtc: expect.any(String),
          arrivalAtUtc: expect.any(String),
          cabin: 'ECONOMY',
        },
      ],
      passengerCount: 2,
      total: '400.00',
      currency: 'USD',
      confirmedAt: '2026-11-18T09:15:00.000Z',
      cancelledAt: null,
      refund: null,
    });
  });

  it('puts COMPLETED and fully departed CONFIRMED bookings in PAST, latest first', async () => {
    const { service, bookingModel, findChain } = setup();

    await service.list({ page: 1, group: FlightBookingGroup.PAST }, user);

    const filter = (bookingModel.find.mock.calls[0] as unknown as [object])[0];
    expect(filter).toMatchObject({
      userId: user.userId,
      $or: [
        { status: BookingStatus.COMPLETED },
        {
          status: BookingStatus.CONFIRMED,
          segments: {
            $not: {
              $elemMatch: { departureAtUtc: { $gt: expect.any(Date) } },
            },
          },
        },
      ],
    });
    expect(findChain.sort).toHaveBeenCalledWith({
      'segments.0.departureAtUtc': -1,
      _id: 1,
    });
  });

  it('puts CANCELLED bookings in their own group with the refund shown', async () => {
    const cancelled = booking({
      status: BookingStatus.CANCELLED,
      cancelledAt: new Date('2026-11-19T08:00:00.000Z'),
      cancellation: {
        refundPercentage: 50,
        refundAmount: Types.Decimal128.fromString('200.00'),
      },
    });
    const { service, bookingModel, findChain } = setup({ page: [cancelled] });

    const result = await service.list(
      { page: 1, group: FlightBookingGroup.CANCELLED },
      user,
    );

    expect(
      (bookingModel.find.mock.calls[0] as unknown as [object])[0],
    ).toMatchObject({ userId: user.userId, status: BookingStatus.CANCELLED });
    expect(findChain.sort).toHaveBeenCalledWith({ cancelledAt: -1, _id: 1 });
    expect(result.bookings.items[0]).toMatchObject({
      status: 'CANCELLED',
      cancelledAt: '2026-11-19T08:00:00.000Z',
      refund: { percentage: 50, amount: '200.00' },
    });
  });

  it('never returns document numbers, the buyer or the payment', async () => {
    const { service } = setup({ page: [booking()] });

    const result = await service.list(
      { page: 1, group: FlightBookingGroup.UPCOMING },
      user,
    );

    const text = JSON.stringify(result);
    expect(text).not.toContain('documentNumber');
    expect(text).not.toContain('userId');
    expect(text).not.toContain('paymentId');
  });
});

describe('MyFlightBookingsService.cancellationQuote (FLT-26)', () => {
  it("gives the tier of the booking's own snapshot for the whole days left", async () => {
    const { service, bookingModel } = setup();

    const quote = await service.cancellationQuote(BOOKING_ID.toString(), user);

    expect(bookingModel.findOne).toHaveBeenCalledWith({
      _id: BOOKING_ID.toString(),
      userId: user.userId,
    });
    expect(quote).toMatchObject({
      bookingId: BOOKING_ID.toString(),
      canCancel: true,
      blockedReason: null,
      daysRemaining: 10,
      refundPercentage: 50,
      refundAmount: '200.00',
      currency: 'USD',
      tiers: [
        { daysBeforeDeparture: 14, refundPercentage: 100 },
        { daysBeforeDeparture: 7, refundPercentage: 50 },
        { daysBeforeDeparture: 1, refundPercentage: 20 },
      ],
    });
  });

  it('refunds 100% far ahead and 0 with no tier', async () => {
    const far = setup({
      found: booking({ segments: [segment(OUTBOUND_FLIGHT, inDays(20))] }),
    });
    const none = setup({
      found: booking({
        policySnapshot: { ...booking().policySnapshot, cancellationTiers: [] },
      }),
    });

    expect(
      await far.service.cancellationQuote(BOOKING_ID.toString(), user),
    ).toMatchObject({ refundPercentage: 100, refundAmount: '400.00' });
    expect(
      await none.service.cancellationQuote(BOOKING_ID.toString(), user),
    ).toMatchObject({ refundPercentage: 0, refundAmount: '0.00' });
  });

  it('uses the outbound flight of a round trip', async () => {
    const { service } = setup({
      found: booking({
        tripType: TripType.ROUND_TRIP,
        segments: [
          segment(OUTBOUND_FLIGHT, inDays(10)),
          segment(INBOUND_FLIGHT, inDays(30)),
        ],
      }),
    });

    const quote = await service.cancellationQuote(BOOKING_ID.toString(), user);

    expect(quote.daysRemaining).toBe(10);
    expect(quote.refundPercentage).toBe(50);
  });

  it('is blocked once the first flight has left', async () => {
    const { service } = setup({
      found: booking({
        segments: [segment(OUTBOUND_FLIGHT, new Date(Date.now() - HOUR))],
      }),
    });

    const quote = await service.cancellationQuote(BOOKING_ID.toString(), user);

    expect(quote).toMatchObject({
      canCancel: false,
      blockedReason: 'DEPARTURE_PASSED',
      daysRemaining: 0,
    });
  });

  it('is blocked for a booking that is not CONFIRMED', async () => {
    const { service } = setup({
      found: booking({ status: BookingStatus.CANCELLED }),
    });

    const quote = await service.cancellationQuote(BOOKING_ID.toString(), user);

    expect(quote).toMatchObject({
      canCancel: false,
      blockedReason: 'NOT_CONFIRMED',
    });
  });

  it('answers 404 for a missing, foreign or malformed id', async () => {
    const missing = setup({ found: null });
    const malformed = setup();

    const first = await failure(
      missing.service.cancellationQuote(BOOKING_ID.toString(), user),
    );
    const second = await failure(
      malformed.service.cancellationQuote('not-an-id', user),
    );

    expect(first.getStatus()).toBe(404);
    expect(codeOf(first)).toBe('BOOKING_NOT_FOUND');
    expect(second.getStatus()).toBe(404);
    expect(malformed.bookingModel.findOne).not.toHaveBeenCalled();
  });
});

describe('MyFlightBookingsService.cancel (FLT-26)', () => {
  const REFUND = {
    _id: new Types.ObjectId(),
    amount: Types.Decimal128.fromString('200.00'),
  };

  it('cancels, gives the seats back, requests the refund and notifies', async () => {
    const round = booking({
      tripType: TripType.ROUND_TRIP,
      segments: [
        segment(OUTBOUND_FLIGHT, inDays(10)),
        segment(INBOUND_FLIGHT, inDays(30)),
      ],
    });
    const {
      service,
      bookingModel,
      seatInventory,
      issueForCancellation,
      notifications,
      session,
    } = setup({ found: round, updated: round, refund: REFUND });

    const result = await service.cancel(
      BOOKING_ID.toString(),
      { reason: 'My plans changed' },
      user,
    );

    // One conditional update: only a CONFIRMED booking of this user whose flight is ahead.
    const [filter, update, options] = bookingModel.findOneAndUpdate.mock
      .calls[0] as unknown as [
      object,
      { $set: Record<string, unknown> },
      object,
    ];
    expect(filter).toMatchObject({
      _id: BOOKING_ID,
      userId: user.userId,
      status: BookingStatus.CONFIRMED,
      'segments.0.departureAtUtc': { $gt: expect.any(Date) },
    });
    expect(update.$set).toMatchObject({
      status: BookingStatus.CANCELLED,
      cancellation: {
        reason: 'My plans changed',
        refundPercentage: 50,
        refundId: null,
      },
    });
    expect(
      String(
        (update.$set.cancellation as { refundAmount: Types.Decimal128 })
          .refundAmount,
      ),
    ).toBe('200.00');
    expect(options).toMatchObject({ session });

    // Both segments' seats go back, in the same transaction.
    expect(seatInventory.releaseBooked).toHaveBeenCalledTimes(2);
    expect(seatInventory.releaseBooked).toHaveBeenCalledWith(
      {
        flightId: OUTBOUND_FLIGHT,
        category: CabinCategory.ECONOMY,
        seats: 2,
      },
      session,
    );
    expect(seatInventory.releaseBooked).toHaveBeenCalledWith(
      {
        flightId: INBOUND_FLIGHT,
        category: CabinCategory.ECONOMY,
        seats: 2,
      },
      session,
    );

    expect(issueForCancellation).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingType: 'FLIGHT',
        bookingId: BOOKING_ID.toString(),
        cancelledBy: CancelledBy.USER,
        refundPercentage: 50,
        reason: 'My plans changed',
      }),
    );
    expect(bookingModel.updateOne).toHaveBeenCalledWith(
      { _id: BOOKING_ID },
      {
        $set: {
          'cancellation.refundId': REFUND._id,
          'cancellation.refundAmount': expect.anything(),
        },
      },
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        type: 'BOOKING_CANCELLED',
        resourceType: 'FLIGHT_BOOKING',
        resourceId: BOOKING_ID.toString(),
      }),
    );
    expect(result).toMatchObject({
      id: BOOKING_ID.toString(),
      status: 'CANCELLED',
      refundPercentage: 50,
      refundAmount: '200.00',
      currency: 'USD',
      refundId: REFUND._id.toString(),
    });
  });

  it('keeps the cancellation when nothing was paid: refund 0.00, no refund id', async () => {
    const { service } = setup({ refund: null });

    const result = await service.cancel(BOOKING_ID.toString(), {}, user);

    expect(result).toMatchObject({
      status: 'CANCELLED',
      refundAmount: '0.00',
      refundId: null,
    });
  });

  it('keeps the cancellation when the refund fails', async () => {
    const { service, seatInventory } = setup({ refundFails: true });

    const result = await service.cancel(BOOKING_ID.toString(), {}, user);

    expect(result).toMatchObject({ status: 'CANCELLED', refundId: null });
    expect(seatInventory.releaseBooked).toHaveBeenCalledTimes(1);
  });

  it('refuses an unpaid hold with 409 BOOKING_NOT_CANCELLABLE and changes nothing', async () => {
    const { service, connection } = setup({
      found: booking({ status: BookingStatus.PENDING_PAYMENT }),
    });

    const error = await failure(
      service.cancel(BOOKING_ID.toString(), {}, user),
    );

    expect(error.getStatus()).toBe(409);
    expect(codeOf(error)).toBe('BOOKING_NOT_CANCELLABLE');
    expect(connection.transaction).not.toHaveBeenCalled();
  });

  it('refuses an already cancelled booking with 409 BOOKING_NOT_CANCELLABLE', async () => {
    const { service, connection } = setup({
      found: booking({ status: BookingStatus.CANCELLED }),
    });

    const error = await failure(
      service.cancel(BOOKING_ID.toString(), {}, user),
    );

    expect(codeOf(error)).toBe('BOOKING_NOT_CANCELLABLE');
    expect(connection.transaction).not.toHaveBeenCalled();
  });

  it('refuses a booking whose flight has left with 409 DEPARTURE_PASSED', async () => {
    const { service, connection } = setup({
      found: booking({
        segments: [segment(OUTBOUND_FLIGHT, new Date(Date.now() - HOUR))],
      }),
    });

    const error = await failure(
      service.cancel(BOOKING_ID.toString(), {}, user),
    );

    expect(error.getStatus()).toBe(409);
    expect(codeOf(error)).toBe('DEPARTURE_PASSED');
    expect(connection.transaction).not.toHaveBeenCalled();
  });

  it('answers 409 when another request cancelled it first, and returns no seats twice', async () => {
    const { service, seatInventory, issueForCancellation } = setup({
      updated: null,
      foundAfter: booking({ status: BookingStatus.CANCELLED }),
    });

    const error = await failure(
      service.cancel(BOOKING_ID.toString(), {}, user),
    );

    expect(error.getStatus()).toBe(409);
    expect(codeOf(error)).toBe('BOOKING_NOT_CANCELLABLE');
    expect(seatInventory.releaseBooked).not.toHaveBeenCalled();
    expect(issueForCancellation).not.toHaveBeenCalled();
  });

  it("answers 404 for another account's booking", async () => {
    const { service, connection } = setup({ found: null });

    const error = await failure(
      service.cancel(BOOKING_ID.toString(), {}, user),
    );

    expect(error.getStatus()).toBe(404);
    expect(codeOf(error)).toBe('BOOKING_NOT_FOUND');
    expect(connection.transaction).not.toHaveBeenCalled();
  });
});
