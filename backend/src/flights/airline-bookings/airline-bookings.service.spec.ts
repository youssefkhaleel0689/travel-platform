import { HttpException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { Role } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { BookingStatus } from '../../common/bookings/booking-status';
import { AirlineModeratorAssignment } from '../schemas/airline-moderator-assignment.schema';
import { FlightBooking, PassengerType } from '../schemas/flight-booking.schema';
import { CabinCategory, Flight, FlightStatus } from '../schemas/flight.schema';
import { AirlineBookingsService } from './airline-bookings.service';

const AIRLINE_ID = new Types.ObjectId();
const FLIGHT_ID = new Types.ObjectId();
const OTHER_FLIGHT_ID = new Types.ObjectId();
const MODERATOR_ID = new Types.ObjectId().toString();

const moderator: AuthenticatedUser = {
  userId: MODERATOR_ID,
  role: Role.AIRLINE_MODERATOR,
  sessionId: new Types.ObjectId().toString(),
};

const FLIGHT = {
  _id: FLIGHT_ID,
  airlineId: AIRLINE_ID,
  flightNumber: 'MS777',
  departureAirportId: 'CAI',
  arrivalAirportId: 'DXB',
  departureAtUtc: new Date('2026-12-20T06:30:00.000Z'),
  arrivalAtUtc: new Date('2026-12-20T10:30:00.000Z'),
  departureDateKey: '2026-12-20',
  status: FlightStatus.SCHEDULED,
  cabinInventory: [
    {
      category: CabinCategory.ECONOMY,
      totalSeats: 150,
      bookedSeats: 40,
      heldSeats: 2,
    },
    {
      category: CabinCategory.BUSINESS,
      totalSeats: 20,
      bookedSeats: 20,
      heldSeats: 0,
    },
  ],
};

function booking(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    bookingReference: 'K7M2QX',
    status: BookingStatus.CONFIRMED,
    confirmedAt: new Date('2026-11-18T09:15:00.000Z'),
    cancelledAt: null,
    passengers: [
      {
        _id: new Types.ObjectId(),
        fullName: 'Amira Hassan',
        dateOfBirth: '1990-05-04',
        passengerType: PassengerType.ADULT,
        documentNumber: 'A1234567',
        seatRequired: true,
      },
      {
        _id: new Types.ObjectId(),
        fullName: '=HYPERLINK("x")',
        dateOfBirth: '2025-08-01',
        passengerType: PassengerType.INFANT,
        documentNumber: 'B7654321',
        seatRequired: false,
      },
    ],
    segments: [
      // A round trip: the other segment is another flight and must be ignored.
      {
        flightId: OTHER_FLIGHT_ID,
        cabinCategory: CabinCategory.BUSINESS,
        seatsRequired: 1,
      },
      {
        flightId: FLIGHT_ID,
        cabinCategory: CabinCategory.ECONOMY,
        seatsRequired: 1,
      },
    ],
    ...overrides,
  };
}

// A query stand-in: every chained call returns the chain and exec() resolves the result.
function query<R>(result: R) {
  const chain = {
    select: () => chain,
    sort: () => chain,
    skip: () => chain,
    limit: () => chain,
    lean: () => chain,
    exec: () => Promise.resolve(result),
  };
  return chain;
}

function setup(
  options: {
    assignedTo?: Types.ObjectId | null;
    flight?: object | null;
    bookings?: object[];
    total?: number;
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
  const flightModel = {
    findOne: jest.fn(() =>
      query(options.flight === undefined ? FLIGHT : options.flight),
    ),
  };
  const bookingModel = {
    find: jest.fn(() => query(bookings)),
    countDocuments: jest.fn(() => query(options.total ?? bookings.length)),
  };
  const service = new AirlineBookingsService(
    flightModel as unknown as Model<Flight>,
    bookingModel as unknown as Model<FlightBooking>,
    assignmentModel as unknown as Model<AirlineModeratorAssignment>,
  );
  return { service, flightModel, bookingModel, assignmentModel };
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

describe('AirlineBookingsService.list (FLT-29)', () => {
  it('returns the flight, the seats remaining per cabin and the booking rows', async () => {
    const { service } = setup({ bookings: [booking()], total: 1 });

    const result = await service.list(
      FLIGHT_ID.toString(),
      { page: 1 },
      moderator,
    );

    expect(result.flight).toEqual({
      id: FLIGHT_ID.toString(),
      flightNumber: 'MS777',
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureAtUtc: '2026-12-20T06:30:00.000Z',
      arrivalAtUtc: '2026-12-20T10:30:00.000Z',
      status: 'SCHEDULED',
    });
    expect(result.seats).toEqual([
      {
        category: 'ECONOMY',
        totalSeats: 150,
        bookedSeats: 40,
        heldSeats: 2,
        remainingSeats: 108,
      },
      {
        category: 'BUSINESS',
        totalSeats: 20,
        bookedSeats: 20,
        heldSeats: 0,
        remainingSeats: 0,
      },
    ]);
    expect(result.bookings.meta).toMatchObject({
      page: 1,
      pageSize: 10,
      totalItems: 1,
      totalPages: 1,
    });
    expect(result.bookings.items).toHaveLength(1);
    expect(result.bookings.items[0]).toMatchObject({
      bookingReference: 'K7M2QX',
      status: 'CONFIRMED',
      cabin: 'ECONOMY',
      seats: 1,
      passengerCount: 2,
      passengers: [
        { fullName: 'Amira Hassan', passengerType: 'ADULT' },
        { fullName: '=HYPERLINK("x")', passengerType: 'INFANT' },
      ],
      confirmedAt: '2026-11-18T09:15:00.000Z',
      cancelledAt: null,
    });
  });

  it('never returns document numbers or the buyer', async () => {
    const { service } = setup({ bookings: [booking()] });

    const result = await service.list(
      FLIGHT_ID.toString(),
      { page: 1 },
      moderator,
    );

    const text = JSON.stringify(result);
    expect(text).not.toContain('A1234567');
    expect(text).not.toContain('documentNumber');
    expect(text).not.toContain('userId');
  });

  it('shows the cabin and seats of THIS flight on a round trip', async () => {
    const { service } = setup({ bookings: [booking()] });

    const result = await service.list(
      FLIGHT_ID.toString(),
      { page: 1 },
      moderator,
    );

    expect(result.bookings.items[0].cabin).toBe('ECONOMY');
  });

  it('shows a cancelled booking with its cancellation time', async () => {
    const cancelledAt = new Date('2026-11-19T08:00:00.000Z');
    const { service } = setup({
      bookings: [booking({ status: BookingStatus.CANCELLED, cancelledAt })],
    });

    const result = await service.list(
      FLIGHT_ID.toString(),
      { page: 1 },
      moderator,
    );

    expect(result.bookings.items[0]).toMatchObject({
      status: 'CANCELLED',
      cancelledAt: '2026-11-19T08:00:00.000Z',
    });
  });

  it('lists CONFIRMED, COMPLETED and CANCELLED bookings of the flight by default', async () => {
    const { service, bookingModel } = setup();

    await service.list(FLIGHT_ID.toString(), { page: 1 }, moderator);

    expect(bookingModel.find).toHaveBeenCalledWith({
      'segments.flightId': FLIGHT_ID,
      status: {
        $in: [
          BookingStatus.CONFIRMED,
          BookingStatus.COMPLETED,
          BookingStatus.CANCELLED,
        ],
      },
    });
  });

  it('filters by one status when asked', async () => {
    const { service, bookingModel } = setup();

    await service.list(
      FLIGHT_ID.toString(),
      { page: 1, status: BookingStatus.CANCELLED },
      moderator,
    );

    expect(bookingModel.find).toHaveBeenCalledWith({
      'segments.flightId': FLIGHT_ID,
      status: BookingStatus.CANCELLED,
    });
  });

  it('pages with page size 10', async () => {
    const { service } = setup({ bookings: [booking()], total: 25 });

    const result = await service.list(
      FLIGHT_ID.toString(),
      { page: 2 },
      moderator,
    );

    expect(result.bookings.meta).toMatchObject({
      page: 2,
      totalItems: 25,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  it('looks the flight up with the assigned airline in the filter', async () => {
    const { service, flightModel } = setup();

    await service.list(FLIGHT_ID.toString(), { page: 1 }, moderator);

    expect(flightModel.findOne).toHaveBeenCalledWith({
      _id: FLIGHT_ID,
      airlineId: AIRLINE_ID,
    });
  });

  it("answers 404 FLIGHT_NOT_FOUND for another airline's or a missing flight", async () => {
    const { service } = setup({ flight: null });

    const error = await failure(
      service.list(FLIGHT_ID.toString(), { page: 1 }, moderator),
    );

    expect(error.getStatus()).toBe(404);
    expect(codeOf(error)).toBe('FLIGHT_NOT_FOUND');
  });

  it('answers 404 for a malformed id without querying flights', async () => {
    const { service, flightModel } = setup();

    const error = await failure(
      service.list('not-an-id', { page: 1 }, moderator),
    );

    expect(error.getStatus()).toBe(404);
    expect(flightModel.findOne).not.toHaveBeenCalled();
  });

  it('answers 403 NO_AIRLINE_ASSIGNED for a moderator without an airline', async () => {
    const { service, flightModel } = setup({ assignedTo: null });

    const error = await failure(
      service.list(FLIGHT_ID.toString(), { page: 1 }, moderator),
    );

    expect(error.getStatus()).toBe(403);
    expect(codeOf(error)).toBe('NO_AIRLINE_ASSIGNED');
    expect(flightModel.findOne).not.toHaveBeenCalled();
  });
});

describe('AirlineBookingsService.exportPassengers (FLT-29)', () => {
  it('writes one row per passenger of the paid bookings, without document numbers', async () => {
    const { service } = setup({ bookings: [booking()] });

    const result = await service.exportPassengers(
      FLIGHT_ID.toString(),
      moderator,
    );

    expect(result.filename).toBe('passengers-MS777-2026-12-20.csv');
    expect(result.csv).toBe(
      '﻿Booking reference,Passenger name,Passenger type,Date of birth,Cabin,Needs a seat,Booking status\r\n' +
        'K7M2QX,Amira Hassan,ADULT,1990-05-04,ECONOMY,YES,CONFIRMED\r\n' +
        // The name starts with "=": defused so a spreadsheet does not run it as a formula.
        'K7M2QX,"\'=HYPERLINK(""x"")",INFANT,2025-08-01,ECONOMY,NO,CONFIRMED\r\n',
    );
    expect(result.csv).not.toContain('A1234567');
  });

  it('asks only for CONFIRMED and COMPLETED bookings of the flight', async () => {
    const { service, bookingModel } = setup();

    await service.exportPassengers(FLIGHT_ID.toString(), moderator);

    expect(bookingModel.find).toHaveBeenCalledWith({
      'segments.flightId': FLIGHT_ID,
      status: { $in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] },
    });
  });

  it('writes only the header when nobody is booked', async () => {
    const { service } = setup({ bookings: [] });

    const result = await service.exportPassengers(
      FLIGHT_ID.toString(),
      moderator,
    );

    expect(result.csv).toBe(
      '﻿Booking reference,Passenger name,Passenger type,Date of birth,Cabin,Needs a seat,Booking status\r\n',
    );
  });

  it('answers 404 for a flight of another airline', async () => {
    const { service } = setup({ flight: null });

    const error = await failure(
      service.exportPassengers(FLIGHT_ID.toString(), moderator),
    );

    expect(error.getStatus()).toBe(404);
    expect(codeOf(error)).toBe('FLIGHT_NOT_FOUND');
  });

  it('answers 403 NO_AIRLINE_ASSIGNED without an assignment', async () => {
    const { service } = setup({ assignedTo: null });

    const error = await failure(
      service.exportPassengers(FLIGHT_ID.toString(), moderator),
    );

    expect(error.getStatus()).toBe(403);
    expect(codeOf(error)).toBe('NO_AIRLINE_ASSIGNED');
  });
});
