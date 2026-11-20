import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BookingStatus } from '../../common/bookings/booking-status';
import { FlightBooking } from '../schemas/flight-booking.schema';
import { Flight, FlightStatus } from '../schemas/flight.schema';

// Status of flights over time (FLT-30). Flights are SCHEDULED, CANCELLED or DEPARTED; only
// SCHEDULED flights are searchable, editable or bookable. The bookings of departed flights
// move on with them (GEN-11).
@Injectable()
export class FlightStatusService {
  constructor(
    @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
  ) {}

  /**
   * FLT-30: a SCHEDULED flight whose departure time has passed becomes DEPARTED. It is ONE
   * conditional update (status is still SCHEDULED and departureAtUtc <= now), so there is no
   * read-then-write: a flight that was cancelled (FLT-06) a moment earlier is never
   * touched, and running it twice, or from two server instances, changes nothing the second
   * time. A flight departing exactly now counts as departed. Returns how many flights
   * changed.
   */
  async markDeparted(now: Date = new Date(Date.now())): Promise<number> {
    const result = await this.flightModel
      .updateMany(
        { status: FlightStatus.SCHEDULED, departureAtUtc: { $lte: now } },
        { $set: { status: FlightStatus.DEPARTED } },
      )
      .exec();
    return result.modifiedCount;
  }

  /**
   * GEN-11: CONFIRMED -> COMPLETED once every flight of the booking has departed, the
   * moment "My bookings" already lists it under PAST (FLT-25). A round trip whose way back
   * is still ahead stays CONFIRMED. Like markDeparted it is ONE conditional update: a
   * booking cancelled a moment earlier no longer matches, and a second run changes
   * nothing. A flight departing exactly now counts as departed. Returns how many bookings
   * changed.
   */
  async completeFlownBookings(
    now: Date = new Date(Date.now()),
  ): Promise<number> {
    const result = await this.bookingModel
      .updateMany(
        {
          status: BookingStatus.CONFIRMED,
          segments: { $not: { $elemMatch: { departureAtUtc: { $gt: now } } } },
        },
        { $set: { status: BookingStatus.COMPLETED, completedAt: now } },
      )
      .exec();
    return result.modifiedCount;
  }
}
