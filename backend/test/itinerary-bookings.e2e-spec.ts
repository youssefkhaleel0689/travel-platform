// Bookings linked to itinerary days (ITN-27, bonus) end to end against the
// shared database. Bookings are read through the shared BookingsGateway, which
// is stubbed here (like exchange rates), so no booking or payment is created:
// the test writes only test_c2_ accounts and their itineraries, and afterAll
// deletes exactly those.
import { INestApplication, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import {
  BookingStatus,
  BookingType,
  ProviderType,
} from './../src/common/bookings/booking-status';
import { BookingsGateway } from './../src/common/bookings/bookings.gateway';
import type { PayableBooking } from './../src/common/bookings/bookings.port';
import { ExchangeRatesService } from './../src/exchange-rates/exchange-rates.service';
import { Itinerary } from './../src/itineraries/schemas/itinerary.schema';
import {
  createSignedInUser,
  deleteTestUsers,
  SignedInUser,
} from './support/auth-test-helper';

const CONNECT_TIMEOUT_MS = 120_000;
const SLOW_MS = 30_000;

describe('Itinerary booking links (e2e, ITN-27)', () => {
  let app: INestApplication<App>;
  let itineraryModel: Model<Itinerary>;
  const createdUserIds: string[] = [];
  let owner: SignedInUser;
  let other: SignedInUser;
  const bookings = new Map<string, PayableBooking>();

  const http = () => request(app.getHttpServer());

  function fakeBooking(
    userId: string,
    bookingType: BookingType,
    status: BookingStatus,
    totalAmount: string,
  ): string {
    const bookingId = new Types.ObjectId().toString();
    bookings.set(bookingId, {
      bookingId,
      bookingType,
      userId,
      status,
      totalAmount,
      currency: 'USD',
      holdExpiresAt: null,
      bookingReference:
        status === BookingStatus.PENDING_PAYMENT
          ? null
          : `REF-${bookingId.slice(-6)}`,
      providerType:
        bookingType === BookingType.HOTEL
          ? ProviderType.HOTEL
          : ProviderType.AIRLINE,
      providerId: new Types.ObjectId().toString(),
    });
    return bookingId;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    itineraryModel = app.get<Model<Itinerary>>(getModelToken(Itinerary.name));

    jest
      .spyOn(app.get(BookingsGateway, { strict: false }), 'getPayableOrThrow')
      .mockImplementation((bookingType, bookingId) => {
        const booking = bookings.get(bookingId);
        if (!booking || booking.bookingType !== bookingType) {
          return Promise.reject(new NotFoundException('Booking not found'));
        }
        return Promise.resolve({ ...booking });
      });
    jest.spyOn(app.get(ExchangeRatesService), 'getRates').mockResolvedValue({
      base: 'USD',
      rates: {
        USD: 1,
        EUR: 0.9,
        GBP: 0.8,
        EGP: 50,
        AED: 3.67,
        JPY: 150,
        SAR: 3.75,
      },
      rateDate: '2026-11-18',
      stale: false,
    });

    owner = await createSignedInUser(app, { label: 'itn_bkg_owner' });
    other = await createSignedInUser(app, { label: 'itn_bkg_other' });
    createdUserIds.push(owner.userId, other.userId);
  }, CONNECT_TIMEOUT_MS);

  afterAll(async () => {
    if (itineraryModel && createdUserIds.length > 0) {
      await itineraryModel
        .deleteMany({
          userId: { $in: createdUserIds.map((id) => new Types.ObjectId(id)) },
        })
        .exec();
    }
    await deleteTestUsers(app, createdUserIds);
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  it(
    'links own confirmed bookings to days and feeds the budget',
    async () => {
      const created = await http()
        .post('/api/itineraries')
        .set('Cookie', owner.cookie)
        .send({
          title: 'E2E links',
          countries: ['FR'],
          startDate: '2027-03-10',
        })
        .expect(201);
      const id = created.body.id as string;
      let days: { id: string }[] = [];
      for (const city of ['paris', 'paris']) {
        const res = await http()
          .post(`/api/itineraries/${id}/days`)
          .set('Cookie', owner.cookie)
          .send({ city })
          .expect(201);
        days = res.body.days;
      }
      await http()
        .post(`/api/itineraries/${id}/days/${days[0].id}/budgets`)
        .set('Cookie', owner.cookie)
        .send({ category: 'food', amount: 90, currency: 'EUR' })
        .expect(201);

      const hotel = fakeBooking(
        owner.userId,
        BookingType.HOTEL,
        BookingStatus.CONFIRMED,
        '450.00',
      );
      const flight = fakeBooking(
        owner.userId,
        BookingType.FLIGHT,
        BookingStatus.COMPLETED,
        '300.50',
      );
      const unpaid = fakeBooking(
        owner.userId,
        BookingType.FLIGHT,
        BookingStatus.PENDING_PAYMENT,
        '99.00',
      );
      const notMine = fakeBooking(
        other.userId,
        BookingType.HOTEL,
        BookingStatus.CONFIRMED,
        '10.00',
      );
      const link = (body: object, cookie = owner.cookie) =>
        http()
          .post(`/api/itineraries/${id}/bookings`)
          .set('Cookie', cookie)
          .send(body);

      const hotelLink = await link({
        bookingType: 'HOTEL',
        bookingId: hotel,
        dayId: days[0].id,
      }).expect(201);
      expect(hotelLink.body).toEqual(
        expect.objectContaining({
          bookingType: 'HOTEL',
          bookingId: hotel,
          dayId: days[0].id,
          dayNumber: 1,
          date: '2027-03-10',
          city: 'paris',
          status: 'CONFIRMED',
          totalAmount: '450.00',
          currency: 'USD',
          countsInBudget: true,
        }),
      );
      await link({
        bookingType: 'FLIGHT',
        bookingId: flight,
        dayId: days[1].id,
      }).expect(201);

      // Rules: once per itinerary, only paid, only mine, only real days.
      await link({ bookingType: 'HOTEL', bookingId: hotel, dayId: days[1].id })
        .expect(409)
        .expect((res) => expect(res.body.code).toBe('BOOKING_ALREADY_LINKED'));
      await link({
        bookingType: 'FLIGHT',
        bookingId: unpaid,
        dayId: days[0].id,
      })
        .expect(409)
        .expect((res) => expect(res.body.code).toBe('BOOKING_NOT_CONFIRMED'));
      await link({
        bookingType: 'HOTEL',
        bookingId: notMine,
        dayId: days[0].id,
      })
        .expect(404)
        .expect((res) => expect(res.body.code).toBe('BOOKING_NOT_FOUND'));
      await link({ bookingType: 'FLIGHT', bookingId: hotel, dayId: days[0].id })
        .expect(404)
        .expect((res) => expect(res.body.code).toBe('BOOKING_NOT_FOUND'));
      await link({
        bookingType: 'HOTEL',
        bookingId: hotel,
        dayId: new Types.ObjectId().toString(),
      })
        .expect(404)
        .expect((res) => expect(res.body.code).toBe('DAY_NOT_FOUND'));
      await link({ bookingType: 'TRAIN', bookingId: hotel, dayId: days[0].id })
        .expect(400)
        .expect((res) => expect(res.body.code).toBe('VALIDATION_FAILED'));
      await link(
        { bookingType: 'HOTEL', bookingId: notMine, dayId: days[0].id },
        other.cookie,
      )
        .expect(404)
        .expect((res) => expect(res.body.code).toBe('ITINERARY_NOT_FOUND'));

      // Listed in day order.
      const list = await http()
        .get(`/api/itineraries/${id}/bookings`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(list.body.map((l: { bookingId: string }) => l.bookingId)).toEqual([
        hotel,
        flight,
      ]);
      await http()
        .get(`/api/itineraries/${id}/bookings`)
        .set('Cookie', other.cookie)
        .expect(404);

      // Budget in USD: 90 EUR food = 100.00 USD, plus 750.50 of bookings.
      const usd = await http()
        .get(`/api/itineraries/${id}/budget-summary?currency=USD`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(usd.body.total).toBe('100.00');
      expect(usd.body.linkedBookings.currency).toBe('USD');
      expect(usd.body.linkedBookings.total).toBe('750.50');
      expect(usd.body.linkedBookings.items).toHaveLength(2);
      expect(usd.body.totalWithBookings).toBe('850.50');

      // In another currency the bookings are not converted (ITN-18, PAY-04).
      const eur = await http()
        .get(`/api/itineraries/${id}/budget-summary?currency=EUR`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(eur.body.total).toBe('90.00');
      expect(eur.body.linkedBookings.total).toBe('750.50');
      expect(eur.body.totalWithBookings).toBeNull();

      // A booking cancelled later stops counting, and says so.
      bookings.get(hotel)!.status = BookingStatus.CANCELLED;
      const afterCancel = await http()
        .get(`/api/itineraries/${id}/budget-summary?currency=USD`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(afterCancel.body.linkedBookings.total).toBe('300.50');
      expect(
        afterCancel.body.linkedBookings.items.find(
          (l: { bookingId: string }) => l.bookingId === hotel,
        ),
      ).toEqual(
        expect.objectContaining({ status: 'CANCELLED', countsInBudget: false }),
      );

      // Links are private: not on the public view or summary, never cloned.
      await http()
        .patch(`/api/itineraries/${id}/visibility`)
        .set('Cookie', owner.cookie)
        .send({ visibility: 'public' })
        .expect(200);
      const pub = await http()
        .get(`/api/itineraries/public/${id}?currency=USD`)
        .expect(200);
      expect(JSON.stringify(pub.body)).not.toContain(hotel);
      expect(pub.body.bookingLinks).toBeUndefined();
      expect(pub.body.budgetSummary.linkedBookings).toBeUndefined();
      const clone = await http()
        .post(`/api/itineraries/${id}/clone`)
        .set('Cookie', other.cookie)
        .expect(201);
      const cloneLinks = await http()
        .get(`/api/itineraries/${clone.body.id}/bookings`)
        .set('Cookie', other.cookie)
        .expect(200);
      expect(cloneLinks.body).toEqual([]);

      // Deleting a day drops its links; unlinking removes one.
      await http()
        .delete(`/api/itineraries/${id}/days/${days[0].id}`)
        .set('Cookie', owner.cookie)
        .expect(200);
      const left = await http()
        .get(`/api/itineraries/${id}/bookings`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(left.body).toHaveLength(1);
      expect(left.body[0]).toEqual(
        expect.objectContaining({ bookingId: flight, dayNumber: 1 }),
      );
      const linkId = left.body[0].id as string;
      await http()
        .delete(`/api/itineraries/${id}/bookings/${linkId}`)
        .set('Cookie', other.cookie)
        .expect(404);
      await http()
        .delete(`/api/itineraries/${id}/bookings/${linkId}`)
        .set('Cookie', owner.cookie)
        .expect(204);
      await http()
        .delete(`/api/itineraries/${id}/bookings/${linkId}`)
        .set('Cookie', owner.cookie)
        .expect(404)
        .expect((res) => expect(res.body.code).toBe('BOOKING_LINK_NOT_FOUND'));
    },
    SLOW_MS,
  );
});
