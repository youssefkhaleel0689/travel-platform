// The flight booking summary, hold and payments port (FLT-19, FLT-21, FLT-22, GEN-11)
// against the real app and the shared database. This test WRITES: one airline named "KE e2e booking" with an unused
// two-digit IATA code (from 50 up, so it never races the search test, which starts at 00),
// flights numbered KE6xxx in February 2099, test_c2_ accounts made by the shared helper,
// and the bookings of those accounts. afterAll deletes exactly those.
import {
  ConflictException,
  HttpException,
  INestApplication,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { Role } from './../src/common/auth/auth.enums';
import { BookingType } from './../src/common/bookings/booking-status';
import { BookingsGateway } from './../src/common/bookings/bookings.gateway';
import { HoldReleaseReason } from './../src/common/bookings/bookings.port';
import { AirlinePolicy } from './../src/flights/schemas/airline-policy.schema';
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
import { FlightHoldExpiryService } from './../src/flights/flight-bookings/flight-hold-expiry.service';
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
const bookingPath = (id: string) => `/api/flight-bookings/${id}`;
// No 0, O, 1 or I: they are easy to misread on a ticket.
const REFERENCE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

describe('Flight bookings (e2e, shared database)', () => {
  let app: INestApplication<App>;
  let airlineModel: Model<Airline>;
  let policyModel: Model<AirlinePolicy>;
  let flightModel: Model<Flight>;
  let bookingModel: Model<FlightBooking>;
  const userIds: string[] = [];
  const flightIds: Types.ObjectId[] = [];
  let airlineId: Types.ObjectId;
  let traveller: SignedInUser;
  let otherTraveller: SignedInUser;
  let moderator: SignedInUser;
  let outboundId: string;
  let fullReturnId: string;
  let returnId: string;
  // Its own flight, so the port tests never share seats with the hold tests.
  let portFlightId: string;

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

  async function seatCounts(
    flightId: string,
  ): Promise<{ held: number; booked: number }> {
    const flight = await flightModel.findById(flightId).lean<Flight>().exec();
    const cabin = flight?.cabinInventory[0];
    return { held: cabin?.heldSeats ?? -1, booked: cabin?.bookedSeats ?? -1 };
  }

  async function storedBooking(id: string): Promise<FlightBooking | null> {
    return bookingModel.findById(id).lean<FlightBooking>().exec();
  }

  // The HTTP error a call to the port failed with.
  async function failure(promise: Promise<unknown>): Promise<HttpException> {
    try {
      await promise;
    } catch (error) {
      return error as HttpException;
    }
    throw new Error('expected the call to fail');
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

  function get(path: string, user = traveller) {
    return request(app.getHttpServer()).get(path).set('Cookie', user.cookie);
  }

  // GET /api/flight-bookings/:id/e-ticket with the PDF collected as a Buffer: supertest
  // only buffers text and JSON bodies by itself.
  function eTicket(id: string, user = traveller) {
    return get(`${bookingPath(id)}/e-ticket`, user)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    airlineModel = app.get<Model<Airline>>(getModelToken(Airline.name));
    policyModel = app.get<Model<AirlinePolicy>>(
      getModelToken(AirlinePolicy.name),
    );
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
    portFlightId = await createFlight({ totalSeats: 5 });

    traveller = await createSignedInUser(app, { label: 'ke-booking' });
    otherTraveller = await createSignedInUser(app, {
      label: 'ke-booking-other',
    });
    moderator = await createSignedInUser(app, {
      label: 'ke-booking-mod',
      role: Role.AIRLINE_MODERATOR,
    });
    userIds.push(traveller.userId, otherTraveller.userId, moderator.userId);
  }, CONNECT_TIMEOUT_MS);

  // Deletes only what this file created, then closes the app and the connection.
  afterAll(async () => {
    await bookingModel
      .deleteMany({
        userId: { $in: userIds.map((id) => new Types.ObjectId(id)) },
      })
      .exec();
    await flightModel.deleteMany({ _id: { $in: flightIds } }).exec();
    await policyModel.deleteMany({ airlineId }).exec();
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

  describe('a held booking: GET /api/flight-bookings/:id and the payments port', () => {
    let gateway: BookingsGateway;
    let held: { id: string } & Record<string, unknown>;

    beforeAll(async () => {
      gateway = app.get(BookingsGateway);
      const res = await post(HOLD, oneWay([passenger()], portFlightId)).expect(
        201,
      );
      held = res.body as typeof held;
    }, SLOW_MS);

    it('shows the owner their booking, exactly as the hold returned it', async () => {
      const res = await get(bookingPath(held.id)).expect(200);

      expect(res.body).toEqual(held);
    });

    it("answers the same 404 for another account's booking, a missing one and a bad id", async () => {
      const responses = [
        await get(bookingPath(held.id), otherTraveller).expect(404),
        await get(bookingPath(new Types.ObjectId().toString())).expect(404),
        await get(bookingPath('not-an-id')).expect(404),
      ];

      for (const res of responses) {
        expect(res.body).toMatchObject({
          code: 'BOOKING_NOT_FOUND',
          message: 'Booking not found',
        });
      }
    });

    it('is connected to payments: the flight port is wired in', () => {
      expect(gateway.supports(BookingType.FLIGHT)).toBe(true);
    });

    it("gives payments' policies endpoint the terms the booking was made under (PAY-02)", async () => {
      const res = await get(`/api/bookings/flight/${held.id}/policies`).expect(
        200,
      );

      // Version 0: the test airline has no policy yet (it gets one at the end).
      expect(res.body).toMatchObject({
        bookingId: held.id,
        bookingType: BookingType.FLIGHT,
        providerType: 'AIRLINE',
        providerId: airlineId.toString(),
        policyVersion: 0,
        policySnapshot: {
          airlineId: airlineId.toString(),
          version: 0,
          extraBagPrice: null,
          maxExtraBagsPerPassenger: null,
          cancellationTiers: [],
        },
        accepted: false,
      });
    });

    it('has no e-ticket before it is paid (FLT-23)', async () => {
      const res = await get(`${bookingPath(held.id)}/e-ticket`).expect(409);

      expect(res.body.code).toBe('TICKET_NOT_AVAILABLE');
    });

    it(
      'confirms after payment once: a reference, and the held seat becomes a booked one',
      async () => {
        const before = await seatCounts(portFlightId);
        const paymentId = new Types.ObjectId().toString();

        const first = await gateway.confirmAfterPayment(
          BookingType.FLIGHT,
          held.id,
          paymentId,
        );
        expect(first).toEqual({
          bookingId: held.id,
          status: BookingStatus.CONFIRMED,
          bookingReference: expect.stringMatching(REFERENCE) as string,
        });
        const after = { held: before.held - 1, booked: before.booked + 1 };
        expect(await seatCounts(portFlightId)).toEqual(after);

        // Stripe delivers the webhook again: the same answer, no seat moves.
        await expect(
          gateway.confirmAfterPayment(BookingType.FLIGHT, held.id, paymentId),
        ).resolves.toEqual(first);
        expect(await seatCounts(portFlightId)).toEqual(after);

        const stored = await storedBooking(held.id);
        expect(stored?.paymentId?.toString()).toBe(paymentId);
        expect(stored?.confirmedAt).toBeInstanceOf(Date);
        const res = await get(bookingPath(held.id)).expect(200);
        expect(res.body).toMatchObject({
          status: BookingStatus.CONFIRMED,
          bookingReference: first.bookingReference,
        });
      },
      SLOW_MS,
    );

    it(
      'lets the owner download the e-ticket once it is confirmed (FLT-23)',
      async () => {
        const reference = (await storedBooking(held.id))?.bookingReference;

        const res = await eTicket(held.id).expect(200);

        expect(res.headers['content-type']).toBe('application/pdf');
        expect(res.headers['content-disposition']).toBe(
          `attachment; filename="e-ticket-${reference}.pdf"`,
        );
        const pdf = res.body as Buffer;
        expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
        expect(pdf.toString('latin1')).toContain(`(E-ticket ${reference})`);
      },
      SLOW_MS,
    );

    it('does not give another account the e-ticket: the same 404 as a missing booking', async () => {
      const res = await get(
        `${bookingPath(held.id)}/e-ticket`,
        otherTraveller,
      ).expect(404);

      expect(res.body.code).toBe('BOOKING_NOT_FOUND');
    });

    it('counts as an upcoming confirmed booking, which blocks deactivation (ACC-12)', async () => {
      await expect(
        gateway.hasUpcomingConfirmedBookings(traveller.userId),
      ).resolves.toBe(true);
      await expect(
        gateway.hasUpcomingConfirmedBookings(otherTraveller.userId),
      ).resolves.toBe(false);
    });

    it('keeps a confirmed booking and its seats when a late release arrives', async () => {
      const before = await seatCounts(portFlightId);

      await gateway.releaseHold(
        BookingType.FLIGHT,
        held.id,
        HoldReleaseReason.HOLD_EXPIRED,
      );

      expect((await storedBooking(held.id))?.status).toBe(
        BookingStatus.CONFIRMED,
      );
      expect(await seatCounts(portFlightId)).toEqual(before);
    });

    it(
      'releases a hold once, however often it is called, and it can no longer be paid',
      async () => {
        const res = await post(
          HOLD,
          oneWay(
            [passenger(), passenger({ fullName: 'KE e2e Two' })],
            portFlightId,
          ),
        ).expect(201);
        const id = (res.body as { id: string }).id;
        const before = await seatCounts(portFlightId);

        // The expiry job and a cancelled-payment webhook can both arrive.
        await gateway.releaseHold(
          BookingType.FLIGHT,
          id,
          HoldReleaseReason.HOLD_EXPIRED,
        );
        await gateway.releaseHold(
          BookingType.FLIGHT,
          id,
          HoldReleaseReason.PAYMENT_FAILED,
        );

        expect(await seatCounts(portFlightId)).toEqual({
          held: before.held - 2,
          booked: before.booked,
        });
        const stored = await storedBooking(id);
        expect(stored?.status).toBe(BookingStatus.EXPIRED);
        expect(stored?.expiredAt).toBeInstanceOf(Date);

        const error = await failure(
          gateway.confirmAfterPayment(
            BookingType.FLIGHT,
            id,
            new Types.ObjectId().toString(),
          ),
        );
        expect(error.getStatus()).toBe(409);
        expect(error.getResponse()).toMatchObject({
          code: 'INVALID_BOOKING_STATE',
        });
      },
      SLOW_MS,
    );
  });

  describe('the hold expiry job (FLT-22)', () => {
    it(
      'expires a hold that ran out and gives its seats back',
      async () => {
        const res = await post(
          HOLD,
          oneWay([passenger()], portFlightId),
        ).expect(201);
        const id = (res.body as { id: string }).id;
        // As if the 10 minutes had passed.
        await bookingModel
          .updateOne(
            { _id: id },
            { $set: { holdExpiresAt: new Date(Date.now() - 1_000) } },
          )
          .exec();
        const before = await seatCounts(portFlightId);

        // What the schedule runs every minute. It may also release other expired
        // holds in the shared database, which is exactly its job.
        const handled = await app.get(FlightHoldExpiryService).releaseExpired();

        expect(handled).toBeGreaterThanOrEqual(1);
        expect((await storedBooking(id))?.status).toBe(BookingStatus.EXPIRED);
        expect(await seatCounts(portFlightId)).toEqual({
          held: before.held - 1,
          booked: before.booked,
        });
      },
      SLOW_MS,
    );
  });

  // Last on purpose: until here the test airline has no policy (version 0).
  describe("with the airline's policy (FLT-08, FLT-09)", () => {
    beforeAll(async () => {
      await policyModel.create({
        airlineId,
        extraBagPrice: Types.Decimal128.fromString('15.00'),
        maxExtraBagsPerPassenger: 2,
        cancellationTiers: [
          { daysBeforeDeparture: 7, refundPercentage: 80 },
          { daysBeforeDeparture: 0, refundPercentage: 0 },
        ],
        version: 3,
        updatedBy: new Types.ObjectId(),
      });
    }, SLOW_MS);

    it('charges extra bags at the airline price', async () => {
      const res = await post(
        SUMMARY,
        oneWay(
          [passenger({ extraBags: { count: 2, weightKg: 20 } })],
          portFlightId,
        ),
      ).expect(200);

      expect(res.body.passengers[0].extraBags).toEqual({
        count: 2,
        weightKg: 20,
        fee: '30.00',
      });
      expect(res.body.price).toEqual({
        subtotal: '200.00',
        baggageTotal: '30.00',
        total: '230.00',
        currency: 'USD',
      });
      expect(res.body.policy).toMatchObject({
        version: 3,
        extraBagPrice: '15.00',
        maxExtraBagsPerPassenger: 2,
      });
    });

    it("refuses more extra bags than the airline's limit", async () => {
      const res = await post(
        SUMMARY,
        oneWay(
          [passenger({ extraBags: { count: 3, weightKg: 20 } })],
          portFlightId,
        ),
      ).expect(400);

      expect(res.body).toMatchObject({
        code: 'EXTRA_BAGS_NOT_ALLOWED',
        errors: [{ field: 'passengers.0.extraBags.count' }],
      });
    });

    it(
      'stores the policy on the hold, and older bookings keep the terms they had',
      async () => {
        const res = await post(
          HOLD,
          oneWay([passenger()], portFlightId),
        ).expect(201);
        const id = (res.body as { id: string }).id;

        const policies = await get(
          `/api/bookings/flight/${id}/policies`,
        ).expect(200);
        expect(policies.body).toMatchObject({
          policyVersion: 3,
          policySnapshot: {
            version: 3,
            extraBagPrice: '15.00',
            cancellationTiers: [
              { daysBeforeDeparture: 7, refundPercentage: 80 },
              { daysBeforeDeparture: 0, refundPercentage: 0 },
            ],
          },
        });

        // A booking made before the airline had a policy still has version 0 (PAY-02).
        const older = await bookingModel
          .findOne({
            userId: traveller.userId,
            'policySnapshot.version': 0,
          })
          .lean<FlightBooking>()
          .exec();
        expect(older).not.toBeNull();
      },
      SLOW_MS,
    );
  });
});
