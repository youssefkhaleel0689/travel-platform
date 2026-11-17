import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Flight, FlightStatus } from '../schemas/flight.schema';

// Status of flights over time (FLT-30). Flights are SCHEDULED, CANCELLED or DEPARTED; only
// SCHEDULED flights are searchable, editable or bookable.
@Injectable()
export class FlightStatusService {
  constructor(
    @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
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
}
