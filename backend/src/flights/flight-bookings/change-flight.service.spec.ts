import { HttpException } from '@nestjs/common';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { BookingStatus } from '../../common/bookings/booking-status';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { Role } from '../../common/auth/auth.enums';
import type { PaymentsService } from '../../payments/payments.service';
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
const SESSION = {} as ClientSession;
const DAY = 24 * 60 * 60 * 1000;

function segment(flightId: Types.ObjectId, from: string, to: string, inDays: number, price: string) {
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
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return doc as unknown as FlightBookingDocument & { save: jest.Mock };
}

function flight(from: string, to: string, inDays: number, price: string, overrides: Record<string, unknown> = {}) {
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

function setup(doc: FlightBookingDocument, next: FlightDocument | null, airlineActive = true) {
  const bookingModel = {
    findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) }),
    updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) }),
  };
  const flightModel = {
    findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(next) }),
  };
  const airlineModel = {
    exists: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(airlineActive ? { _id: 1 } : null) }),
  };
  const connection = {
    transaction: jest.fn(async (fn: (s: ClientSession) => Promise<void>) => fn(SESSION)),
  };
  const seats = {
    hold: jest.fn().mockResolvedValue(undefined),
    convertHeldToBooked: jest.fn().mockResolvedValue(undefined),
    releaseBooked: jest.fn().mockResolvedValue(undefined),
  };
  const stripe = {
    createPaymentIntent: jest.fn().mockResolvedValue({ id: 'pi_123', client_secret: 'secret' }),
    retrievePaymentIntent: jest.fn().mockResolvedValue({ status: 'succeeded' }),
    createRefund: jest.fn().mockResolvedValue({ id: 're_1' }),
  };
  const payments = {
    findSucceededForBooking: jest.fn().mockResolvedValue({ stripePaymentIntentId: 'pi_paid' }),
  };
  const service = new ChangeFlightService(
    bookingModel as unknown as Model<FlightBookingDocument>,
    flightModel as unknown as Model<FlightDocument>,
    airlineModel as unknown as Model<Airline>,
    connection as unknown as Connection,
    seats as unknown as SeatInventoryService,
    stripe as unknown as StripeService,
    payments as unknown as PaymentsService,
  );
  return { service, bookingModel, seats, stripe };
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
  it('charges the difference for every passenger, infants at 10%', async () => {
    const doc = booking();
    const { service, stripe, bookingModel } = setup(doc, flight('CAI', 'DXB', 11, '150.00'));
    const result = await service.request(USER, doc._id.toString(), { newFlightId: NEW_ID.toString() });
    // Adult +50, infant +5.
    expect(result).toMatchObject({ requiresPayment: true, amountDifference: '55.00' });
    expect(stripe.createPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({ amount: '55.00' }));
    const set = bookingModel.updateOne.mock.calls[0][1].$set.pendingChange;
    expect(set).toMatchObject({ segmentIndex: 0, amountDifference: '55.00' });
    expect(set.newCabinPrice.toString()).toBe('150.00');
  });

  it('applies a cheaper flight at once, updates the totals and refunds', async () => {
    const doc = booking();
    const { service, stripe, seats } = setup(doc, flight('CAI', 'DXB', 11, '80.00'));
    const result = await service.request(USER, doc._id.toString(), { newFlightId: NEW_ID.toString() });
    expect(result).toMatchObject({ applied: true, amountDifference: '-22.00', refunded: true });
    expect(stripe.createRefund).toHaveBeenCalledWith(expect.objectContaining({ amount: '22.00' }));
    expect(seats.hold).toHaveBeenCalled();
    expect(doc.priceSnapshot.total.toString()).toBe('218.00');
    expect(doc.passengers[0].fareAmount.toString()).toBe('180.00');
    expect(doc.passengers[1].fareAmount.toString()).toBe('18.00');
    expect(doc.segments[0].flightId).toBe(NEW_ID);
  });

  it('applies a paid change to the segment that was quoted, at the quoted price', async () => {
    const doc = booking({
      pendingChange: {
        newFlightId: NEW_ID,
        segmentIndex: 1,
        newCabinPrice: d128('150.00'),
        amountDifference: '55.00',
        currency: 'USD',
        stripePaymentIntentId: 'pi_123',
        requestedAt: new Date(),
      },
    });
    // The flight's price moved since the quote; the paid price is kept.
    const { service } = setup(doc, flight('DXB', 'CAI', 18, '999.00'));
    await service.applyPaid(USER, doc._id.toString());
    expect(doc.segments[1].flightId).toBe(NEW_ID);
    expect(doc.segments[0].flightId).toBe(OUT_ID);
    expect(doc.segments[1].cabinPrice.toString()).toBe('150.00');
    expect(doc.priceSnapshot.total.toString()).toBe('295.00');
    expect(doc.pendingChange).toBeNull();
  });

  it('refuses the flight the booking is already on', async () => {
    const doc = booking();
    const { service } = setup(doc, flight('CAI', 'DXB', 11, '100.00'));
    expect(await codeOf(service.request(USER, doc._id.toString(), { newFlightId: OUT_ID.toString() }))).toBe('SAME_FLIGHT');
  });

  it('refuses an outbound that would land after the return leaves', async () => {
    const doc = booking();
    const { service } = setup(doc, flight('CAI', 'DXB', 20, '100.00'));
    expect(await codeOf(service.request(USER, doc._id.toString(), { newFlightId: NEW_ID.toString() }))).toBe('TRIP_ORDER_INVALID');
  });

  it('treats a flight of a deactivated airline as not found (ACC-15)', async () => {
    const doc = booking();
    const { service } = setup(doc, flight('CAI', 'DXB', 11, '100.00'), false);
    expect(await codeOf(service.request(USER, doc._id.toString(), { newFlightId: NEW_ID.toString() }))).toBe('FLIGHT_NOT_FOUND');
  });

  it('refuses a booking that is not confirmed', async () => {
    const doc = booking({ status: BookingStatus.CANCELLED });
    const { service } = setup(doc, flight('CAI', 'DXB', 11, '100.00'));
    expect(await codeOf(service.request(USER, doc._id.toString(), { newFlightId: NEW_ID.toString() }))).toBe('BOOKING_NOT_CONFIRMED');
  });

  it('opens at most one pending change when two requests race', async () => {
    const doc = booking();
    const { service, bookingModel } = setup(doc, flight('CAI', 'DXB', 11, '150.00'));
    bookingModel.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) });
    expect(await codeOf(service.request(USER, doc._id.toString(), { newFlightId: NEW_ID.toString() }))).toBe('CHANGE_ALREADY_PENDING');
  });
});
