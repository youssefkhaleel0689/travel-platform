import type { AirportDto } from '../../common/reference-data/dto/airport.dto';
import { decimal128ToString } from '../../common/money/money';
import { toAirportLocalIso } from '../../common/time/airport-time';
import type { FlightSearchAirlineDto } from '../flight-search/dto/flight-search-response.dto';
import { durationMinutes } from '../flights/flight.mapper';
import { sortTiers } from '../policies/airline-policy.mapper';
import type { AirlinePolicy } from '../schemas/airline-policy.schema';
import type { CabinInventory, Flight } from '../schemas/flight.schema';
import type {
  FlightDetailsCabinDto,
  FlightDetailsDto,
  FlightDetailsPolicyDto,
} from './dto/flight-details-response.dto';

// The seat counters stay internal: only what is left to book is shown. Never below 0,
// even if a counter were ever wrong.
function toCabinDto(cabin: CabinInventory): FlightDetailsCabinDto {
  return {
    category: cabin.category,
    pricePerSeat: cabin.price.toString(),
    seatsRemaining: Math.max(
      0,
      cabin.totalSeats - cabin.bookedSeats - cabin.heldSeats,
    ),
    freeBaggageCount: cabin.freeBaggageCount,
    maxBagWeightKg: cabin.maxBagWeightKg,
  };
}

// No policy yet: no extra bags for sale and no refund, the same terms a booking would get.
function toPolicyDto(policy: AirlinePolicy | null): FlightDetailsPolicyDto {
  if (!policy) {
    return {
      extraBagPrice: null,
      maxExtraBagsPerPassenger: null,
      cancellationTiers: [],
    };
  }
  return {
    extraBagPrice: decimal128ToString(policy.extraBagPrice),
    maxExtraBagsPerPassenger: policy.maxExtraBagsPerPassenger,
    cancellationTiers: sortTiers(policy.cancellationTiers).map((tier) => ({
      daysBeforeDeparture: tier.daysBeforeDeparture,
      refundPercentage: tier.refundPercentage,
    })),
  };
}

/** FLT-17: local times use each airport's own time zone (GEN-06). */
export function toFlightDetailsDto(
  flight: Flight,
  airline: FlightSearchAirlineDto,
  departure: AirportDto,
  arrival: AirportDto,
  policy: AirlinePolicy | null,
): FlightDetailsDto {
  return {
    id: flight._id.toString(),
    status: flight.status,
    airline,
    flightNumber: flight.flightNumber,
    departureAirport: departure,
    arrivalAirport: arrival,
    departureLocalTime: toAirportLocalIso(
      flight.departureAtUtc,
      departure.timeZone,
    ),
    arrivalLocalTime: toAirportLocalIso(flight.arrivalAtUtc, arrival.timeZone),
    departureAtUtc: flight.departureAtUtc.toISOString(),
    arrivalAtUtc: flight.arrivalAtUtc.toISOString(),
    durationMinutes: durationMinutes(
      flight.departureAtUtc,
      flight.arrivalAtUtc,
    ),
    cabins: flight.cabinInventory.map(toCabinDto),
    policy: toPolicyDto(policy),
  };
}
