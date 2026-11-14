import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, PipelineStage, Types } from 'mongoose';
import { ReferenceDataService } from '../../common/reference-data/reference-data.service';
import { toAirportLocalDateKey } from '../../common/time/airport-time';
import { Airline, AirlineStatus } from '../schemas/airline.schema';
import { CabinCategory, Flight, FlightStatus } from '../schemas/flight.schema';

/** One leg of a search: from one airport, to one or more airports, on a local date. */
export interface LegCriteria {
  departureAirportId: string;
  // One airport for GET /flights/search; every airport of a city for ITN-26.
  arrivalAirportIds: string[];
  // On the calendar of the departure airport (GEN-06).
  departureDate: string;
  // The query field that holds the date, so an error lands on it (departureDate or returnDate).
  dateField: string;
  // Adults + children. Infants sit on a lap and need no seat (FLT-12).
  seats: number;
  cabin?: CabinCategory;
}

/** A cabin that has enough free seats for the whole party. */
export interface LegCabin {
  category: CabinCategory;
  price: Types.Decimal128;
  freeSeats: number;
  freeBaggageCount: number;
  maxBagWeightKg: number;
}

export interface LegAirline {
  id: string;
  name: string;
  iataCode: string;
}

/** A bookable flight for a leg, with only the cabins that qualify. */
export interface LegFlight {
  _id: Types.ObjectId;
  airline: LegAirline;
  flightNumber: string;
  departureAirportId: string;
  arrivalAirportId: string;
  departureAtUtc: Date;
  arrivalAtUtc: Date;
  cabins: LegCabin[];
  // The cheapest qualifying cabin: the price a flight is filtered and sorted by (FLT-15).
  lowestPrice: Types.Decimal128;
}

type LegMatch = Omit<LegFlight, 'airline'> & { airlineId: Types.ObjectId };

// Free seats of the cabin in $$cabin, computed and never stored (FLT-22, option A).
const FREE_SEATS = {
  $subtract: [
    { $subtract: ['$$cabin.totalSeats', '$$cabin.bookedSeats'] },
    '$$cabin.heldSeats',
  ],
};

// Flight search (FLT-11, FLT-12) and its reuse from itineraries (ITN-26).
@Injectable()
export class FlightSearchService {
  constructor(
    @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
    @InjectModel(Airline.name) private readonly airlineModel: Model<Airline>,
    private readonly referenceData: ReferenceDataService,
  ) {}

  /**
   * The bookable flights of one leg, earliest departure first. A flight qualifies when it
   * is SCHEDULED, has not departed, belongs to an ACTIVE airline (ACC-15) and has a cabin
   * (the requested one, if any) with at least `seats` free seats.
   */
  async searchLeg(criteria: LegCriteria): Promise<LegFlight[]> {
    // FLT-02: only seeded airports. The departure airport's zone decides what "today" is.
    const departure = await this.referenceData.getAirportOrThrow(
      criteria.departureAirportId,
    );
    for (const id of criteria.arrivalAirportIds) {
      await this.referenceData.getAirportOrThrow(id);
    }

    const now = new Date();
    const today = toAirportLocalDateKey(now, departure.timeZone);
    if (criteria.departureDate < today) {
      const message = `${criteria.dateField} must not be before today at ${departure.id}`;
      throw new BadRequestException({
        code: 'DEPARTURE_DATE_IN_PAST',
        message,
        errors: [{ field: criteria.dateField, messages: [message] }],
      });
    }

    const airlines = await this.airlineModel
      .find({ status: AirlineStatus.ACTIVE }, { name: 1, iataCode: 1 })
      .lean<Pick<Airline, '_id' | 'name' | 'iataCode'>[]>()
      .exec();
    if (airlines.length === 0) {
      return [];
    }
    const airlineById = new Map(
      airlines.map((a): [string, LegAirline] => [
        a._id.toString(),
        { id: a._id.toString(), name: a.name, iataCode: a.iataCode },
      ]),
    );

    const activeAirlineIds = airlines.map((a) => a._id);
    const matches = await this.flightModel
      .aggregate<LegMatch>(this.legPipeline(criteria, now, activeAirlineIds))
      .exec();

    return matches.map(({ airlineId, ...flight }) => ({
      ...flight,
      // Always found: the pipeline only matches these airlines.
      airline: airlineById.get(airlineId.toString()) as LegAirline,
    }));
  }

  private legPipeline(
    criteria: LegCriteria,
    now: Date,
    activeAirlineIds: Types.ObjectId[],
  ): PipelineStage[] {
    const cabinMatches = criteria.cabin
      ? { $eq: ['$$cabin.category', criteria.cabin] }
      : true;

    return [
      // The first four fields are the search index of the flight schema, in its order.
      {
        $match: {
          departureAirportId: criteria.departureAirportId,
          arrivalAirportId: { $in: criteria.arrivalAirportIds },
          departureDateKey: criteria.departureDate,
          status: FlightStatus.SCHEDULED,
          // Hides a departed flight even before the DEPARTED job (FLT-30) has run.
          departureAtUtc: { $gt: now },
          airlineId: { $in: activeAirlineIds },
        },
      },
      // Keep only the cabins with room for the whole party; counters are not returned.
      {
        $project: {
          airlineId: 1,
          flightNumber: 1,
          departureAirportId: 1,
          arrivalAirportId: 1,
          departureAtUtc: 1,
          arrivalAtUtc: 1,
          cabins: {
            $map: {
              input: {
                $filter: {
                  input: '$cabinInventory',
                  as: 'cabin',
                  cond: {
                    $and: [
                      cabinMatches,
                      { $gte: [FREE_SEATS, criteria.seats] },
                    ],
                  },
                },
              },
              as: 'cabin',
              in: {
                category: '$$cabin.category',
                price: '$$cabin.price',
                freeSeats: FREE_SEATS,
                freeBaggageCount: '$$cabin.freeBaggageCount',
                maxBagWeightKg: '$$cabin.maxBagWeightKg',
              },
            },
          },
        },
      },
      // A flight without a qualifying cabin is not bookable for this party.
      { $match: { 'cabins.0': { $exists: true } } },
      // Decimal128 compares exactly inside MongoDB, so no floating-point money in code.
      { $addFields: { lowestPrice: { $min: '$cabins.price' } } },
      // Stable order; FLT-15 sorting replaces it in the next step.
      { $sort: { departureAtUtc: 1, _id: 1 } },
    ];
  }
}
