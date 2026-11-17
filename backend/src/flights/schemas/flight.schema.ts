import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { IATA_CODE } from '../../common/reference-data/reference-data.patterns';
import {
  parseLocalDate,
  parseLocalDateTime,
} from '../../common/time/local-date-time';

export type FlightDocument = HydratedDocument<Flight>;

// Flight status (FLT-30). Only SCHEDULED flights are searchable, editable or bookable.
// The system moves a SCHEDULED flight to DEPARTED once departureAtUtc has passed;
// FLT-06 moves it to CANCELLED.
export enum FlightStatus {
  SCHEDULED = 'SCHEDULED',
  CANCELLED = 'CANCELLED',
  DEPARTED = 'DEPARTED',
}

// The fixed set of cabin categories (FLT-04). Each is used at most once per flight.
export enum CabinCategory {
  ECONOMY = 'ECONOMY',
  PREMIUM_ECONOMY = 'PREMIUM_ECONOMY',
  BUSINESS = 'BUSINESS',
  FIRST = 'FIRST',
}

const isWholeNumber = (value: number): boolean => Number.isInteger(value);

// Money is Decimal128, never a float. Positive and finite is all FLT-04 asks for.
const isPositiveDecimal = (value: Types.Decimal128): boolean => {
  const amount = Number(value.toString());
  return Number.isFinite(amount) && amount > 0;
};

// Cabin of one flight, embedded in flights.cabinInventory[] (schema section 3, FLT-04).
// It has no _id: bookings point to it by flightId + category.
// bookedSeats and heldSeats are written ONLY by SeatInventoryService (Khaled, FLT-22),
// through atomic conditional updates. Nothing else in this module may set them.
@Schema({ _id: false, versionKey: false, timestamps: false })
export class CabinInventory {
  @Prop({
    type: String,
    enum: Object.values(CabinCategory),
    required: true,
  })
  category: CabinCategory;

  // Whole number > 0. A later change goes through a conditional update that only
  // succeeds while bookedSeats + heldSeats <= the new total (FLT-05).
  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: [
      {
        validator: isWholeNumber,
        message: 'totalSeats must be a whole number',
      },
      {
        // Counter invariant (schema section 5, cabinCounters), checked on save.
        validator(
          this: { bookedSeats?: number; heldSeats?: number },
          total: number,
        ): boolean {
          return (this.bookedSeats ?? 0) + (this.heldSeats ?? 0) <= total;
        },
        message: 'bookedSeats + heldSeats must not exceed totalSeats',
      },
    ],
  })
  totalSeats: number;

  @Prop({
    type: Number,
    required: true,
    default: 0,
    min: 0,
    validate: {
      validator: isWholeNumber,
      message: 'bookedSeats must be a whole number',
    },
  })
  bookedSeats: number;

  @Prop({
    type: Number,
    required: true,
    default: 0,
    min: 0,
    validate: {
      validator: isWholeNumber,
      message: 'heldSeats must be a whole number',
    },
  })
  heldSeats: number;

  // Price per seat in the platform currency. Decimal128, > 0.
  @Prop({
    type: SchemaTypes.Decimal128,
    required: true,
    validate: {
      validator: isPositiveDecimal,
      message: 'price must be greater than 0',
    },
  })
  price: Types.Decimal128;

  // Free checked bags per passenger. 0 means no free bag.
  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: isWholeNumber,
      message: 'freeBaggageCount must be a whole number',
    },
  })
  freeBaggageCount: number;

  // Maximum weight per bag in kg. Extra bags use the same limit (FLT-08).
  @Prop({ type: Number, required: true, min: 0.1 })
  maxBagWeightKg: number;
}

export const CabinInventorySchema =
  SchemaFactory.createForClass(CabinInventory);

// Collection name is pinned so Mongoose never pluralises it (schema section 1).
@Schema({ collection: 'flights', versionKey: false, timestamps: true })
export class Flight {
  _id: Types.ObjectId;

  // The airline's _id. A moderator only touches flights of the airline they are assigned to.
  @Prop({ type: Types.ObjectId, required: true })
  airlineId: Types.ObjectId;

  // Normalised so that "ms777" and "MS777" count as the same flight for the unique index.
  @Prop({
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    maxlength: 10,
  })
  flightNumber: string;

  // Seeded airport ids (IATA codes, FLT-02). The service checks that they exist.
  @Prop({
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    match: IATA_CODE,
  })
  departureAirportId: string;

  @Prop({
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    match: IATA_CODE,
    validate: {
      validator(
        this: { departureAirportId?: string },
        arrival: string,
      ): boolean {
        return this.departureAirportId !== arrival;
      },
      message: 'arrivalAirportId must differ from departureAirportId',
    },
  })
  arrivalAirportId: string;

  // What the moderator typed: "YYYY-MM-DDTHH:mm" in the airport's local time (FLT-03).
  // Kept so the original input can be shown back; the UTC fields below are the truth.
  @Prop({
    type: String,
    required: true,
    validate: {
      validator: (value: string): boolean => parseLocalDateTime(value) !== null,
      message: 'departureLocalInput must be a valid local date-time',
    },
  })
  departureLocalInput: string;

  @Prop({
    type: String,
    required: true,
    validate: {
      validator: (value: string): boolean => parseLocalDateTime(value) !== null,
      message: 'arrivalLocalInput must be a valid local date-time',
    },
  })
  arrivalLocalInput: string;

  // Instants in UTC. Flight duration is computed from these two and is never stored.
  @Prop({ type: Date, required: true })
  departureAtUtc: Date;

  @Prop({
    type: Date,
    required: true,
    validate: {
      validator(this: { departureAtUtc?: Date }, arrival: Date): boolean {
        // A missing departure is reported by its own `required` check.
        if (!this.departureAtUtc) {
          return true;
        }
        return arrival.getTime() > this.departureAtUtc.getTime();
      },
      message: 'arrivalAtUtc must be after departureAtUtc',
    },
  })
  arrivalAtUtc: Date;

  // The calendar date at the DEPARTURE airport, "YYYY-MM-DD" (FLT-03, FLT-11).
  // The service computes it from departureAtUtc and the airport's timeZone with
  // toAirportLocalDateKey() from common/time. It is never hand-computed.
  @Prop({
    type: String,
    required: true,
    validate: {
      validator: (value: string): boolean => parseLocalDate(value) !== null,
      message: 'departureDateKey must be a valid date (YYYY-MM-DD)',
    },
  })
  departureDateKey: string;

  @Prop({
    type: String,
    enum: Object.values(FlightStatus),
    required: true,
    default: FlightStatus.SCHEDULED,
  })
  status: FlightStatus;

  // Created empty by FLT-03 and filled by FLT-04. Each category at most once.
  @Prop({
    type: [CabinInventorySchema],
    default: [],
    validate: {
      validator: (cabins: CabinInventory[]): boolean =>
        new Set(cabins.map((cabin) => cabin.category)).size === cabins.length,
      message: 'cabinInventory may use each cabin category at most once',
    },
  })
  cabinInventory: CabinInventory[];

  // Added by `timestamps: true`.
  createdAt: Date;
  updatedAt: Date;
}

export const FlightSchema = SchemaFactory.createForClass(Flight);

// Flight search (FLT-11): departure airport + arrival airport + local date + status.
FlightSchema.index({
  departureAirportId: 1,
  arrivalAirportId: 1,
  departureDateKey: 1,
  status: 1,
});
// The status job (FLT-30) finds SCHEDULED flights whose departure time has passed.
FlightSchema.index({ status: 1, departureAtUtc: 1 });
// One airline cannot reuse a flight number on the same departure date (FLT-03).
FlightSchema.index(
  { airlineId: 1, flightNumber: 1, departureDateKey: 1 },
  { unique: true },
);
