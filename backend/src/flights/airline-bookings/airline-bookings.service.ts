import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { BookingStatus } from '../../common/bookings/booking-status';
import { paginateQuery } from '../../common/pagination/paginate';
import { assignedAirlineId } from '../airline-assignment';
import { AirlineModeratorAssignment } from '../schemas/airline-moderator-assignment.schema';
import { FlightBooking, FlightSegment } from '../schemas/flight-booking.schema';
import { Flight } from '../schemas/flight.schema';
import {
  AIRLINE_PASSENGER_STATUSES,
  AIRLINE_VISIBLE_STATUSES,
} from './dto/airline-flight-bookings.dto';
import type {
  AirlineFlightBookingDto,
  AirlineFlightBookingsDto,
  ListFlightBookingsQueryDto,
} from './dto/airline-flight-bookings.dto';
import { toCsv } from './passenger-csv';

// A route id is 24 hex characters, the same check as the flight and cabin services.
const OBJECT_ID = /^[0-9a-f]{24}$/i;

const CSV_HEADER = [
  'Booking reference',
  'Passenger name',
  'Passenger type',
  'Date of birth',
  'Cabin',
  'Needs a seat',
  'Booking status',
] as const;

export interface PassengerExport {
  filename: string;
  csv: string;
}

// FLT-29: the bookings of one flight, for the moderator of the airline that operates it
// (ACC-11). The airline comes from airlineModeratorAssignment, never from the client, and
// the flight is looked up with that airline in the filter: another airline's flight and a
// flight that does not exist give the same 404. The flightBookings collection is only
// read here; the booking module (Khaled) owns every write to it.
@Injectable()
export class AirlineBookingsService {
  constructor(
    @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
    @InjectModel(AirlineModeratorAssignment.name)
    private readonly assignmentModel: Model<AirlineModeratorAssignment>,
  ) {}

  /** FLT-29: the flight's bookings (one page), and the seats remaining per cabin. */
  async list(
    flightId: string,
    query: ListFlightBookingsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<AirlineFlightBookingsDto> {
    const flight = await this.ownFlight(flightId, actor);
    const status =
      query.status !== undefined
        ? query.status
        : { $in: [...AIRLINE_VISIBLE_STATUSES] };

    const page = await paginateQuery(
      this.bookingModel,
      { 'segments.flightId': flight._id, status },
      // Oldest booking first; the helper appends _id so equal dates keep their order.
      { page: query.page, sort: { createdAt: 1 } },
    );

    return {
      flight: {
        id: flight._id.toString(),
        flightNumber: flight.flightNumber,
        departureAirportId: flight.departureAirportId,
        arrivalAirportId: flight.arrivalAirportId,
        departureAtUtc: flight.departureAtUtc.toISOString(),
        arrivalAtUtc: flight.arrivalAtUtc.toISOString(),
        status: flight.status,
      },
      seats: flight.cabinInventory.map((cabin) => ({
        category: cabin.category,
        totalSeats: cabin.totalSeats,
        bookedSeats: cabin.bookedSeats,
        heldSeats: cabin.heldSeats,
        remainingSeats: cabin.totalSeats - cabin.bookedSeats - cabin.heldSeats,
      })),
      bookings: {
        items: page.items.flatMap((booking) => {
          const row = this.toRow(booking, flight._id);
          return row ? [row] : [];
        }),
        meta: page.meta,
      },
    };
  }

  /**
   * FLT-29: the passengers who fly (CONFIRMED and COMPLETED bookings) as a CSV, one row per
   * passenger. The document number is personal data and is never exported.
   */
  async exportPassengers(
    flightId: string,
    actor: AuthenticatedUser,
  ): Promise<PassengerExport> {
    const flight = await this.ownFlight(flightId, actor);
    const bookings = await this.bookingModel
      .find({
        'segments.flightId': flight._id,
        status: { $in: [...AIRLINE_PASSENGER_STATUSES] },
      })
      .sort({ createdAt: 1, _id: 1 })
      .lean<FlightBooking[]>()
      .exec();

    const rows: string[][] = [];
    for (const booking of bookings) {
      const segment = this.segmentOf(booking, flight._id);
      if (!segment) {
        continue;
      }
      for (const passenger of booking.passengers) {
        rows.push([
          booking.bookingReference ?? '',
          passenger.fullName,
          passenger.passengerType,
          passenger.dateOfBirth,
          segment.cabinCategory,
          passenger.seatRequired ? 'YES' : 'NO',
          booking.status,
        ]);
      }
    }

    return {
      filename: `passengers-${flight.flightNumber}-${flight.departureDateKey}.csv`,
      csv: toCsv(CSV_HEADER, rows),
    };
  }

  // The flight, only when it belongs to the moderator's airline (404 otherwise). A
  // deactivated airline can still read its own bookings: ACC-15 keeps CONFIRMED bookings
  // valid, and the moderator has to see who is booked.
  private async ownFlight(
    flightId: string,
    actor: AuthenticatedUser,
  ): Promise<Flight & { _id: Types.ObjectId }> {
    const airlineId = await assignedAirlineId(this.assignmentModel, actor);
    const flight = OBJECT_ID.test(flightId)
      ? await this.flightModel
          .findOne({ _id: new Types.ObjectId(flightId), airlineId })
          .lean<Flight & { _id: Types.ObjectId }>()
          .exec()
      : null;
    if (!flight) {
      throw new NotFoundException({
        code: 'FLIGHT_NOT_FOUND',
        message: 'Flight not found',
      });
    }
    return flight;
  }

  private segmentOf(
    booking: FlightBooking,
    flightId: Types.ObjectId,
  ): FlightSegment | undefined {
    return booking.segments.find((segment) =>
      segment.flightId.equals(flightId),
    );
  }

  private toRow(
    booking: FlightBooking,
    flightId: Types.ObjectId,
  ): AirlineFlightBookingDto | null {
    const segment = this.segmentOf(booking, flightId);
    if (!segment) {
      return null;
    }
    return {
      id: booking._id.toString(),
      bookingReference: booking.bookingReference ?? null,
      status: booking.status as BookingStatus,
      cabin: segment.cabinCategory,
      seats: segment.seatsRequired,
      passengerCount: booking.passengers.length,
      passengers: booking.passengers.map((passenger) => ({
        fullName: passenger.fullName,
        passengerType: passenger.passengerType,
      })),
      confirmedAt: booking.confirmedAt?.toISOString() ?? null,
      cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    };
  }
}
