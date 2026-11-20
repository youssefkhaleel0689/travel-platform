// FLT-27: changing a confirmed flight booking, against the real app and the shared
// database. This test WRITES: one airline named "KE e2e change" with an unused two-digit
// IATA code from 30 up, flights numbered KE7xxx in March 2099, test_c2_ accounts made by
// the shared helper, their bookings, payments and refunds. afterAll deletes exactly those.
// Stripe is never reached for a charge: only same and lower fares are changed here, and a
// lower fare's refund is recorded whatever Stripe answers.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { BookingType } from './../src/common/bookings/booking-status';
import { BookingsGateway } from './../src/common/bookings/bookings.gateway';
import { PaymentStatus } from './../src/payments/payment-status.enum';
import { RefundKind } from './../src/payments/refund-status.enum';
import { Payment } from './../src/payments/schemas/payment.schema';
import { Refund } from './../src/payments/schemas/refund.schema';
import {
  Airline,
  AirlineStatus,
} from './../src/flights/schemas/airline.schema';
import { FlightBooking } from './../src/flights/schemas/flight-booking.schema';
import {
  CabinCategory,
  Flight,
  FlightStatus,
} from './../src/flights/schemas/flight.schema';
import {
  createSignedInUser,
  deleteTestUsers,
  SignedInUser,
} from './support/auth-test-helper';

const CONNECT_TIMEOUT_MS = 120_000;
const SLOW_MS = 30_000;

describe('Changing a confirmed flight (FLT-27, e2e, shared database)', () => {
  let app: INestApplication<App>;
  let airlineModel: Model<Airline>;
  let flightModel: Model<Flight>;
  let bookingModel: Model<FlightBooking>;
  let paymentModel: Model<Payment>;
  let refundModel: Model<Refund>;
  const userIds: string[] = [];
  const flightIds: Types.ObjectId[] = [];
  let airlineId: Types.ObjectId;
  let traveller: SignedInUser;
  let otherTraveller: SignedInUser;
  // CAI -> DXB on 10, 11 and 12 March 2099 at 200, 200 and 150 a seat.
  let firstId: string;
  let samePriceId: string;
  let cheaperId: string;

  async function unusedIataCode(): Promise<string> {
    for (let n = 30; n < 50; n++) {
      if (!(await airlineModel.exists({ iataCode: String(n) }).exec())) {
        return String(n);
      }
    }
    throw new Error('No unused two-digit IATA code for the test airline');
  }

  async function createFlight(day: number, price: string): Promise<string> {
    const flight = await flightModel.create({
      airlineId,
      flightNumber: `KE7${String(flightIds.length + 1).padStart(3, '0')}`,
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureLocalInput: `2099-03-${day}T08:30`,
      arrivalLocalInput: `2099-03-${day}T14:30`,
      departureAtUtc: new Date(`2099-03-${day}T06:30:00Z`),
      arrivalAtUtc: new Date(`2099-03-${day}T10:30:00Z`),
      departureDateKey: `2099-03-${day}`,
      status: FlightStatus.SCHEDULED,
      cabinInventory: [
        {
          category: CabinCategory.ECONOMY,
          totalSeats: 10,
          bookedSeats: 0,
          heldSeats: 0,
          price: Types.Decimal128.fromString(price),
          freeBaggageCount: 1,
          maxBagWeightKg: 23,
        },
      ],
    });
    flightIds.push(flight._id);
    return flight._id.toString();
  }

  async function booked(flightId: string): Promise<number> {
    const flight = await flightModel.findById(flightId).lean<Flight>().exec();
    return flight?.cabinInventory[0].bookedSeats ?? -1;
  }

  // A one-adult booking on the flight, paid and confirmed the way the Stripe webhook
  // does it: a SUCCEEDED payment, then the payments port.
  async function confirmedBooking(flightId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/flight-bookings/hold')
      .set('Cookie', traveller.cookie)
      .send({
        outbound: { flightId, cabin: 'ECONOMY' },
        passengers: [
          {
            fullName: 'KE e2e Changer',
            dateOfBirth: '1990-05-14',
            passengerType: 'ADULT',
            documentNumber: 'KE7654321',
          },
        ],
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    const payment = await paymentModel.create({
      bookingType: BookingType.FLIGHT,
      bookingId: new Types.ObjectId(id),
      userId: new Types.ObjectId(traveller.userId),
      stripePaymentIntentId: `pi_e2e_change_${new Types.ObjectId().toHexString()}`,
      amount: Types.Decimal128.fromString('200.00'),
      currency: 'USD',
      status: PaymentStatus.SUCCEEDED,
      policyAcceptanceId: new Types.ObjectId(),
      idempotencyKey: `e2e-change:${id}`,
      attempt: 1,
      succeededAt: new Date(),
    });
    await app
      .get(BookingsGateway)
      .confirmAfterPayment(BookingType.FLIGHT, id, payment._id.toString());
    return id;
  }

  function change(bookingId: string, newFlightId: string, user = traveller) {
    return request(app.getHttpServer())
      .patch(`/api/flight-bookings/${bookingId}/change-flight`)
      .set('Cookie', user.cookie)
      .send({ newFlightId });
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
    paymentModel = app.get<Model<Payment>>(getModelToken(Payment.name));
    refundModel = app.get<Model<Refund>>(getModelToken(Refund.name));

    const airline = await airlineModel.create({
      name: 'KE e2e change',
      iataCode: await unusedIataCode(),
      status: AirlineStatus.ACTIVE,
      createdBy: new Types.ObjectId(),
    });
    airlineId = airline._id;
    firstId = await createFlight(10, '200.00');
    samePriceId = await createFlight(11, '200.00');
    cheaperId = await createFlight(12, '150.00');

    traveller = await createSignedInUser(app, { label: 'ke-change' });
    otherTraveller = await createSignedInUser(app, {
      label: 'ke-change-other',
    });
    userIds.push(traveller.userId, otherTraveller.userId);
  }, CONNECT_TIMEOUT_MS);

  afterAll(async () => {
    const bookings = await bookingModel
      .find({ userId: { $in: userIds.map((id) => new Types.ObjectId(id)) } })
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    const bookingIds = bookings.map((booking) => booking._id);
    await refundModel.deleteMany({ bookingId: { $in: bookingIds } }).exec();
    await paymentModel.deleteMany({ bookingId: { $in: bookingIds } }).exec();
    await bookingModel.deleteMany({ _id: { $in: bookingIds } }).exec();
    await flightModel.deleteMany({ _id: { $in: flightIds } }).exec();
    await airlineModel.deleteMany({ _id: airlineId }).exec();
    await deleteTestUsers(app, userIds);
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  it(
    'moves the seat once when the same change is sent twice at once',
    async () => {
      const id = await confirmedBooking(firstId);
      // Another passenger stays on the first flight: their seat must stay counted.
      await confirmedBooking(firstId);
      const before = {
        first: await booked(firstId),
        same: await booked(samePriceId),
      };

      const results = await Promise.all([
        change(id, samePriceId),
        change(id, samePriceId),
      ]);
      const statuses = results.map((res) => res.status).sort((a, b) => a - b);

      expect(statuses).toEqual([200, 409]);
      const refused = results.filter((res) => res.status === 409);
      expect(refused).toHaveLength(1);
      expect(['BOOKING_CHANGED', 'CHANGE_ALREADY_PENDING']).toContain(
        (refused[0].body as { code: string }).code,
      );
      expect(await booked(firstId)).toBe(before.first - 1);
      expect(await booked(samePriceId)).toBe(before.same + 1);
    },
    SLOW_MS,
  );

  it(
    'refunds a cheaper flight as a recorded fare-difference refund (PAY-03)',
    async () => {
      const id = await confirmedBooking(firstId);

      const res = await change(id, cheaperId).expect(200);

      expect(res.body).toMatchObject({
        applied: true,
        amountDifference: '-50.00',
      });
      const refundId = (res.body as { refundId: string }).refundId;
      const refund = await refundModel.findById(refundId).lean<Refund>().exec();
      expect(refund?.kind).toBe(RefundKind.FARE_DIFFERENCE);
      expect(refund?.amount.toString()).toBe('50.00');
      expect(refund?.bookingId.toString()).toBe(id);
      // The traveller can look it up like any refund.
      const shown = await request(app.getHttpServer())
        .get(`/api/refunds/${refundId}`)
        .set('Cookie', traveller.cookie)
        .expect(200);
      expect(shown.body).toMatchObject({
        kind: RefundKind.FARE_DIFFERENCE,
        amount: '50.00',
      });
      const stored = await bookingModel
        .findById(id)
        .lean<FlightBooking>()
        .exec();
      expect(stored?.priceSnapshot.total.toString()).toBe('150.00');
      expect(stored?.segments[0].flightId.toString()).toBe(cheaperId);
    },
    SLOW_MS,
  );

  it(
    'does not let another account change the booking: the same 404 as a missing one',
    async () => {
      const id = await confirmedBooking(firstId);
      const res = await change(id, samePriceId, otherTraveller).expect(404);
      expect((res.body as { code: string }).code).toBe('BOOKING_NOT_FOUND');
    },
    SLOW_MS,
  );
});
