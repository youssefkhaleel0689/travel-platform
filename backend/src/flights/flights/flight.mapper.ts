import { CabinInventoryDto, FlightDto } from './dto/flight.dto';
import { CabinInventory, Flight } from '../schemas/flight.schema';

const MINUTE_MS = 60_000;

// Fields are listed one by one so a new schema field is never exposed by accident.
function toCabinDto(cabin: CabinInventory): CabinInventoryDto {
  return {
    category: cabin.category,
    totalSeats: cabin.totalSeats,
    bookedSeats: cabin.bookedSeats,
    heldSeats: cabin.heldSeats,
    price: cabin.price.toString(),
    freeBaggageCount: cabin.freeBaggageCount,
    maxBagWeightKg: cabin.maxBagWeightKg,
  };
}

/** The duration is computed from the UTC instants and is never stored (FLT-03). */
export function durationMinutes(departure: Date, arrival: Date): number {
  return Math.round((arrival.getTime() - departure.getTime()) / MINUTE_MS);
}

export function toFlightDto(doc: Flight): FlightDto {
  return {
    id: doc._id.toString(),
    airlineId: doc.airlineId.toString(),
    flightNumber: doc.flightNumber,
    departureAirportId: doc.departureAirportId,
    arrivalAirportId: doc.arrivalAirportId,
    departureLocalInput: doc.departureLocalInput,
    arrivalLocalInput: doc.arrivalLocalInput,
    departureAtUtc: doc.departureAtUtc.toISOString(),
    arrivalAtUtc: doc.arrivalAtUtc.toISOString(),
    departureDateKey: doc.departureDateKey,
    durationMinutes: durationMinutes(doc.departureAtUtc, doc.arrivalAtUtc),
    status: doc.status,
    cabinInventory: doc.cabinInventory.map(toCabinDto),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
