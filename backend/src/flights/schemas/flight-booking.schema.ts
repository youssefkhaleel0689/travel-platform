import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { IATA_CODE } from '../../common/reference-data/reference-data.patterns';
import { parseLocalDate } from '../../common/time/local-date-time';
import { CabinCategory } from './flight.schema';

export type FlightBookingDocument = HydratedDocument<FlightBooking>;

// Booking lifecycle (GEN-11): PENDING_PAYMENT -> CONFIRMED -> COMPLETED,
// PENDING_PAYMENT -> EXPIRED and CONFIRMED -> CANCELLED. The services set it; a client never does.
export enum BookingStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  CONFIRMED = 'CONFIRMED',
  COMPLETED = 'COMPLETED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum TripType {
  ONE_WAY = 'ONE_WAY',
  ROUND_TRIP = 'ROUND_TRIP',
}

// FLT-12: adult 12+, child 2-11, infant under 2 on the outbound local departure date.
export enum PassengerType {
  ADULT = 'ADULT',
  CHILD = 'CHILD',
  INFANT = 'INFANT',
}

// Money is Decimal128, never a float (README conventions).
const decimalAtLeast =
  (minimum: number, inclusive: boolean) =>
  (value: Types.Decimal128 | null): boolean => {
    if (value === null) {
      return true;
    }
    const amount = Number(value.toString());
    return (
      Number.isFinite(amount) &&
      (inclusive ? amount >= minimum : amount > minimum)
    );
  };
const isPositiveDecimal = decimalAtLeast(0, false);
const isNonNegativeDecimal = decimalAtLeast(0, true);
const isWholeNumber = (value: number): boolean => Number.isInteger(value);

// One flight of the booking with the flight and cabin as they were when it was held.
// Later price or schedule edits (FLT-05) never change an existing booking.
@Schema({ _id: false, versionKey: false })
export class FlightSegment {
  @Prop({ type: Types.ObjectId, required: true })
  flightId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  airlineId: Types.ObjectId;

  @Prop({ type: String, required: true })
  flightNumber: string;

  @Prop({ type: String, required: true, match: IATA_CODE })
  departureAirportId: string;

  @Prop({ type: String, required: true, match: IATA_CODE })
  arrivalAirportId: string;

  @Prop({ type: Date, required: true })
  departureAtUtc: Date;

  @Prop({ type: Date, required: true })
  arrivalAtUtc: Date;

  @Prop({ type: String, enum: Object.values(CabinCategory), required: true })
  cabinCategory: CabinCategory;

  // Adults + children: the seats held and later booked in this cabin (FLT-22).
  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: {
      validator: isWholeNumber,
      message: 'seatsRequired must be a whole number',
    },
  })
  seatsRequired: number;

  // Price per seat at booking time. A round trip has a price per segment.
  @Prop({
    type: SchemaTypes.Decimal128,
    required: true,
    validate: {
      validator: isPositiveDecimal,
      message: 'cabinPrice must be greater than 0',
    },
  })
  cabinPrice: Types.Decimal128;

  // The cabin's baggage allowance at booking time, for the summary and the e-ticket.
  @Prop({ type: Number, required: true, min: 0 })
  freeBaggageCount: number;

  @Prop({ type: Number, required: true, min: 0.1 })
  maxBagWeightKg: number;
}

export const FlightSegmentSchema = SchemaFactory.createForClass(FlightSegment);

// Keeps its own _id so baggage[].passengerId can point to it.
@Schema({ versionKey: false })
export class Passenger {
  _id: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 100,
  })
  fullName: string;

  // A calendar date, not an instant. The service checks it against passengerType.
  @Prop({
    type: String,
    required: true,
    validate: {
      validator: (value: string): boolean => parseLocalDate(value) !== null,
      message: 'dateOfBirth must be a valid date (YYYY-MM-DD)',
    },
  })
  dateOfBirth: string;

  @Prop({ type: String, enum: Object.values(PassengerType), required: true })
  passengerType: PassengerType;

  // Passport or ID number. Personal data: never returned in lists or the FLT-29 export.
  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 30,
  })
  documentNumber: string;

  // Total fare over all segments: the cabin price for adults and children, 10% for infants.
  @Prop({
    type: SchemaTypes.Decimal128,
    required: true,
    validate: {
      validator: isPositiveDecimal,
      message: 'fareAmount must be greater than 0',
    },
  })
  fareAmount: Types.Decimal128;

  // Infants sit on a lap (FLT-12), everybody else takes a seat.
  @Prop({
    type: Boolean,
    required: true,
    validate: {
      validator(
        this: { passengerType?: PassengerType },
        value: boolean,
      ): boolean {
        return value === (this.passengerType !== PassengerType.INFANT);
      },
      message: 'seatRequired must be false for an infant and true otherwise',
    },
  })
  seatRequired: boolean;
}

export const PassengerSchema = SchemaFactory.createForClass(Passenger);

// Extra bags of one passenger (FLT-19); the limits come from the airline policy (FLT-08).
@Schema({ _id: false, versionKey: false })
export class Baggage {
  @Prop({ type: Types.ObjectId, required: true })
  passengerId: Types.ObjectId;

  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: {
      validator: isWholeNumber,
      message: 'extraBagCount must be a whole number',
    },
  })
  extraBagCount: number;

  // Declared weight per extra bag; at most the cabin's maxBagWeightKg.
  @Prop({ type: Number, required: true, min: 0.1 })
  extraBagWeightKg: number;

  @Prop({
    type: SchemaTypes.Decimal128,
    required: true,
    validate: {
      validator: isNonNegativeDecimal,
      message: 'fee must not be negative',
    },
  })
  fee: Types.Decimal128;
}

export const BaggageSchema = SchemaFactory.createForClass(Baggage);

// The airline's extra-bag rule as accepted with the booking (FLT-08, PAY-02).
@Schema({ _id: false, versionKey: false })
export class BaggagePolicySnapshot {
  @Prop({ type: SchemaTypes.Decimal128, required: true })
  extraBagPrice: Types.Decimal128;

  @Prop({ type: Number, required: true, min: 0 })
  maxExtraBagsPerPassenger: number;
}

export const BaggagePolicySnapshotSchema = SchemaFactory.createForClass(
  BaggagePolicySnapshot,
);

// Totals at booking time in the platform currency (PAY-04). The service computes them.
@Schema({ _id: false, versionKey: false })
export class PriceSnapshot {
  @Prop({
    type: SchemaTypes.Decimal128,
    required: true,
    validate: {
      validator: isPositiveDecimal,
      message: 'subtotal must be greater than 0',
    },
  })
  subtotal: Types.Decimal128;

  @Prop({
    type: SchemaTypes.Decimal128,
    required: true,
    validate: {
      validator: isNonNegativeDecimal,
      message: 'baggageTotal must not be negative',
    },
  })
  baggageTotal: Types.Decimal128;

  @Prop({
    type: SchemaTypes.Decimal128,
    required: true,
    validate: {
      validator: isPositiveDecimal,
      message: 'total must be greater than 0',
    },
  })
  total: Types.Decimal128;

  @Prop({ type: String, required: true, enum: ['USD'], default: 'USD' })
  currency: string;

  @Prop({ type: BaggagePolicySnapshotSchema, required: true })
  baggagePolicySnapshot: BaggagePolicySnapshot;
}

export const PriceSnapshotSchema = SchemaFactory.createForClass(PriceSnapshot);

// One cancellation tier as it applied to this booking (FLT-09).
@Schema({ _id: false, versionKey: false })
export class CancellationTierSnapshot {
  @Prop({ type: Number, required: true, min: 0 })
  daysBeforeDeparture: number;

  @Prop({ type: Number, required: true, min: 0, max: 100 })
  refundPercentage: number;
}

export const CancellationTierSnapshotSchema = SchemaFactory.createForClass(
  CancellationTierSnapshot,
);

// Filled once when a CONFIRMED booking is cancelled (FLT-26 by the user, FLT-06 at 100%).
@Schema({ _id: false, versionKey: false })
export class Cancellation {
  // The user, moderator or admin who cancelled.
  @Prop({ type: Types.ObjectId, required: true })
  cancelledBy: Types.ObjectId;

  @Prop({ type: String, trim: true, maxlength: 500, default: null })
  reason: string | null;

  @Prop({ type: Number, required: true, min: 0, max: 100 })
  refundPercentage: number;

  @Prop({
    type: SchemaTypes.Decimal128,
    required: true,
    validate: {
      validator: isNonNegativeDecimal,
      message: 'refundAmount must not be negative',
    },
  })
  refundAmount: Types.Decimal128;

  // The refunds document (PAY-03); null when the refund is 0.
  @Prop({ type: Types.ObjectId, default: null })
  refundId: Types.ObjectId | null;

  @Prop({ type: Date, required: true })
  cancelledAt: Date;

  @Prop({ type: [CancellationTierSnapshotSchema], default: [] })
  tiersSnapshot: CancellationTierSnapshot[];
}

export const CancellationSchema = SchemaFactory.createForClass(Cancellation);

// The hold IS this document in PENDING_PAYMENT (FLT-22): there is no draft status (GEN-11).
// Collection name is pinned so Mongoose never pluralises it (schema section 1).
@Schema({ collection: 'flightBookings', versionKey: false, timestamps: true })
export class FlightBooking {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  userId: Types.ObjectId;

  // Generated after a verified payment (FLT-23); absent until then.
  @Prop({ type: String, trim: true, uppercase: true })
  bookingReference?: string;

  @Prop({ type: String, enum: Object.values(TripType), required: true })
  tripType: TripType;

  @Prop({
    type: String,
    enum: Object.values(BookingStatus),
    required: true,
    default: BookingStatus.PENDING_PAYMENT,
  })
  status: BookingStatus;

  // Created + 10 minutes (HOLD_MINUTES). After it, the booking can only become EXPIRED.
  @Prop({ type: Date, required: true })
  holdExpiresAt: Date;

  @Prop({ type: Date, default: null })
  confirmedAt: Date | null;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  @Prop({ type: Date, default: null })
  expiredAt: Date | null;

  @Prop({ type: Date, default: null })
  cancelledAt: Date | null;

  // policyAcceptances and payments documents (PAY-02, PAY-01).
  @Prop({ type: Types.ObjectId, default: null })
  policyAcceptanceId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, default: null })
  paymentId: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  ticketFileUrl: string | null;

  // One segment for ONE_WAY, two for ROUND_TRIP; each needs a seat per adult and child.
  @Prop({
    type: [FlightSegmentSchema],
    required: true,
    validate: [
      {
        validator(
          this: { tripType?: TripType },
          segments: FlightSegment[],
        ): boolean {
          return (
            segments.length === (this.tripType === TripType.ROUND_TRIP ? 2 : 1)
          );
        },
        message: 'segments must hold 1 flight for ONE_WAY and 2 for ROUND_TRIP',
      },
      {
        validator(
          this: { passengers?: Passenger[] },
          segments: FlightSegment[],
        ): boolean {
          const seated = (this.passengers ?? []).filter(
            (p) => p.seatRequired,
          ).length;
          return segments.every((segment) => segment.seatsRequired === seated);
        },
        message: 'seatsRequired must equal the number of adults and children',
      },
    ],
  })
  segments: FlightSegment[];

  // At least one adult and no more infants than adults (FLT-12).
  @Prop({
    type: [PassengerSchema],
    required: true,
    validate: {
      validator(passengers: Passenger[]): boolean {
        const count = (type: PassengerType) =>
          passengers.filter((p) => p.passengerType === type).length;
        const adults = count(PassengerType.ADULT);
        return adults >= 1 && count(PassengerType.INFANT) <= adults;
      },
      message:
        'passengers need at least one adult and no more infants than adults',
    },
  })
  passengers: Passenger[];

  @Prop({
    type: [BaggageSchema],
    default: [],
    validate: {
      validator(
        this: { passengers?: Passenger[] },
        baggage: Baggage[],
      ): boolean {
        const ids = new Set(
          (this.passengers ?? []).map((p) => p._id.toString()),
        );
        return baggage.every((bag) => ids.has(bag.passengerId.toString()));
      },
      message: 'baggage must belong to a passenger of this booking',
    },
  })
  baggage: Baggage[];

  @Prop({ type: PriceSnapshotSchema, required: true })
  priceSnapshot: PriceSnapshot;

  @Prop({ type: CancellationSchema, default: null })
  cancellation: Cancellation | null;

  // Added by `timestamps: true`.
  createdAt: Date;
  updatedAt: Date;
}

export const FlightBookingSchema = SchemaFactory.createForClass(FlightBooking);

// "My bookings" grouped by status (FLT-25).
FlightBookingSchema.index({ userId: 1, status: 1 });
// The hold-expiry job finds PENDING_PAYMENT bookings past holdExpiresAt (FLT-22).
FlightBookingSchema.index({ status: 1, holdExpiresAt: 1 });
// Bookings of one flight: flight cancellation (FLT-06) and the passenger list (FLT-29).
FlightBookingSchema.index({ 'segments.flightId': 1, status: 1 });
// Unique once set. The partial filter lets many PENDING_PAYMENT bookings have no reference.
FlightBookingSchema.index(
  { bookingReference: 1 },
  {
    unique: true,
    partialFilterExpression: { bookingReference: { $type: 'string' } },
  },
);
