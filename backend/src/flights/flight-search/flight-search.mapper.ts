import type { Types } from 'mongoose';
import { toAirportLocalIso } from '../../common/time/airport-time';
import { durationMinutes } from '../flights/flight.mapper';
import type { CabinCategory } from '../schemas/flight.schema';
import type {
  FlightSearchAirlineDto,
  FlightSearchCabinDto,
  FlightSearchItemDto,
} from './dto/flight-search-response.dto';

/** A cabin as the search aggregation returns it: only the ones that qualify. */
export interface CabinMatch {
  category: CabinCategory;
  price: Types.Decimal128;
  freeSeats: number;
  freeBaggageCount: number;
  maxBagWeightKg: number;
}

/** A flight as the search aggregation returns it. */
export interface FlightMatch {
  _id: Types.ObjectId;
  airlineId: Types.ObjectId;
  flightNumber: string;
  departureAirportId: string;
  arrivalAirportId: string;
  departureAtUtc: Date;
  arrivalAtUtc: Date;
  cabins: CabinMatch[];
  lowestPrice: Types.Decimal128;
}

// Fields are listed one by one so the seat counters and airlineId are never exposed.
function toCabinDto(cabin: CabinMatch): FlightSearchCabinDto {
  return {
    category: cabin.category,
    pricePerSeat: cabin.price.toString(),
    seatsAvailable: cabin.freeSeats,
    freeBaggageCount: cabin.freeBaggageCount,
    maxBagWeightKg: cabin.maxBagWeightKg,
  };
}

/** Local times use each airport's own time zone (GEN-06). */
export function toFlightSearchItemDto(
  flight: FlightMatch,
  airline: FlightSearchAirlineDto,
  departureTimeZone: string,
  arrivalTimeZone: string,
): FlightSearchItemDto {
  return {
    id: flight._id.toString(),
    airline,
    flightNumber: flight.flightNumber,
    departureAirportId: flight.departureAirportId,
    arrivalAirportId: flight.arrivalAirportId,
    departureLocalTime: toAirportLocalIso(
      flight.departureAtUtc,
      departureTimeZone,
    ),
    arrivalLocalTime: toAirportLocalIso(flight.arrivalAtUtc, arrivalTimeZone),
    departureAtUtc: flight.departureAtUtc.toISOString(),
    arrivalAtUtc: flight.arrivalAtUtc.toISOString(),
    durationMinutes: durationMinutes(
      flight.departureAtUtc,
      flight.arrivalAtUtc,
    ),
    lowestPrice: flight.lowestPrice.toString(),
    cabins: flight.cabins.map(toCabinDto),
  };
}
