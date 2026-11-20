import { HttpException, ConflictException } from '@nestjs/common';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { BookingStatus } from '../../common/bookings/booking-status';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { Role } from '../../common/auth/auth.enums';
import type { PaymentsService } from '../../payments/payments.service';
import { RefundStatus } from '../../payments/refund-status.enum';
import type { RefundsService } from '../../payments/refunds.service';
import type { StripeService } from '../../payments/stripe.service';
import type { SeatInventoryService } from '../seat-inventory/seat-inventory.service';
import type { Airline } from '../schemas/airline.schema';
import type { FlightBookingDocument } from '../schemas/flight-booking.schema';
import { PassengerType } from '../schemas/flight-booking.schema';
import type { FlightDocument } from '../schemas/flight.schema';
import { CabinCategory, FlightStatus } from '../schemas/flight.schema';
import { ChangeFlightService } from './change-flight.service';

const d128 = (v: string) => Types.Decimal128.fromString(v);
const USER: AuthenticatedUser = {
  userId: new Types.ObjectId().toString(),
  role: Role.USER,
  sessionId: new Types.ObjectId().toString(),
};
const OUT_ID = new Types.ObjectId();
const RET_ID = new Types.ObjectId();
const NEW_ID = new Types.ObjectId();
const SESSION = { id: 'test-session' } as unknown as ClientSession;
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

function segment(
  flightId: Types.ObjectId,
  from: string,
  to: string,
  inDays: number,
  price: string,
) {
  const departureAtUtc = new Date(Date.now() + inDays * DAY);
  return {
    flightId,
    departureAirportId: from,
    arrivalAirportId: to,
    departureAtUtc,
    arrivalAtUtc: new Date(departureAtUtc.getTime() + 3 * 60 * 60 * 1000),
    cabinCategory: CabinCategory.ECONOMY,
    cabinPrice: d128(price),
    seatsRequired: 1,
    seatAssignments: [],
  };
}

// A round trip, one adult and one infant: the adult pays 100 per segment, the
// infant 10, so the fares are 220 and the total with 20 of bags is 240.
function booking(overrides: Record<string, unknown> = {}) {
  const doc = {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(USER.userId),
    status: BookingStatus.CONFIRMED,
    pendingChange: null as unknown,
    segments: [
      segment(OUT_ID, 'CAI', 'DXB', 10, '100.00'),
      segment(RET_ID, 'DXB', 'CAI', 17, '100.00'),
    ],
    passengers: [
      { passengerType: PassengerType.ADULT, fareAmount: d128('200.00') },
      { passengerType: PassengerType.INFANT, fareAmount: d128('20.00') },
    ],
    priceSnapshot: {
      subtotal: d128('220.00'),
      total: d128('240.00'),
      currency: 'USD',
    },
    ...overrides,
  };
  return doc as unknown as FlightBookingDocument;
}

function flight(
  from: string,
  to: string,
  inDays: number,
  price: string,
  overrides: Record<string, unknown> = {},
) {
  const departureAtUtc = new Date(Date.now() + inDays * DAY);
  return {
    _id: NEW_ID,
    airlineId: new Types.ObjectId(),
    flightNumber: 'KD200',
    status: FlightStatus.SCHEDULED,
    departureAirportId: from,
    arrivalAirportId: to,
    departureAtUtc,
    arrivalAtUtc: new Date(departureAtUtc.getTime() + 3 * 60 * 60 * 1000),
    cabinInventory: [
      {
        category: CabinCategory.ECONOMY,
        price: d128(price),
        totalSeats: 100,
        bookedSeats: 0,
        heldSeats: 0,
        freeBaggageCount: 1,
        maxBagWeightKg: 23,
      },
    ],
    ...overrides,
  } as unknown as FlightDocument;
}

// A paid change of the return (segment 1) to a 150.00 flight: 55.00 more.
function pending(overrides: Record<string, unknown> = {}) {
  return {
    newFlightId: NEW_ID,
    segmentIndex: 1,
    newCabinPrice: d128('150.00'),
    amountDifference: '55.00',
    currency: 'USD',
    stripePaymentIntentId: 'pi_123',
    requestedAt: new Date(),
    holdExpiresAt: new Date(Date.now() + 10 * MINUTE),
    seatsHeld: true,
    ...overrides,
  };
}

type UpdateCall = [
  Record<string, unknown>,
  { $set: Record<string, unknown> },
  { session: ClientSession },
];

function setup(
  doc: FlightBookingDocument,
  next: FlightDocument | null,
  airlineActive = true,
) {
  const bookingModel = {
    findOne: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) }),
    updateOne: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    }),
    find: jest.fn(),
  };
  const flightModel = {
    findById: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(next) }),
  };
  const airlineModel = {
    exists: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(airlineActive ? { _id: 1 } : null),
    }),
  };
  const order: string[] = [];
  const connection = {
    transaction: jest.fn(async (fn: (s: ClientSession) => Promise<void>) =>
      fn(SESSION),
    ),
  };
  const seat = (name: string) =>
    jest.fn((): Promise<void> => {
      order.push(name);
      return Promise.resolve();
    });
  const seats = {
    hold: seat('hold'),
    convertHeldToBooked: seat('convert'),
    releaseBooked: seat('releaseBooked'),
    releaseHeld: seat('releaseHeld'),
  };
  const stripe = {
    createPaymentIntent: jest
      .fn()
      .mockResolvedValue({ id: 'pi_123', client_secret: 'secret' }),
    retrievePaymentIntent: jest
      .fn()
      .mockResolvedValue({ id: 'pi_123', status: 'succeeded' }),
    cancelPaymentIntent: jest
      .fn()
      .mockResolvedValue({ id: 'pi_123', status: 'canceled' }),
  };
  const payments = {
    recordFareDifference: jest
      .fn()
      .mockResolvedValue({ _id: new Types.ObjectId() }),
  };
  const refundId = new Types.ObjectId();
  const refunds = {
    issueFareDifference: jest
      .fn()
      .mockResolvedValue({ _id: refundId, status: RefundStatus.REFUNDED }),
  };
  const service = new ChangeFlightService(
    bookingModel as unknown as Model<FlightBookingDocument>,
    flightModel as unknown as Model<FlightDocument>,
    airlineModel as unknown as Model<Airline>,
    connection as unknown as Connection,
    seats as unknown as SeatInventoryService,
    stripe as unknown as StripeService,
    payments as unknown as PaymentsService,
    refunds as unknown as RefundsService,
  );
  const updates = () =>
    bookingModel.updateOne.mock.calls as unknown as UpdateCall[];
  return {
    service,
    bookingModel,
    seats,
    stripe,
    payments,
    refunds,
    refundId,
    order,
    updates,
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const body = (error as HttpException).getResponse() as { code: string };
    return body.code;
  }
  throw new Error('expected an error');
}

describe('ChangeFlightService (FLT-27)', () => {
  describe('a higher fare', () => {
    it('charges the difference for every passenger, infants at 10%, and holds the new seats', async () => {
      const doc = booking();
      const { service, stripe, seats, updates } = setup(
        doc,
        flight('CAI', 'DXB', 11, '150.00'),
      );
      const result = await service.request(USER, doc._id.toString(), {
        newFlightId: NEW_ID.toString(),
      });

      // Adult +50, infant +5.
      expect(result).toMatchObject({
        requiresPayment: true,
        applied: false,
        amountDifference: '55.00',
      });
      expect(stripe.createPaymentIntent).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '55.00' }),
      );
      const [filter, update, options] = updates()[0];
      expect(filter).toMatchObject({
        status: BookingStatus.CONFIRMED,
        pendingChange: null,
        'segments.0.flightId': OUT_ID,
      });
      const saved = update.$set.pendingChange as Record<string, unknown>;
      expect(saved).toMatchObject({
        segmentIndex: 0,
        amountDifference: '55.00',
        seatsHeld: true,
        stripePaymentIntentId: 'pi_123',
      });
      expect(String(saved.newCabinPrice)).toBe('150.00');
      expect(options.session).toBe(SESSION);
      // The seats are held in the same transaction, for HOLD_MINUTES.
      expect(seats.hold).toHaveBeenCalledWith(
        expect.objectContaining({ flightId: NEW_ID, seats: 1 }),
        SESSION,
      );
      const expires = new Date(
        (result as { holdExpiresAt: string }).holdExpiresAt,
      ).getTime();
      expect(expires - (saved.requestedAt as Date).getTime()).toBe(10 * MINUTE);
    });

    it('gives each request its own PaymentIntent key, so a new request never gets an old intent back', async () => {
      const doc = booking();
      const { service, stripe } = setup(
        doc,
        flight('CAI', 'DXB', 11, '150.00'),
      );
      await service.request(USER, doc._id.toString(), {
        newFlightId: NEW_ID.toString(),
      });
      await service.request(USER, doc._id.toString(), {
        newFlightId: NEW_ID.toString(),
      });
      const [first, second] = stripe.createPaymentIntent.mock.calls.map(
        ([input]) => (input as { idempotencyKey: string }).idempotencyKey,
      );
      expect(first).not.toBe(second);
    });

    it("opens at most one pending change when two requests race, and cancels the loser's PaymentIntent", async () => {
      const doc = booking();
      const { service, bookingModel, seats, stripe } = setup(
        doc,
        flight('CAI', 'DXB', 11, '150.00'),
      );
      bookingModel.updateOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      });

      expect(
        await codeOf(
          service.request(USER, doc._id.toString(), {
            newFlightId: NEW_ID.toString(),
          }),
        ),
      ).toBe('CHANGE_ALREADY_PENDING');
      expect(seats.hold).not.toHaveBeenCalled();
      expect(stripe.cancelPaymentIntent).toHaveBeenCalledWith('pi_123');
    });

    it('cancels the PaymentIntent when the new seats are gone by the time they are held', async () => {
      const doc = booking();
      const { service, seats, stripe } = setup(
        doc,
        flight('CAI', 'DXB', 11, '150.00'),
      );
      seats.hold.mockRejectedValue(
        new ConflictException({ code: 'SEAT_UNAVAILABLE', message: 'gone' }),
      );

      expect(
        await codeOf(
          service.request(USER, doc._id.toString(), {
            newFlightId: NEW_ID.toString(),
          }),
        ),
      ).toBe('SEAT_UNAVAILABLE');
      expect(stripe.cancelPaymentIntent).toHaveBeenCalledWith('pi_123');
    });

    it('refuses a new change while one is pending', async () => {
      const doc = booking({ pendingChange: pending() });
      const { service, stripe } = setup(
        doc,
        flight('CAI', 'DXB', 11, '150.00'),
      );
      expect(
        await codeOf(
          service.request(USER, doc._id.toString(), {
            newFlightId: NEW_ID.toString(),
          }),
        ),
      ).toBe('CHANGE_ALREADY_PENDING');
      expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
    });
  });

  describe('a lower or equal fare', () => {
    it('applies a cheaper flight at once, updates the totals and refunds the difference through RefundsService', async () => {
      const doc = booking();
      const { service, refunds, refundId, order, updates } = setup(
        doc,
        flight('CAI', 'DXB', 11, '80.00'),
      );
      const result = await service.request(USER, doc._id.toString(), {
        newFlightId: NEW_ID.toString(),
      });

      expect(result).toMatchObject({
        applied: true,
        amountDifference: '-22.00',
        refunded: true,
        refundId: refundId.toString(),
      });
      expect(refunds.issueFareDifference).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: doc._id.toString(),
          amount: '22.00',
        }),
      );
      const [filter, update] = updates()[0];
      // Only while the booking is still on the old flight with no change pending.
      expect(filter).toMatchObject({
        status: BookingStatus.CONFIRMED,
        pendingChange: null,
        'segments.0.flightId': OUT_ID,
      });
      expect(update.$set['segments.0.flightId']).toBe(NEW_ID);
      expect(String(update.$set['priceSnapshot.total'])).toBe('218.00');
      expect(String(update.$set['passengers.0.fareAmount'])).toBe('180.00');
      expect(String(update.$set['passengers.1.fareAmount'])).toBe('18.00');
      expect(update.$set['segments.0.seatAssignments']).toEqual([]);
      // The booking is claimed first, then the seats move.
      expect(order).toEqual(['hold', 'convert', 'releaseBooked']);
      // Nothing is changed in memory: a retried transaction applies the same update.
      expect(doc.segments[0].flightId).toBe(OUT_ID);
    });

    it('reports a refund Stripe refused as not refunded', async () => {
      const doc = booking();
      const { service, refunds } = setup(
        doc,
        flight('CAI', 'DXB', 11, '80.00'),
      );
      refunds.issueFareDifference.mockResolvedValue({
        _id: new Types.ObjectId(),
        status: RefundStatus.FAILED,
      });
      const result = await service.request(USER, doc._id.toString(), {
        newFlightId: NEW_ID.toString(),
      });
      expect(result).toMatchObject({ applied: true, refunded: false });
    });

    it('applies an equal fare with no payment and no refund', async () => {
      const doc = booking();
      const { service, refunds, stripe } = setup(
        doc,
        flight('CAI', 'DXB', 11, '100.00'),
      );
      const result = await service.request(USER, doc._id.toString(), {
        newFlightId: NEW_ID.toString(),
      });
      expect(result).toMatchObject({ applied: true, amountDifference: '0.00' });
      expect(refunds.issueFareDifference).not.toHaveBeenCalled();
      expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
    });

    it('moves the seats once when the same change is sent twice at once', async () => {
      const doc = booking();
      const { service, bookingModel, seats, refunds } = setup(
        doc,
        flight('CAI', 'DXB', 11, '80.00'),
      );
      // The second request's conditional update finds the booking already moved.
      bookingModel.updateOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      });

      expect(
        await codeOf(
          service.request(USER, doc._id.toString(), {
            newFlightId: NEW_ID.toString(),
          }),
        ),
      ).toBe('BOOKING_CHANGED');
      expect(seats.hold).not.toHaveBeenCalled();
      expect(seats.releaseBooked).not.toHaveBeenCalled();
      expect(refunds.issueFareDifference).not.toHaveBeenCalled();
    });
  });

  describe('applying a paid change', () => {
    it('applies the quoted segment at the quoted price and turns the held seats into booked ones', async () => {
      const doc = booking({ pendingChange: pending() });
      // The flight's price moved since the quote; the paid price is kept.
      const { service, seats, payments, order, updates } = setup(
        doc,
        flight('DXB', 'CAI', 18, '999.00'),
      );
      await service.applyPaid(USER, doc._id.toString());

      const [filter, update] = updates()[0];
      expect(filter).toMatchObject({
        'pendingChange.stripePaymentIntentId': 'pi_123',
        'segments.1.flightId': RET_ID,
      });
      expect(update.$set['segments.1.flightId']).toBe(NEW_ID);
      expect(update.$set['segments.0.flightId']).toBeUndefined();
      expect(String(update.$set['segments.1.cabinPrice'])).toBe('150.00');
      expect(String(update.$set['priceSnapshot.total'])).toBe('295.00');
      expect(update.$set.pendingChange).toBeNull();
      expect(order).toEqual(['convert', 'releaseBooked']);
      expect(seats.releaseBooked).toHaveBeenCalledWith(
        expect.objectContaining({ flightId: RET_ID }),
        SESSION,
      );
      expect(payments.recordFareDifference).toHaveBeenCalledWith(
        expect.objectContaining({
          stripePaymentIntentId: 'pi_123',
          amount: '55.00',
        }),
      );
    });

    it('holds the seats first for a change made before seats were held at request time', async () => {
      const doc = booking({ pendingChange: pending({ seatsHeld: undefined }) });
      const { service, order } = setup(doc, flight('DXB', 'CAI', 18, '150.00'));
      await service.applyPaid(USER, doc._id.toString());
      expect(order).toEqual(['hold', 'convert', 'releaseBooked']);
    });

    it('applies once: a second apply finds the change gone and records nothing', async () => {
      const doc = booking({ pendingChange: pending() });
      const { service, bookingModel, seats, payments } = setup(
        doc,
        flight('DXB', 'CAI', 18, '150.00'),
      );
      bookingModel.updateOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      });

      expect(await codeOf(service.applyPaid(USER, doc._id.toString()))).toBe(
        'BOOKING_CHANGED',
      );
      expect(seats.convertHeldToBooked).not.toHaveBeenCalled();
      expect(payments.recordFareDifference).not.toHaveBeenCalled();
    });

    it('refuses while the difference is unpaid', async () => {
      const doc = booking({ pendingChange: pending() });
      const { service, stripe } = setup(
        doc,
        flight('DXB', 'CAI', 18, '150.00'),
      );
      stripe.retrievePaymentIntent.mockResolvedValue({
        id: 'pi_123',
        status: 'requires_payment_method',
      });
      expect(await codeOf(service.applyPaid(USER, doc._id.toString()))).toBe(
        'PAYMENT_NOT_SUCCEEDED',
      );
    });

    it('refunds the difference and releases the seats when the new flight was cancelled meanwhile', async () => {
      const doc = booking({ pendingChange: pending() });
      const { service, seats, payments, refunds, updates } = setup(
        doc,
        flight('DXB', 'CAI', 18, '150.00', { status: FlightStatus.CANCELLED }),
      );

      expect(await codeOf(service.applyPaid(USER, doc._id.toString()))).toBe(
        'CHANGE_NO_LONGER_POSSIBLE',
      );
      expect(updates()[0][1].$set).toEqual({ pendingChange: null });
      expect(seats.releaseHeld).toHaveBeenCalledWith(
        expect.objectContaining({ flightId: NEW_ID }),
        SESSION,
      );
      expect(payments.recordFareDifference).toHaveBeenCalled();
      expect(refunds.issueFareDifference).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '55.00' }),
      );
    });
  });

  describe('changes whose seat hold has ended (the hold-expiry job)', () => {
    interface FindChain {
      sort: jest.Mock<FindChain>;
      limit: jest.Mock<FindChain>;
      exec: jest.Mock;
    }

    function due(
      doc: FlightBookingDocument,
      bookingModel: { find: jest.Mock },
    ) {
      const chain: FindChain = {
        sort: jest.fn(() => chain),
        limit: jest.fn(() => chain),
        exec: jest.fn().mockResolvedValue([doc]),
      };
      bookingModel.find.mockReturnValue(chain);
      return chain;
    }

    it('looks for changes requested more than the hold ago', async () => {
      const doc = booking({ pendingChange: pending() });
      const { service, bookingModel } = setup(
        doc,
        flight('DXB', 'CAI', 18, '150.00'),
      );
      due(doc, bookingModel);
      const now = new Date('2026-12-01T12:00:00Z');
      await service.settleExpiredChanges(now);
      expect(bookingModel.find).toHaveBeenCalledWith({
        'pendingChange.requestedAt': { $lte: new Date('2026-12-01T11:50:00Z') },
      });
    });

    it('cancels an unpaid change at Stripe and gives its seats back', async () => {
      const doc = booking({ pendingChange: pending() });
      const { service, bookingModel, stripe, seats } = setup(
        doc,
        flight('DXB', 'CAI', 18, '150.00'),
      );
      due(doc, bookingModel);
      stripe.retrievePaymentIntent.mockResolvedValue({
        id: 'pi_123',
        status: 'requires_payment_method',
      });

      await expect(service.settleExpiredChanges()).resolves.toEqual([
        'released',
      ]);
      expect(stripe.cancelPaymentIntent).toHaveBeenCalledWith('pi_123');
      expect(seats.releaseHeld).toHaveBeenCalledWith(
        expect.objectContaining({ flightId: NEW_ID }),
        SESSION,
      );
    });

    it('applies a change the user paid for but never applied', async () => {
      const doc = booking({ pendingChange: pending() });
      const { service, bookingModel, payments } = setup(
        doc,
        flight('DXB', 'CAI', 18, '150.00'),
      );
      due(doc, bookingModel);

      await expect(service.settleExpiredChanges()).resolves.toEqual([
        'applied',
      ]);
      expect(payments.recordFareDifference).toHaveBeenCalled();
    });

    it('applies it when the payment went through just as the hold ended', async () => {
      const doc = booking({ pendingChange: pending() });
      const { service, bookingModel, stripe, seats } = setup(
        doc,
        flight('DXB', 'CAI', 18, '150.00'),
      );
      due(doc, bookingModel);
      stripe.retrievePaymentIntent
        .mockResolvedValueOnce({
          id: 'pi_123',
          status: 'requires_payment_method',
        })
        .mockResolvedValueOnce({ id: 'pi_123', status: 'succeeded' });
      // Stripe answers that the intent has already finished.
      stripe.cancelPaymentIntent.mockResolvedValue(null);

      await expect(service.settleExpiredChanges()).resolves.toEqual([
        'applied',
      ]);
      expect(seats.releaseHeld).not.toHaveBeenCalled();
    });

    it('waits for a payment Stripe is still processing', async () => {
      const doc = booking({ pendingChange: pending() });
      const { service, bookingModel, stripe } = setup(
        doc,
        flight('DXB', 'CAI', 18, '150.00'),
      );
      due(doc, bookingModel);
      stripe.retrievePaymentIntent.mockResolvedValue({
        id: 'pi_123',
        status: 'processing',
      });

      await expect(service.settleExpiredChanges()).resolves.toEqual([
        'waiting',
      ]);
      expect(bookingModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('what can be changed', () => {
    it('refuses the flight the booking is already on', async () => {
      const doc = booking();
      const { service } = setup(doc, flight('CAI', 'DXB', 11, '100.00'));
      expect(
        await codeOf(
          service.request(USER, doc._id.toString(), {
            newFlightId: OUT_ID.toString(),
          }),
        ),
      ).toBe('SAME_FLIGHT');
    });

    it('refuses an outbound that would land after the return leaves', async () => {
      const doc = booking();
      const { service } = setup(doc, flight('CAI', 'DXB', 20, '100.00'));
      expect(
        await codeOf(
          service.request(USER, doc._id.toString(), {
            newFlightId: NEW_ID.toString(),
          }),
        ),
      ).toBe('TRIP_ORDER_INVALID');
    });

    it('treats a flight of a deactivated airline as not found (ACC-15)', async () => {
      const doc = booking();
      const { service } = setup(doc, flight('CAI', 'DXB', 11, '100.00'), false);
      expect(
        await codeOf(
          service.request(USER, doc._id.toString(), {
            newFlightId: NEW_ID.toString(),
          }),
        ),
      ).toBe('FLIGHT_NOT_FOUND');
    });

    it('refuses a booking that is not confirmed', async () => {
      const doc = booking({ status: BookingStatus.CANCELLED });
      const { service } = setup(doc, flight('CAI', 'DXB', 11, '100.00'));
      expect(
        await codeOf(
          service.request(USER, doc._id.toString(), {
            newFlightId: NEW_ID.toString(),
          }),
        ),
      ).toBe('BOOKING_NOT_CONFIRMED');
    });
  });
});
