import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';
import type { FieldErrorDto } from '../../common/dto/error-response.dto';
import { decimal128ToString } from '../../common/money/money';
import { ReferenceDataService } from '../../common/reference-data/reference-data.service';
import { Airline, AirlineStatus } from '../schemas/airline.schema';
import {
  PassengerType,
  PolicySnapshot,
  TripType,
} from '../schemas/flight-booking.schema';
import { CabinInventory, Flight, FlightStatus } from '../schemas/flight.schema';
import type {
  FlightBookingRequestDto,
  PassengerDto,
  SegmentChoiceDto,
} from './dto/flight-booking-request.dto';
import type { FlightBookingSummaryDto } from './dto/flight-booking-response.dto';
import { FlightBookingPolicyReader } from './flight-booking-policy.reader';
import {
  BookingPrice,
  passengerTypeOn,
  priceBooking,
} from './flight-booking-pricing';
import {
  moneyString,
  SegmentView,
  SummaryView,
  toSummaryDto,
} from './flight-booking.mapper';

/** One flight of a quote, read in the same session as the seats it will hold. */
interface QuotedSegment {
  // "outbound" or "inbound": the request field an error about this flight points at.
  field: string;
  flight: Flight;
  cabin: CabinInventory;
  departureTimeZone: string;
  arrivalTimeZone: string;
}

/** Everything a booking needs, checked and priced, before anything is stored. */
export interface Quote {
  tripType: TripType;
  // Adults and children: the seats held on every segment (infants sit on a lap).
  seats: number;
  segments: QuotedSegment[];
  passengers: PassengerDto[];
  price: BookingPrice;
  policy: PolicySnapshot;
}

function errorBody(
  code: string,
  message: string,
  errors?: FieldErrorDto[],
): Record<string, unknown> {
  return errors ? { code, message, errors } : { code, message };
}

function fieldError(field: string, message: string): FieldErrorDto {
  return { field, messages: [message] };
}

// Flight bookings (FLT-19, FLT-21, FLT-22). The request only names flights, cabins and
// passengers: every price, time and seat count is read from the flights here.
@Injectable()
export class FlightBookingsService {
  constructor(
    @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
    @InjectModel(Airline.name) private readonly airlineModel: Model<Airline>,
    private readonly referenceData: ReferenceDataService,
    private readonly policies: FlightBookingPolicyReader,
  ) {}

  /** FLT-19, FLT-21: the summary before payment. Nothing is stored, no seat is held. */
  async summarize(
    dto: FlightBookingRequestDto,
  ): Promise<FlightBookingSummaryDto> {
    const quote = await this.quote(dto, new Date());
    return toSummaryDto(this.quoteView(quote));
  }

  /**
   * Checks a request against the flights and prices it. `session` makes the reads part of
   * the hold's transaction, so the snapshot is exactly what the seats were held at.
   */
  async quote(
    dto: FlightBookingRequestDto,
    now: Date,
    session?: ClientSession,
  ): Promise<Quote> {
    const seats = dto.passengers.filter(
      (p) => p.passengerType !== PassengerType.INFANT,
    ).length;

    const choices: [string, SegmentChoiceDto][] = [['outbound', dto.outbound]];
    if (dto.tripType === TripType.ROUND_TRIP && dto.inbound) {
      choices.push(['inbound', dto.inbound]);
    }
    const segments: QuotedSegment[] = [];
    for (const [field, choice] of choices) {
      segments.push(await this.loadSegment(field, choice, seats, now, session));
    }
    if (segments.length === 2) {
      this.assertReturnTrip(segments[0].flight, segments[1].flight);
    }

    // FLT-12: ages count on the outbound departure date at the departure airport.
    this.assertPassengerTypes(
      dto.passengers,
      segments[0].flight.departureDateKey,
    );

    // The outbound airline's terms: FLT-12 cancels a round trip with the outbound tier.
    const policy = await this.policies.snapshotFor(
      segments[0].flight.airlineId,
    );
    this.assertExtraBags(dto.passengers, policy, segments);

    const price = priceBooking(
      segments.map((segment) => moneyString(segment.cabin.price)),
      dto.passengers.map((p) => ({
        passengerType: p.passengerType,
        extraBagCount: p.extraBags?.count ?? 0,
      })),
      decimal128ToString(policy.extraBagPrice),
    );

    return {
      tripType: dto.tripType,
      seats,
      segments,
      passengers: dto.passengers,
      price,
      policy,
    };
  }

  // The flight must exist and be bookable (SCHEDULED, not departed, ACTIVE airline, ACC-15),
  // and the cabin must exist with a seat for every adult and child. The hold checks the
  // seats again atomically (FLT-22); this check gives an early, precise answer.
  private async loadSegment(
    field: string,
    choice: SegmentChoiceDto,
    seats: number,
    now: Date,
    session?: ClientSession,
  ): Promise<QuotedSegment> {
    const flight = await this.flightModel
      .findById(choice.flightId)
      .session(session ?? null)
      .lean<Flight>()
      .exec();
    if (!flight) {
      throw new NotFoundException(
        errorBody('FLIGHT_NOT_FOUND', 'Flight not found', [
          fieldError(`${field}.flightId`, 'no flight has this id'),
        ]),
      );
    }

    const airline = await this.airlineModel
      .findById(flight.airlineId, { status: 1 })
      .session(session ?? null)
      .lean<Pick<Airline, 'status'>>()
      .exec();
    if (
      flight.status !== FlightStatus.SCHEDULED ||
      flight.departureAtUtc.getTime() <= now.getTime() ||
      airline?.status !== AirlineStatus.ACTIVE
    ) {
      throw new ConflictException(
        errorBody(
          'FLIGHT_NOT_BOOKABLE',
          'This flight can no longer be booked',
          [
            fieldError(
              `${field}.flightId`,
              'this flight can no longer be booked',
            ),
          ],
        ),
      );
    }

    const cabin = flight.cabinInventory.find(
      (c) => c.category === choice.cabin,
    );
    if (!cabin) {
      const message = `This flight has no ${choice.cabin} cabin`;
      throw new BadRequestException(
        errorBody('CABIN_NOT_OFFERED', message, [
          fieldError(`${field}.cabin`, message),
        ]),
      );
    }

    // Same wording as SeatInventoryService, which answers the same question at hold time.
    const free = cabin.totalSeats - cabin.bookedSeats - cabin.heldSeats;
    if (free < seats) {
      const message =
        free <= 0
          ? `No seats left in ${cabin.category}`
          : `Only ${free} seat${free === 1 ? '' : 's'} left in ${cabin.category}`;
      throw new ConflictException(
        errorBody('SEAT_UNAVAILABLE', message, [
          fieldError(`${field}.cabin`, message),
        ]),
      );
    }

    const departure = await this.referenceData.getAirportOrThrow(
      flight.departureAirportId,
    );
    const arrival = await this.referenceData.getAirportOrThrow(
      flight.arrivalAirportId,
    );
    return {
      field,
      flight,
      cabin,
      departureTimeZone: departure.timeZone,
      arrivalTimeZone: arrival.timeZone,
    };
  }

  // A round trip flies back between the same two airports, and the return flight must
  // leave after the outbound flight lands. Search cannot check this, so the booking does.
  private assertReturnTrip(outbound: Flight, inbound: Flight): void {
    if (
      inbound.departureAirportId !== outbound.arrivalAirportId ||
      inbound.arrivalAirportId !== outbound.departureAirportId
    ) {
      const message = `inbound must fly from ${outbound.arrivalAirportId} to ${outbound.departureAirportId}`;
      throw new BadRequestException(
        errorBody('ROUND_TRIP_ROUTE_MISMATCH', message, [
          fieldError('inbound.flightId', message),
        ]),
      );
    }
    if (inbound.departureAtUtc.getTime() <= outbound.arrivalAtUtc.getTime()) {
      const message = 'inbound must leave after the outbound flight lands';
      throw new BadRequestException(
        errorBody('RETURN_BEFORE_ARRIVAL', message, [
          fieldError('inbound.flightId', message),
        ]),
      );
    }
  }

  // FLT-12: the declared type must be the one the date of birth gives on the departure
  // date. Every passenger is checked, so one response lists all the mistakes.
  private assertPassengerTypes(
    passengers: PassengerDto[],
    departureDate: string,
  ): void {
    const errors: FieldErrorDto[] = [];
    passengers.forEach((passenger, index) => {
      const type = passengerTypeOn(passenger.dateOfBirth, departureDate);
      if (type === null) {
        errors.push(
          fieldError(
            `passengers.${index}.dateOfBirth`,
            `dateOfBirth must not be after the departure date ${departureDate}`,
          ),
        );
      } else if (type !== passenger.passengerType) {
        errors.push(
          fieldError(
            `passengers.${index}.passengerType`,
            `passengerType must be ${type} for someone born on ${passenger.dateOfBirth} (age on ${departureDate})`,
          ),
        );
      }
    });
    if (errors.length > 0) {
      throw new BadRequestException(
        errorBody(
          'PASSENGER_TYPE_MISMATCH',
          'Passenger types must match their dates of birth on the departure date',
          errors,
        ),
      );
    }
  }

  // FLT-08, FLT-19: extra bags up to the airline's limit per passenger, each no heavier
  // than the cabin's bag weight (the lighter cabin when a round trip uses two).
  private assertExtraBags(
    passengers: PassengerDto[],
    policy: PolicySnapshot,
    segments: QuotedSegment[],
  ): void {
    const maxWeight = Math.min(
      ...segments.map((segment) => segment.cabin.maxBagWeightKg),
    );
    const errors: FieldErrorDto[] = [];
    passengers.forEach(({ extraBags }, index) => {
      if (!extraBags) {
        return;
      }
      const path = `passengers.${index}.extraBags`;
      if (policy.extraBagPrice === null || !policy.maxExtraBagsPerPassenger) {
        errors.push(fieldError(path, 'this airline does not sell extra bags'));
        return;
      }
      if (extraBags.count > policy.maxExtraBagsPerPassenger) {
        errors.push(
          fieldError(
            `${path}.count`,
            `count must not be more than ${policy.maxExtraBagsPerPassenger}, the airline's limit per passenger`,
          ),
        );
      }
      if (extraBags.weightKg > maxWeight) {
        errors.push(
          fieldError(
            `${path}.weightKg`,
            `weightKg must not be more than ${maxWeight}, the cabin's bag weight`,
          ),
        );
      }
    });
    if (errors.length > 0) {
      throw new BadRequestException(
        errorBody(
          'EXTRA_BAGS_NOT_ALLOWED',
          "Extra bags must fit the airline's policy and the cabin's bag weight",
          errors,
        ),
      );
    }
  }

  private quoteView(quote: Quote): SummaryView {
    const segments: SegmentView[] = quote.segments.map((segment) => ({
      flightId: segment.flight._id,
      airlineId: segment.flight.airlineId,
      flightNumber: segment.flight.flightNumber,
      departureAirportId: segment.flight.departureAirportId,
      arrivalAirportId: segment.flight.arrivalAirportId,
      departureAtUtc: segment.flight.departureAtUtc,
      arrivalAtUtc: segment.flight.arrivalAtUtc,
      cabin: segment.cabin.category,
      pricePerSeat: moneyString(segment.cabin.price),
      freeBaggageCount: segment.cabin.freeBaggageCount,
      maxBagWeightKg: segment.cabin.maxBagWeightKg,
      departureTimeZone: segment.departureTimeZone,
      arrivalTimeZone: segment.arrivalTimeZone,
    }));
    return {
      tripType: quote.tripType,
      segments,
      passengers: quote.passengers.map((passenger, index) => ({
        fullName: passenger.fullName,
        dateOfBirth: passenger.dateOfBirth,
        passengerType: passenger.passengerType,
        documentNumber: passenger.documentNumber,
        fare: quote.price.fares[index],
        extraBags: passenger.extraBags
          ? {
              count: passenger.extraBags.count,
              weightKg: passenger.extraBags.weightKg,
              fee: quote.price.bagFees[index],
            }
          : null,
      })),
      policy: quote.policy,
      subtotal: quote.price.subtotal,
      baggageTotal: quote.price.baggageTotal,
      total: quote.price.total,
    };
  }
}
