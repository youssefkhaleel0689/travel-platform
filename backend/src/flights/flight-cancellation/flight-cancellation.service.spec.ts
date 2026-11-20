import { HttpException } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { Role } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { BookingStatus } from '../../common/bookings/booking-status';
import type { NotificationsService } from '../../notifications/notifications.service';
import { CancelledBy } from '../../payments/refund-status.enum';
import { AirlineModeratorAssignment } from '../schemas/airline-moderator-assignment.schema';
import { Airline, AirlineStatus } from '../schemas/airline.schema';
import { FlightBooking, TripType } from '../schemas/flight-booking.schema';
import { CabinCategory, Flight, FlightStatus } from '../schemas/flight.schema';
import type { SeatInventoryService } from '../seat-inventory/seat-inventory.service';
import { FlightCancellationService } from './flight-cancellation.service';

const HOUR = 60 * 60 * 1000;
const AIRLINE_ID = new Types.ObjectId();
const FLIGHT_ID = new Types.ObjectId();
const OTHER_FLIGHT_ID = new Types.ObjectId();
const MODERATOR_ID = new Types.ObjectId();

const moderator: AuthenticatedUser = {
  userId: MODERATOR_ID.toString(),
  role: Role.AIRLINE_MODERATOR,
  sessionId: new Types.ObjectId().toString(),
};

function flight(overrides: Record<string, unknown> = {}) {
  const departure = new Date(Date.now() + 48 * HOUR);
  return {
    _id: FLIGHT_ID,
    airlineId: AIRLINE_ID,
    flightNumber: 'MS777',
    departureAirportId: 'CAI',
    arrivalAirportId: 'DXB',
    departureLocalInput: '2026-12-20T08:30',
    arrivalLocalInput: '2026-12-20T14:30',
    departureAtUtc: departure,
    arrivalAtUtc: new Date(departure.getTime() + 4 * HOUR),
    departureDateKey: '2026-12-20',
    status: FlightStatus.CANCELLED,
    cabinInventory: [],
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-19T00:00:00.000Z'),
    ...overrides,
  };
}

function segment(flightId: Types.ObjectId, category: CabinCategory, seats = 2) {
  return { flightId, cabinCategory: category, seatsRequired: seats };
}

function booking(
  status: BookingStatus,
  overrides: Record<string, unknown> = {},
) {
  return {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    bookingReference: 'K7M2QX',
    tripType: TripType.ONE_WAY,
    status,
    segments: [segment(FLIGHT_ID, CabinCategory.ECONOMY)],
    priceSnapshot: {
      total: Types.Decimal128.fromString('400.00'),
      currency: 'USD',
    },
    ...overrides,
  };
}

// A query stand-in: every chained call returns the chain and exec() resolves the result.
function query<R>(result: R) {
  const chain = {
    select: () => chain,
    sort: () => chain,
    session: () => chain,
    lean: () => chain,
    exec: () => Promise.resolve(result),
  };
  return chain;
}

type Filter = { _id?: Types.ObjectId; status?: BookingStatus };

function setup(
  options: {
    assignedTo?: Types.ObjectId | null;
    airlineStatus?: AirlineStatus;
    transitioned?: object | null;
    current?: object | null;
    bookings?: ReturnType<typeof booking>[];
    lost?: Types.ObjectId[];
    refundFails?: Types.ObjectId[];
  } = {},
) {
  const assignedTo =
    options.assignedTo === undefined ? AIRLINE_ID : options.assignedTo;
  const bookings = options.bookings ?? [];
  const assignmentModel = {
    findOne: jest.fn(() =>
      query(assignedTo ? { airlineId: assignedTo } : null),
    ),
  };
  const airlineModel = {
    findById: jest.fn(() =>
      query({ status: options.airlineStatus ?? AirlineStatus.ACTIVE }),
    ),
  };
  const flightModel = {
    findOneAndUpdate: jest.fn(() =>
      query(
        options.transitioned === undefined ? flight() : options.transitioned,
      ),
    ),
    findOne: jest.fn(() => query(options.current ?? null)),
  };
  const bookingModel = {
    find: jest.fn(() => query(bookings)),
    // Returns the booking in its new state, or null when someone else got there first.
    findOneAndUpdate: jest.fn((filter: Filter) => {
      const found = bookings.find((b) => b._id.equals(filter._id as never));
      if (!found || options.lost?.some((id) => id.equals(found._id))) {
        return query(null);
      }
      return query({
        ...found,
        status:
          filter.status === BookingStatus.CONFIRMED
            ? BookingStatus.CANCELLED
            : BookingStatus.EXPIRED,
      });
    }),
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
    releaseHeld: jest.fn(() => Promise.resolve()),
  };
  const notifications = { notifyMany: jest.fn(() => Promise.resolve()) };
  const issueForCancellation = jest.fn((input: { bookingId: string }) =>
    options.refundFails?.some((id) => id.toString() === input.bookingId)
      ? Promise.reject(new Error('stripe is down'))
      : Promise.resolve({
          _id: new Types.ObjectId(),
          amount: Types.Decimal128.fromString('400.00'),
        }),
  );
  const moduleRef = { get: jest.fn(() => ({ issueForCancellation })) };
  const service = new FlightCancellationService(
    flightModel as unknown as Model<Flight>,
    bookingModel as unknown as Model<FlightBooking>,
    assignmentModel as unknown as Model<AirlineModeratorAssignment>,
    airlineModel as unknown as Model<Airline>,
    connection as unknown as Connection,
    seatInventory as unknown as SeatInventoryService,
    notifications as unknown as NotificationsService,
    moduleRef as unknown as ModuleRef,
  );
  return {
    service,
    flightModel,
    bookingModel,
    seatInventory,
    notifications,
    issueForCancellation,
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

describe('FlightCancellationService.cancel (FLT-06)', () => {
  it('cancels the flight, refunds every CONFIRMED booking in full and releases the holds', async () => {
    const paid = booking(BookingStatus.CONFIRMED);
    const roundTrip = booking(BookingStatus.CONFIRMED, {
      tripType: TripType.ROUND_TRIP,
      segments: [
        segment(FLIGHT_ID, CabinCategory.ECONOMY, 1),
        segment(OTHER_FLIGHT_ID, CabinCategory.BUSINESS, 1),
      ],
    });
    const hold = booking(BookingStatus.PENDING_PAYMENT, {
      segments: [segment(FLIGHT_ID, CabinCategory.ECONOMY, 3)],
    });
    const ctx = setup({ bookings: [paid, roundTrip, hold] });

    const result = await ctx.service.cancel(
      FLIGHT_ID.toString(),
      { confirm: true, reason: 'Aircraft unavailable' },
      moderator,
    );

    expect(result).toMatchObject({
      cancelledBookings: 2,
      releasedHolds: 1,
      refundsRequested: 2,
      refundsFailed: 0,
      flight: { id: FLIGHT_ID.toString(), status: 'CANCELLED' },
    });
    // The flight moves only when it is the airline's, SCHEDULED and not yet departed.
    expect(ctx.flightModel.findOneAndUpdate.mock.calls[0]).toMatchObject([
      {
        _id: FLIGHT_ID,
        airlineId: AIRLINE_ID,
        status: FlightStatus.SCHEDULED,
        departureAtUtc: { $gt: expect.any(Date) },
      },
      { $set: { status: FlightStatus.CANCELLED } },
      expect.objectContaining({ session: expect.anything() }),
    ]);
    // Booked seats of EVERY segment go back, also on the other flight of a round trip.
    expect(ctx.seatInventory.releaseBooked).toHaveBeenCalledTimes(3);
    expect(ctx.seatInventory.releaseBooked).toHaveBeenCalledWith(
      { flightId: OTHER_FLIGHT_ID, category: 'BUSINESS', seats: 1 },
      expect.anything(),
    );
    expect(ctx.seatInventory.releaseHeld).toHaveBeenCalledTimes(1);
    expect(ctx.seatInventory.releaseHeld).toHaveBeenCalledWith(
      { flightId: FLIGHT_ID, category: 'ECONOMY', seats: 3 },
      expect.anything(),
    );
  });

  it('records the moderator, the reason and a 100% refund on each cancelled booking', async () => {
    const paid = booking(BookingStatus.CONFIRMED);
    const ctx = setup({ bookings: [paid] });

    await ctx.service.cancel(
      FLIGHT_ID.toString(),
      { confirm: true, reason: 'Aircraft unavailable' },
      moderator,
    );

    const call = ctx.bookingModel.findOneAndUpdate.mock.calls[0] as unknown as [
      object,
      { $set: { status: string; cancellation: Record<string, unknown> } },
    ];
    expect(call[0]).toEqual({ _id: paid._id, status: BookingStatus.CONFIRMED });
    expect(call[1].$set.status).toBe('CANCELLED');
    expect(call[1].$set.cancellation).toMatchObject({
      cancelledBy: MODERATOR_ID,
      reason: 'Aircraft unavailable',
      refundPercentage: 100,
      refundId: null,
    });
    expect(String(call[1].$set.cancellation.refundAmount)).toBe('400.00');
  });

  it('asks payments for a PROVIDER refund of 100% and stores the refund on the booking', async () => {
    const paid = booking(BookingStatus.CONFIRMED);
    const ctx = setup({ bookings: [paid] });

    await ctx.service.cancel(
      FLIGHT_ID.toString(),
      { confirm: true },
      moderator,
    );

    expect(ctx.issueForCancellation).toHaveBeenCalledWith({
      bookingType: 'FLIGHT',
      bookingId: paid._id.toString(),
      cancelledBy: CancelledBy.PROVIDER,
      refundPercentage: 100,
      reason: 'Flight cancelled by the airline',
      policySnapshot: null,
    });
    expect(ctx.bookingModel.updateOne).toHaveBeenCalledTimes(1);
  });

  it('notifies every passenger whose booking was cancelled, not the released holds', async () => {
    const paid = booking(BookingStatus.CONFIRMED);
    const hold = booking(BookingStatus.PENDING_PAYMENT);
    const ctx = setup({ bookings: [paid, hold] });

    await ctx.service.cancel(
      FLIGHT_ID.toString(),
      { confirm: true },
      moderator,
    );

    const notices = (
      ctx.notifications.notifyMany.mock.calls[0] as unknown as [
        { userId: Types.ObjectId; type: string; resourceId: string }[],
      ]
    )[0];
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      userId: paid.userId,
      type: 'FLIGHT_CANCELLED',
      resourceId: paid._id.toString(),
    });
  });

  it('keeps the cancellation when one refund fails and counts it', async () => {
    const first = booking(BookingStatus.CONFIRMED);
    const second = booking(BookingStatus.CONFIRMED);
    const ctx = setup({
      bookings: [first, second],
      refundFails: [first._id],
    });

    const result = await ctx.service.cancel(
      FLIGHT_ID.toString(),
      { confirm: true },
      moderator,
    );

    expect(result).toMatchObject({
      cancelledBookings: 2,
      refundsRequested: 1,
      refundsFailed: 1,
    });
    expect(ctx.notifications.notifyMany).toHaveBeenCalledTimes(1);
  });

  it('skips a booking the user cancelled a moment ago and gives its seats back only once', async () => {
    const mine = booking(BookingStatus.CONFIRMED);
    const gone = booking(BookingStatus.CONFIRMED);
    const ctx = setup({ bookings: [mine, gone], lost: [gone._id] });

    const result = await ctx.service.cancel(
      FLIGHT_ID.toString(),
      { confirm: true },
      moderator,
    );

    expect(result.cancelledBookings).toBe(1);
    expect(ctx.seatInventory.releaseBooked).toHaveBeenCalledTimes(1);
    expect(ctx.issueForCancellation).toHaveBeenCalledTimes(1);
  });

  it('cancels a flight with no bookings without asking payments or sending notices', async () => {
    const ctx = setup();

    const result = await ctx.service.cancel(
      FLIGHT_ID.toString(),
      { confirm: true },
      moderator,
    );

    expect(result).toMatchObject({ cancelledBookings: 0, releasedHolds: 0 });
    expect(ctx.issueForCancellation).not.toHaveBeenCalled();
    expect(ctx.notifications.notifyMany).not.toHaveBeenCalled();
  });

  it('refuses a moderator with no airline before reading anything else', async () => {
    const ctx = setup({ assignedTo: null });

    const error = await failure(
      ctx.service.cancel(FLIGHT_ID.toString(), { confirm: true }, moderator),
    );

    expect(error.getStatus()).toBe(403);
    expect(codeOf(error)).toBe('NO_AIRLINE_ASSIGNED');
    expect(ctx.flightModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses a deactivated airline', async () => {
    const ctx = setup({ airlineStatus: AirlineStatus.DEACTIVATED });

    const error = await failure(
      ctx.service.cancel(FLIGHT_ID.toString(), { confirm: true }, moderator),
    );

    expect(error.getStatus()).toBe(403);
    expect(codeOf(error)).toBe('AIRLINE_DEACTIVATED');
    expect(ctx.flightModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('answers 404 for an id that is not an ObjectId, without touching the database', async () => {
    const ctx = setup();

    const error = await failure(
      ctx.service.cancel('nope', { confirm: true }, moderator),
    );

    expect(error.getStatus()).toBe(404);
    expect(codeOf(error)).toBe('FLIGHT_NOT_FOUND');
    expect(ctx.flightModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("answers 404 for a flight of another airline (it is not the moderator's)", async () => {
    const ctx = setup({ transitioned: null, current: null });

    const error = await failure(
      ctx.service.cancel(FLIGHT_ID.toString(), { confirm: true }, moderator),
    );

    expect(error.getStatus()).toBe(404);
    expect(codeOf(error)).toBe('FLIGHT_NOT_FOUND');
    expect(ctx.flightModel.findOne).toHaveBeenCalledWith({
      _id: FLIGHT_ID,
      airlineId: AIRLINE_ID,
    });
  });

  it('answers 409 FLIGHT_ALREADY_CANCELLED for a cancelled flight and changes nothing', async () => {
    const ctx = setup({
      transitioned: null,
      current: flight({ status: FlightStatus.CANCELLED }),
      bookings: [booking(BookingStatus.CONFIRMED)],
    });

    const error = await failure(
      ctx.service.cancel(FLIGHT_ID.toString(), { confirm: true }, moderator),
    );

    expect(error.getStatus()).toBe(409);
    expect(codeOf(error)).toBe('FLIGHT_ALREADY_CANCELLED');
    expect(ctx.seatInventory.releaseBooked).not.toHaveBeenCalled();
    expect(ctx.issueForCancellation).not.toHaveBeenCalled();
  });

  it('answers 409 FLIGHT_ALREADY_DEPARTED for a DEPARTED flight', async () => {
    const ctx = setup({
      transitioned: null,
      current: flight({ status: FlightStatus.DEPARTED }),
    });

    const error = await failure(
      ctx.service.cancel(FLIGHT_ID.toString(), { confirm: true }, moderator),
    );

    expect(error.getStatus()).toBe(409);
    expect(codeOf(error)).toBe('FLIGHT_ALREADY_DEPARTED');
  });

  it('answers 409 FLIGHT_ALREADY_DEPARTED for a SCHEDULED flight whose departure has passed', async () => {
    const ctx = setup({
      transitioned: null,
      current: flight({
        status: FlightStatus.SCHEDULED,
        departureAtUtc: new Date(Date.now() - HOUR),
      }),
    });

    const error = await failure(
      ctx.service.cancel(FLIGHT_ID.toString(), { confirm: true }, moderator),
    );

    expect(codeOf(error)).toBe('FLIGHT_ALREADY_DEPARTED');
  });

  it('answers 409 FLIGHT_CHANGED when a still-valid flight lost a race', async () => {
    const ctx = setup({
      transitioned: null,
      current: flight({ status: FlightStatus.SCHEDULED }),
    });

    const error = await failure(
      ctx.service.cancel(FLIGHT_ID.toString(), { confirm: true }, moderator),
    );

    expect(error.getStatus()).toBe(409);
    expect(codeOf(error)).toBe('FLIGHT_CHANGED');
  });
});
