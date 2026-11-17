// The flight booking summary and hold (FLT-19, FLT-21, FLT-22) against the real app and
// the shared database. This test WRITES: one airline named "KE e2e booking" with an unused
// two-digit IATA code (from 50 up, so it never races the search test, which starts at 00),
// flights numbered KE6xxx in February 2099, test_c2_ accounts made by the shared helper,
// and the bookings of those accounts. afterAll deletes exactly those.
import { ConflictException, INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { Role } from './../src/common/auth/auth.enums';
import {
  Airline,
  AirlineStatus,
} from './../src/flights/schemas/airline.schema';
import {
  BookingStatus,
  FlightBooking,
} from './../src/flights/schemas/flight-booking.schema';
import {
  CabinCategory,
  Flight,
  FlightStatus,
} from './../src/flights/schemas/flight.schema';
import { SeatInventoryService } from './../src/flights/seat-inventory/seat-inventory.service';
import {
  createSignedInUser,
  deleteTestUsers,
  SignedInUser,
} from './support/auth-test-helper';

// Atlas, account registration over HTTP and index builds all happen in beforeAll.
const CONNECT_TIMEOUT_MS = 120_000;
const SLOW_MS = 30_000;

const SUMMARY = '/api/flight-bookings';
const HOLD = '/api/flight-bookings/hold';

describe('Flight bookings (e2e, shared database)', () => {
  let app: INestApplication<App>;
  let airlineModel: Model<Airline>;
  let flightModel: Model<Flight>;
  let bookingModel: Model<FlightBooking>;
  const userIds: string[] = [];
  const flightIds: Types.ObjectId[] = [];
  let airlineId: Types.ObjectId;
  let traveller: SignedInUser;
  let moderator: SignedInUser;
  let outboundId: string;
  let fullReturnId: string;
  let returnId: string;

  async function unusedIataCode(): Promise<string> {
    for (let n = 50; n < 100; n++) {
      const code = String(n);
      if (!(await airlineModel.exists({ iataCode: code }).exec())) {
        return code;
      }
    }
    throw new Error('No unused two-digit IATA code for the test airline');
  }

  // A SCHEDULED flight with one ECONOMY cabin. CAI is UTC+2 and DXB UTC+4 in February.
  async function createFlight(
    fields: Partial<Flight> & { totalSeats: number; bookedSeats?: number },
  ): Promise<string> {
    const { totalSeats, bookedSeats = 0, ...rest } = fields;
    const flight = await flightModel.create({
      airlineId,
      flightNumber: `KE6${String(flightIds.length + 1).padStart(3, '0')}`,
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureLocalInput: '2099-02-10T08:30',
      arrivalLocalInput: '2099-02-10T14:30',
      departureAtUtc: new Date('2099-02-10T06:30:00Z'),
      arrivalAtUtc: new Date('2099-02-10T10:30:00Z'),
      departureDateKey: '2099-02-10',
      status: FlightStatus.SCHEDULED,
      cabinInventory: [
        {
          category: CabinCategory.ECONOMY,
          totalSeats,
          bookedSeats,
          heldSeats: 0,
          price: Types.Decimal128.fromString('200.00'),
          freeBaggageCount: 1,
          maxBagWeightKg: 23,
        },
      ],
      ...rest,
    });
    flightIds.push(flight._id);
    return flight._id.toString();
  }

  // The way back, DXB -> CAI on 15 or 16 February 2099.
  function returnFields(day: number): Partial<Flight> {
    return {
      departureAirportId: 'DXB',
      arrivalAirportId: 'CAI',
      departureLocalInput: `2099-02-${day}T16:00`,
      arrivalLocalInput: `2099-02-${day}T18:00`,
      departureAtUtc: new Date(`2099-02-${day}T12:00:00Z`),
      arrivalAtUtc: new Date(`2099-02-${day}T16:00:00Z`),
      departureDateKey: `2099-02-${day}`,
    };
  }

  async function heldSeats(flightId: string): Promise<number> {
    const flight = await flightModel.findById(flightId).lean<Flight>().exec();
    return flight?.cabinInventory[0].heldSeats ?? -1;
  }

  function passenger(overrides: Record<string, unknown> = {}) {
    return {
      fullName: 'KE e2e Traveller',
      dateOfBirth: '1990-05-14',
      passengerType: 'ADULT',
      documentNumber: 'KE1234567',
      ...overrides,
    };
  }

  const infant = passenger({
    fullName: 'KE e2e Baby',
    dateOfBirth: '2098-06-01',
    passengerType: 'INFANT',
  });

  function oneWay(
    passengers: Record<string, unknown>[],
    flightId = outboundId,
  ) {
    return { outbound: { flightId, cabin: 'ECONOMY' }, passengers };
  }

  function post(path: string, body: unknown, user = traveller) {
    return request(app.getHttpServer())
      .post(path)
      .set('Cookie', user.cookie)
      .send(body as object);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    airlineModel = app.get<Model<Airline>>(getModelToken(Airline.name));
    flightModel = app.get<Model<Flight>>(getModelToken(Flight.name));
    bookingModel = app.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );

    const airline = await airlineModel.create({
      name: 'KE e2e booking',
      iataCode: await unusedIataCode(),
      status: AirlineStatus.ACTIVE,
      createdBy: new Types.ObjectId(),
    });
    airlineId = airline._id;

    outboundId = await createFlight({ totalSeats: 5 });
    fullReturnId = await createFlight({
      totalSeats: 2,
      bookedSeats: 2,
      ...returnFields(15),
    });
    returnId = await createFlight({ totalSeats: 5, ...returnFields(16) });

    traveller = await createSignedInUser(app, { label: 'ke-booking' });
    moderator = await createSignedInUser(app, {
      label: 'ke-booking-mod',
      role: Role.AIRLINE_MODERATOR,
    });
    userIds.push(traveller.userId, moderator.userId);
  }, CONNECT_TIMEOUT_MS);

  // Deletes only what this file created, then closes the app and the connection.
  afterAll(async () => {
    await bookingModel
      .deleteMany({
        userId: { $in: userIds.map((id) => new Types.ObjectId(id)) },
      })
      .exec();
    await flightModel.deleteMany({ _id: { $in: flightIds } }).exec();
    await airlineModel.deleteMany({ _id: airlineId }).exec();
    await deleteTestUsers(app, userIds);
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('who may book', () => {
    it('needs a login', async () => {
      const res = await request(app.getHttpServer())
        .post(SUMMARY)
        .send(oneWay([passenger()]))
        .expect(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    it('is for travellers only: a moderator gets 403', async () => {
      const res = await post(SUMMARY, oneWay([passenger()]), moderator).expect(
        403,
      );
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  describe('POST /api/flight-bookings (summary)', () => {
    it(
      'prices the booking and stores nothing',
      async () => {
        const res = await post(
          SUMMARY,
          oneWay([passenger(), passenger({ fullName: 'KE e2e Two' }), infant]),
        ).expect(200);

        expect(res.body.segments[0]).toMatchObject({
          flightId: outboundId,
          departureLocalTime: '2099-02-10T08:30:00+02:00',
          arrivalLocalTime: '2099-02-10T14:30:00+04:00',
          pricePerSeat: '200.00',
        });
        expect(
          res.body.passengers.map((p: { fare: string }) => p.fare),
        ).toEqual(['200.00', '200.00', '20.00']);
        expect(res.body.passengers[0].documentNumber).toBe('•••••4567');
        expect(res.body.price).toEqual({
          subtotal: '420.00',
          baggageTotal: '0.00',
          total: '420.00',
          currency: 'USD',
        });
        expect(await heldSeats(outboundId)).toBe(0);
        expect(
          await bookingModel.countDocuments({ userId: traveller.userId }),
        ).toBe(0);
      },
      SLOW_MS,
    );

    it('reports a full return flight before anything is held', async () => {
      const res = await post(SUMMARY, {
        tripType: 'ROUND_TRIP',
        outbound: { flightId: outboundId, cabin: 'ECONOMY' },
        inbound: { flightId: fullReturnId, cabin: 'ECONOMY' },
        passengers: [passenger()],
      }).expect(409);

      expect(res.body).toMatchObject({
        code: 'SEAT_UNAVAILABLE',
        message: 'No seats left in ECONOMY',
        errors: [{ field: 'inbound.cabin' }],
      });
    });
  });

  describe('POST /api/flight-bookings/hold', () => {
    it(
      'holds a seat per adult and child for 10 minutes',
      async () => {
        const before = Date.now();
        const res = await post(
          HOLD,
          oneWay([passenger(), passenger({ fullName: 'KE e2e Two' }), infant]),
        ).expect(201);

        expect(res.body).toMatchObject({
          status: BookingStatus.PENDING_PAYMENT,
          bookingReference: null,
          price: { total: '420.00' },
        });
        const expires = new Date(res.body.holdExpiresAt as string).getTime();
        expect(expires - before).toBeGreaterThanOrEqual(10 * 60_000 - 1_000);
        expect(expires - before).toBeLessThanOrEqual(10 * 60_000 + 30_000);
        // Two seats: the infant sits on a lap.
        expect(await heldSeats(outboundId)).toBe(2);

        const stored = await bookingModel
          .findById(res.body.id)
          .lean<FlightBooking>()
          .exec();
        // The owner is a real ObjectId, so ownerFilter's string id finds it (ACC-11).
        expect(stored?.userId).toBeInstanceOf(Types.ObjectId);
        expect(stored?.userId.toString()).toBe(traveller.userId);
        expect(stored?.segments[0].seatsRequired).toBe(2);
      },
      SLOW_MS,
    );

    it(
      'holds nothing on either flight when the second one cannot be held',
      async () => {
        const seats = app.get(SeatInventoryService);
        const realHold = seats.hold.bind(seats);
        let calls = 0;
        // The quote passes; the second hold fails as if the seats had just gone.
        jest.spyOn(seats, 'hold').mockImplementation((change, session) => {
          calls += 1;
          return calls === 2
            ? Promise.reject(
                new ConflictException({
                  code: 'SEAT_UNAVAILABLE',
                  message: 'No seats left in ECONOMY',
                }),
              )
            : realHold(change, session);
        });
        const heldBefore = await heldSeats(outboundId);
        const bookingsBefore = await bookingModel.countDocuments({
          userId: traveller.userId,
        });

        await post(HOLD, {
          tripType: 'ROUND_TRIP',
          outbound: { flightId: outboundId, cabin: 'ECONOMY' },
          inbound: { flightId: returnId, cabin: 'ECONOMY' },
          passengers: [passenger()],
        }).expect(409);

        // The outbound seat held in the same transaction was rolled back.
        expect(await heldSeats(outboundId)).toBe(heldBefore);
        expect(await heldSeats(returnId)).toBe(0);
        expect(
          await bookingModel.countDocuments({ userId: traveller.userId }),
        ).toBe(bookingsBefore);
      },
      SLOW_MS,
    );

    it(
      'never holds more seats than are free when requests arrive together',
      async () => {
        // 5 seats, 2 held by the first test: 3 left for 6 parallel requests.
        const free = 5 - (await heldSeats(outboundId));
        const results = await Promise.all(
          Array.from({ length: 6 }, () => post(HOLD, oneWay([passenger()]))),
        );
        const statuses = results.map((res) => res.status);

        expect(statuses.filter((status) => status === 201)).toHaveLength(free);
        expect(statuses.filter((status) => status === 409)).toHaveLength(
          6 - free,
        );
        expect(await heldSeats(outboundId)).toBe(5);
      },
      SLOW_MS,
    );
  });
});
