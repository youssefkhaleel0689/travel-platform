import { TripType } from '../../schemas/flight-booking.schema';
import type { FlightBookingDto } from '../dto/flight-booking-response.dto';

/** One flight of the ticket, ready to print. */
export interface ETicketSegment {
  flightNumber: string;
  airlineName: string;
  from: string;
  to: string;
  departure: string;
  arrival: string;
  duration: string;
  cabin: string;
  baggage: string;
}

/** One traveller of the ticket, ready to print. */
export interface ETicketPassenger {
  fullName: string;
  passengerType: string;
  documentNumber: string;
  fare: string;
  extraBags: string | null;
}

/**
 * Everything the e-ticket shows (FLT-23), as plain strings. Built from the same booking
 * response the API returns, so the PDF can never show something the API would not.
 */
export interface ETicketView {
  bookingReference: string;
  issuedOn: string;
  tripType: string;
  segments: ETicketSegment[];
  passengers: ETicketPassenger[];
  price: { subtotal: string; baggage: string; total: string };
  cancellation: string[];
}

/** Names the ticket prints next to the codes the booking stores. */
export interface ETicketNames {
  // Airline id -> name.
  airlines: Map<string, string>;
  // Airport IATA code -> name.
  airports: Map<string, string>;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * "2026-12-20T08:30:00+02:00" -> "20 Dec 2026, 08:30 (UTC+02:00)", or without the offset
 * when `withOffset` is false. The input is the local time the API already returns
 * (GEN-06), so this only rearranges it; no time zone maths.
 */
export function formatLocalTime(iso: string, withOffset = true): string {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):\d{2}(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(
      iso,
    );
  if (!match) {
    return iso;
  }
  const [, year, month, day, hour, minute, offset] = match;
  const local = `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}, ${hour}:${minute}`;
  if (!withOffset) {
    return local;
  }
  return `${local} (UTC${offset === 'Z' ? '+00:00' : offset})`;
}

/** 240 -> "4h 00m". */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${String(rest).padStart(2, '0')}m`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** "7+ days before departure: 80% refund", from the most days to the fewest. */
function cancellationLines(booking: FlightBookingDto): string[] {
  const tiers = [...booking.policy.cancellationTiers].sort(
    (a, b) => b.daysBeforeDeparture - a.daysBeforeDeparture,
  );
  if (tiers.length === 0) {
    return ['No refund on cancellation.'];
  }
  return tiers.map((tier) => {
    const when =
      tier.daysBeforeDeparture === 0
        ? 'Up to departure'
        : `${plural(tier.daysBeforeDeparture, 'day')} or more before departure`;
    return `${when}: ${tier.refundPercentage}% refund`;
  });
}

/**
 * The ticket of a CONFIRMED or COMPLETED booking. `issuedAt` is passed in so the same
 * booking always gives the same view in a test.
 */
export function toETicketView(
  booking: FlightBookingDto,
  names: ETicketNames,
  issuedAt: Date,
): ETicketView {
  const airport = (code: string): string => {
    const name = names.airports.get(code);
    return name ? `${name} (${code})` : code;
  };
  return {
    bookingReference: booking.bookingReference ?? '',
    issuedOn: formatLocalTime(issuedAt.toISOString()),
    tripType:
      booking.tripType === TripType.ROUND_TRIP ? 'Round trip' : 'One way',
    segments: booking.segments.map((segment) => ({
      flightNumber: segment.flightNumber,
      airlineName: names.airlines.get(segment.airlineId) ?? '',
      from: airport(segment.departureAirportId),
      to: airport(segment.arrivalAirportId),
      departure: formatLocalTime(segment.departureLocalTime),
      arrival: formatLocalTime(segment.arrivalLocalTime),
      duration: formatDuration(segment.durationMinutes),
      cabin: segment.cabin,
      baggage: `${plural(segment.freeBaggageCount, 'bag')} included, up to ${segment.maxBagWeightKg} kg each`,
    })),
    passengers: booking.passengers.map((passenger) => ({
      fullName: passenger.fullName,
      passengerType: passenger.passengerType,
      // Already masked by the booking response: the ticket never prints the full number.
      documentNumber: passenger.documentNumber,
      fare: `${passenger.fare} ${booking.price.currency}`,
      extraBags: passenger.extraBags
        ? `${plural(passenger.extraBags.count, 'extra bag')}, up to ${passenger.extraBags.weightKg} kg each (${passenger.extraBags.fee} ${booking.price.currency})`
        : null,
    })),
    price: {
      subtotal: `${booking.price.subtotal} ${booking.price.currency}`,
      baggage: `${booking.price.baggageTotal} ${booking.price.currency}`,
      total: `${booking.price.total} ${booking.price.currency}`,
    },
    cancellation: cancellationLines(booking),
  };
}
