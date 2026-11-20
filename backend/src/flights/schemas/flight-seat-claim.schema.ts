import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type FlightSeatClaimDocument = HydratedDocument<FlightSeatClaim>;

/**
 * FLT-28: one chosen seat. The unique index on flight + cabin + seat lets the
 * database, not a read-then-write check, decide who gets a seat when two
 * bookings pick it at the same moment. A claim whose booking is no longer
 * CONFIRMED on that seat is stale and may be taken over.
 */
@Schema({ collection: 'flightSeatClaims', timestamps: true, versionKey: false })
export class FlightSeatClaim {
  @Prop({ type: SchemaTypes.ObjectId, required: true })
  flightId: Types.ObjectId;

  @Prop({ type: String, required: true })
  cabinCategory: string;

  @Prop({ type: String, required: true, uppercase: true })
  seatNumber: string;

  @Prop({ type: SchemaTypes.ObjectId, required: true })
  bookingId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, required: true })
  passengerId: Types.ObjectId;
}

export const FlightSeatClaimSchema =
  SchemaFactory.createForClass(FlightSeatClaim);

FlightSeatClaimSchema.index(
  { flightId: 1, cabinCategory: 1, seatNumber: 1 },
  { unique: true },
);
FlightSeatClaimSchema.index({ bookingId: 1, flightId: 1 });
