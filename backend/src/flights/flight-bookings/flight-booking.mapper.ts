import type { Types } from 'mongoose';
import {
  decimal128ToString,
  PLATFORM_CURRENCY,
} from '../../common/money/money';
import { toAirportLocalIso } from '../../common/time/airport-time';
import type {
  PassengerType,
  PolicySnapshot,
  TripType,
} from '../schemas/flight-booking.schema';
import type { CabinCategory } from '../schemas/flight.schema';
import type {
  FlightBookingPassengerDto,
  FlightBookingPolicyDto,
  FlightBookingSegmentDto,
  FlightBookingSummaryDto,
} from './dto/flight-booking-response.dto';

// A quote (nothing stored yet) and a stored booking are both turned into these views, so
// the summary and the booking are always shown the same way.

export interface SegmentView {
  flightId: Types.ObjectId;
  airlineId: Types.ObjectId;
  flightNumber: string;
  departureAirportId: string;
  arrivalAirportId: string;
  departureAtUtc: Date;
  arrivalAtUtc: Date;
  cabin: CabinCategory;
  pricePerSeat: string;
  freeBaggageCount: number;
  maxBagWeightKg: number;
  departureTimeZone: string;
  arrivalTimeZone: string;
}

export interface PassengerView {
  fullName: string;
  dateOfBirth: string;
  passengerType: PassengerType;
  documentNumber: string;
  fare: string;
  extraBags: { count: number; weightKg: number; fee: string } | null;
}

export interface SummaryView {
  tripType: TripType;
  segments: SegmentView[];
  passengers: PassengerView[];
  policy: PolicySnapshot;
  subtotal: string;
  baggageTotal: string;
  total: string;
}

const MINUTE_MS = 60_000;
const VISIBLE_DOCUMENT_CHARACTERS = 4;

// TODO(FLT-03): use durationMinutes from flights/flight.mapper.ts once the create-flight PR
// is merged; it is the same function.
function durationMinutes(departure: Date, arrival: Date): number {
  return Math.round((arrival.getTime() - departure.getTime()) / MINUTE_MS);
}

/**
 * A passport or ID number is personal data (FLT-19), so responses show only its last 4
 * characters, even to the owner: "A12345678" becomes "•••••5678".
 */
export function maskDocumentNumber(documentNumber: string): string {
  const hidden = Math.max(
    documentNumber.length - VISIBLE_DOCUMENT_CHARACTERS,
    0,
  );
  return '•'.repeat(hidden) + documentNumber.slice(hidden);
}

/** A Decimal128 amount the schema requires, as a money string. */
export function moneyString(value: Types.Decimal128): string {
  const amount = decimal128ToString(value);
  if (amount === null) {
    throw new Error('A required amount is missing');
  }
  return amount;
}

function toSegmentDto(segment: SegmentView): FlightBookingSegmentDto {
  return {
    flightId: segment.flightId.toString(),
    airlineId: segment.airlineId.toString(),
    flightNumber: segment.flightNumber,
    departureAirportId: segment.departureAirportId,
    arrivalAirportId: segment.arrivalAirportId,
    departureLocalTime: toAirportLocalIso(
      segment.departureAtUtc,
      segment.departureTimeZone,
    ),
    arrivalLocalTime: toAirportLocalIso(
      segment.arrivalAtUtc,
      segment.arrivalTimeZone,
    ),
    departureAtUtc: segment.departureAtUtc.toISOString(),
    arrivalAtUtc: segment.arrivalAtUtc.toISOString(),
    durationMinutes: durationMinutes(
      segment.departureAtUtc,
      segment.arrivalAtUtc,
    ),
    cabin: segment.cabin,
    pricePerSeat: segment.pricePerSeat,
    freeBaggageCount: segment.freeBaggageCount,
    maxBagWeightKg: segment.maxBagWeightKg,
  };
}

function toPassengerDto(passenger: PassengerView): FlightBookingPassengerDto {
  return {
    fullName: passenger.fullName,
    dateOfBirth: passenger.dateOfBirth,
    passengerType: passenger.passengerType,
    documentNumber: maskDocumentNumber(passenger.documentNumber),
    fare: passenger.fare,
    extraBags: passenger.extraBags ? { ...passenger.extraBags } : null,
  };
}

export function toPolicyDto(policy: PolicySnapshot): FlightBookingPolicyDto {
  return {
    airlineId: policy.airlineId.toString(),
    version: policy.version,
    extraBagPrice: decimal128ToString(policy.extraBagPrice),
    maxExtraBagsPerPassenger: policy.maxExtraBagsPerPassenger,
    cancellationTiers: policy.cancellationTiers.map((tier) => ({
      daysBeforeDeparture: tier.daysBeforeDeparture,
      refundPercentage: tier.refundPercentage,
    })),
  };
}

// Fields are listed one by one so nothing internal is ever exposed by accident.
export function toSummaryDto(view: SummaryView): FlightBookingSummaryDto {
  return {
    tripType: view.tripType,
    segments: view.segments.map(toSegmentDto),
    passengers: view.passengers.map(toPassengerDto),
    policy: toPolicyDto(view.policy),
    price: {
      subtotal: view.subtotal,
      baggageTotal: view.baggageTotal,
      total: view.total,
      currency: PLATFORM_CURRENCY,
    },
  };
}
