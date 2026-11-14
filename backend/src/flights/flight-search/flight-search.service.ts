import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model, PipelineStage } from 'mongoose';
import { paginateArray } from '../../common/pagination/paginate';
import { ReferenceDataService } from '../../common/reference-data/reference-data.service';
import { toAirportLocalDateKey } from '../../common/time/airport-time';
import { Airline, AirlineStatus } from '../schemas/airline.schema';
import { CabinCategory, Flight, FlightStatus } from '../schemas/flight.schema';
import type { FlightSearchQueryDto } from './dto/flight-search-query.dto';
import type {
  FlightSearchAirlineDto,
  FlightSearchItemDto,
  FlightSearchResponseDto,
} from './dto/flight-search-response.dto';
import { FlightSortBy, SortOrder, TripType } from './flight-search.constants';
import {
  type FlightMatch,
  toFlightSearchItemDto,
} from './flight-search.mapper';

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
  // Inclusive bounds on the price per seat, as validated money strings (FLT-15).
  minPrice?: string;
  maxPrice?: string;
  sortBy: FlightSortBy;
  sortOrder: SortOrder;
}

// Free seats of the cabin in $$cabin, computed and never stored (FLT-22, option A).
const FREE_SEATS = {
  $subtract: [
    { $subtract: ['$$cabin.totalSeats', '$$cabin.bookedSeats'] },
    '$$cabin.heldSeats',
  ],
};

// Flight search (FLT-11, FLT-12, FLT-15) and its reuse from itineraries (ITN-26).
@Injectable()
export class FlightSearchService {
  constructor(
    @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
    @InjectModel(Airline.name) private readonly airlineModel: Model<Airline>,
    private readonly referenceData: ReferenceDataService,
  ) {}

  /**
   * A one-way or round-trip search (FLT-11, FLT-12). The return leg flies back between the
   * same two airports on returnDate, with the same passengers, cabin, price range and sort.
   */
  async search(query: FlightSearchQueryDto): Promise<FlightSearchResponseDto> {
    const shared = {
      // Infants sit on an adult's lap, so only adults and children need seats (FLT-12).
      seats: query.adults + query.children,
      cabin: query.cabin,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    };

    // One leg after the other: an error in the outbound leg is reported first, and the
    // return leg is not searched for nothing.
    const outbound = await this.searchLeg({
      ...shared,
      departureAirportId: query.departureAirportId,
      arrivalAirportIds: [query.arrivalAirportId],
      departureDate: query.departureDate,
      dateField: 'departureDate',
    });
    // The DTO requires returnDate for a ROUND_TRIP; the second check only narrows the type.
    if (query.tripType === TripType.ONE_WAY || query.returnDate === undefined) {
      return { outbound: paginateArray(outbound, query.page), inbound: null };
    }

    const inbound = await this.searchLeg({
      ...shared,
      departureAirportId: query.arrivalAirportId,
      arrivalAirportIds: [query.departureAirportId],
      departureDate: query.returnDate,
      dateField: 'returnDate',
    });
    // A route has few flights on one date, so each leg is paged in memory (GEN-05).
    return {
      outbound: paginateArray(outbound, query.page),
      inbound: paginateArray(inbound, query.returnPage),
    };
  }

  /**
   * The bookable flights of one leg. A flight qualifies when it
   * is SCHEDULED, has not departed, belongs to an ACTIVE airline (ACC-15) and has a cabin
   * (the requested one, if any) with at least `seats` free seats and a price in the range.
   * Sorted as asked; ties go to the earlier departure, then the lower _id.
   */
  async searchLeg(criteria: LegCriteria): Promise<FlightSearchItemDto[]> {
    // FLT-02: only seeded airports. The departure airport's zone decides what "today" is.
    const departure = await this.referenceData.getAirportOrThrow(
      criteria.departureAirportId,
    );
    // Each arrival airport's zone, for the local arrival times (GEN-06).
    const arrivalTimeZones = new Map<string, string>();
    for (const id of criteria.arrivalAirportIds) {
      const airport = await this.referenceData.getAirportOrThrow(id);
      arrivalTimeZones.set(id, airport.timeZone);
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
      airlines.map((a): [string, FlightSearchAirlineDto] => [
        a._id.toString(),
        { id: a._id.toString(), name: a.name, iataCode: a.iataCode },
      ]),
    );

    const activeAirlineIds = airlines.map((a) => a._id);
    const matches = await this.flightModel
      .aggregate<FlightMatch>(this.legPipeline(criteria, now, activeAirlineIds))
      .exec();

    // Both lookups always succeed: the pipeline only matches these airlines and airports.
    return matches.map((flight) =>
      toFlightSearchItemDto(
        flight,
        airlineById.get(flight.airlineId.toString()) as FlightSearchAirlineDto,
        departure.timeZone,
        arrivalTimeZones.get(flight.arrivalAirportId) as string,
      ),
    );
  }

  private legPipeline(
    criteria: LegCriteria,
    now: Date,
    activeAirlineIds: Types.ObjectId[],
  ): PipelineStage[] {
    // Every condition a cabin must meet to stay in the result.
    const cabinConditions: Record<string, unknown>[] = [
      { $gte: [FREE_SEATS, criteria.seats] },
    ];
    if (criteria.cabin) {
      cabinConditions.push({ $eq: ['$$cabin.category', criteria.cabin] });
    }
    // Decimal128 compares exactly inside MongoDB: "100" is never read as below "99.99".
    if (criteria.minPrice !== undefined) {
      cabinConditions.push({
        $gte: ['$$cabin.price', Types.Decimal128.fromString(criteria.minPrice)],
      });
    }
    if (criteria.maxPrice !== undefined) {
      cabinConditions.push({
        $lte: ['$$cabin.price', Types.Decimal128.fromString(criteria.maxPrice)],
      });
    }

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
      // Keep only the qualifying cabins; the seat counters are not returned.
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
                  cond: { $and: cabinConditions },
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
      // A flight without a qualifying cabin is not a result for this search.
      { $match: { 'cabins.0': { $exists: true } } },
      { $addFields: { lowestPrice: { $min: '$cabins.price' } } },
      ...sortStages(criteria.sortBy, criteria.sortOrder),
    ];
  }
}

// FLT-15 sorting. The tie-breakers stay ascending so the order is stable across pages.
function sortStages(
  sortBy: FlightSortBy,
  sortOrder: SortOrder,
): PipelineStage[] {
  const direction = sortOrder === SortOrder.DESC ? -1 : 1;
  switch (sortBy) {
    case FlightSortBy.PRICE:
      return [{ $sort: { lowestPrice: direction, departureAtUtc: 1, _id: 1 } }];
    case FlightSortBy.DEPARTURE_TIME:
      return [{ $sort: { departureAtUtc: direction, _id: 1 } }];
    case FlightSortBy.DURATION:
      // Duration is never stored; it is only needed here to order the results.
      return [
        {
          $addFields: {
            durationMs: { $subtract: ['$arrivalAtUtc', '$departureAtUtc'] },
          },
        },
        { $sort: { durationMs: direction, departureAtUtc: 1, _id: 1 } },
        { $unset: 'durationMs' },
      ];
  }
}
