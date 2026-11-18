import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ReferenceDataService } from '../../common/reference-data/reference-data.service';
import { AirlinePoliciesService } from '../policies/airline-policies.service';
import { Airline, AirlineStatus } from '../schemas/airline.schema';
import { Flight } from '../schemas/flight.schema';
import type { FlightDetailsDto } from './dto/flight-details-response.dto';
import { toFlightDetailsDto } from './flight-details.mapper';

// A route id is 24 hex characters (same check as ownership.ts). Types.ObjectId.isValid is
// not used because it also accepts any 12-character string.
const OBJECT_ID = /^[0-9a-f]{24}$/i;

function flightNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'FLIGHT_NOT_FOUND',
    message: 'Flight not found',
  });
}

/**
 * FLT-17: one flight for the details page. Public, like search. A flight whose airline is
 * not ACTIVE is hidden exactly as search hides it (ACC-15), so it answers the same 404 as
 * a flight that does not exist. Any status is shown, with the status, so a page opened
 * from an old link can say the flight was cancelled or has departed.
 */
@Injectable()
export class FlightDetailsService {
  constructor(
    @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
    @InjectModel(Airline.name) private readonly airlineModel: Model<Airline>,
    private readonly referenceData: ReferenceDataService,
    private readonly airlinePolicies: AirlinePoliciesService,
  ) {}

  async getDetails(id: string): Promise<FlightDetailsDto> {
    if (!OBJECT_ID.test(id)) {
      throw flightNotFound();
    }
    const flight = await this.flightModel.findById(id).lean<Flight>().exec();
    if (!flight) {
      throw flightNotFound();
    }
    const airline = await this.airlineModel
      .findById(flight.airlineId, { name: 1, iataCode: 1, status: 1 })
      .lean<Pick<Airline, '_id' | 'name' | 'iataCode' | 'status'>>()
      .exec();
    if (airline?.status !== AirlineStatus.ACTIVE) {
      throw flightNotFound();
    }

    // Three independent reads, so they run together.
    const [departure, arrival, policy] = await Promise.all([
      this.referenceData.getAirportOrThrow(flight.departureAirportId),
      this.referenceData.getAirportOrThrow(flight.arrivalAirportId),
      this.airlinePolicies.getForAirline(flight.airlineId),
    ]);
    return toFlightDetailsDto(
      flight,
      {
        id: airline._id.toString(),
        name: airline.name,
        iataCode: airline.iataCode,
      },
      departure,
      arrival,
      policy,
    );
  }
}
