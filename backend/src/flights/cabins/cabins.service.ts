import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { assertAirlineActive, assignedAirlineId } from '../airline-assignment';
import { AirlineModeratorAssignment } from '../schemas/airline-moderator-assignment.schema';
import { Airline } from '../schemas/airline.schema';
import { CabinCategory, Flight, FlightStatus } from '../schemas/flight.schema';
import { FlightDto } from '../flights/dto/flight.dto';
import { toFlightDto } from '../flights/flight.mapper';
import { CreateCabinDto } from './dto/create-cabin.dto';
import { UpdateCabinDto } from './dto/update-cabin.dto';

// A route id is 24 hex characters, the same check as ownership.ts.
const OBJECT_ID = /^[0-9a-f]{24}$/i;

type FlightState = Pick<Flight, 'status' | 'departureAtUtc'> & {
  cabinInventory: Pick<
    Flight['cabinInventory'][number],
    'category' | 'bookedSeats' | 'heldSeats'
  >[];
};

// Cabins of a flight (FLT-04). Every call first resolves the moderator's airline from
// airlineModeratorAssignment (ACC-11) and only touches flights of that airline.
//
// Each change is ONE conditional update whose filter holds every rule (own airline,
// SCHEDULED, not yet departed, category free or present), so two parallel requests cannot
// both pass a check-then-write. Only when it matches nothing do we read the flight, to tell
// the caller why. bookedSeats and heldSeats are never written here: a new cabin starts at
// 0 / 0 and SeatInventoryService (FLT-22) is the only code that changes them afterwards.
@Injectable()
export class CabinsService {
  constructor(
    @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
    @InjectModel(AirlineModeratorAssignment.name)
    private readonly assignmentModel: Model<AirlineModeratorAssignment>,
    @InjectModel(Airline.name) private readonly airlineModel: Model<Airline>,
  ) {}

  // The moderator's airline, which must not be DEACTIVATED (ACC-15).
  private async activeAirlineId(
    actor: AuthenticatedUser,
  ): Promise<Types.ObjectId> {
    const airlineId = await assignedAirlineId(this.assignmentModel, actor);
    await assertAirlineActive(
      this.airlineModel,
      airlineId,
      'Your airline is deactivated and cannot change its flights',
    );
    return airlineId;
  }

  /**
   * FLT-04: add a cabin to a SCHEDULED flight of the moderator's airline. A category can
   * be used once per flight (CABIN_ALREADY_EXISTS).
   */
  async add(
    flightId: string,
    dto: CreateCabinDto,
    actor: AuthenticatedUser,
  ): Promise<FlightDto> {
    const airlineId = await this.activeAirlineId(actor);
    this.requireFlightId(flightId);

    const updated = await this.flightModel
      .findOneAndUpdate(
        {
          ...this.editableFlight(flightId, airlineId),
          'cabinInventory.category': { $ne: dto.category },
        },
        {
          $push: {
            cabinInventory: {
              category: dto.category,
              totalSeats: dto.totalSeats,
              bookedSeats: 0,
              heldSeats: 0,
              price: this.toDecimal(dto.price),
              freeBaggageCount: dto.freeBaggageCount,
              maxBagWeightKg: dto.maxBagWeightKg,
            },
          },
        },
        { new: true },
      )
      .lean<Flight>()
      .exec();
    if (updated) {
      return toFlightDto(updated);
    }
    throw await this.rejection(flightId, airlineId, dto.category, 'add');
  }

  /**
   * FLT-04 / FLT-05: change the price, the seat count or the baggage allowance of one
   * cabin of a SCHEDULED flight of the moderator's airline. A price change does not touch
   * existing bookings: they keep their own price snapshot. A new seat count is written
   * only if the seats already booked or held still fit (bookedSeats + heldSeats <= the
   * new total): that test is part of the update's filter, so a hold made at the same
   * moment cannot slip past it. The counters themselves are never written here.
   */
  async update(
    flightId: string,
    cabinId: string,
    dto: UpdateCabinDto,
    actor: AuthenticatedUser,
  ): Promise<FlightDto> {
    const airlineId = await this.activeAirlineId(actor);
    this.requireFlightId(flightId);
    const category = this.parseCategory(cabinId);

    const changes: Record<string, unknown> = {
      ...(dto.price !== undefined && {
        'cabinInventory.$.price': this.toDecimal(dto.price),
      }),
      ...(dto.totalSeats !== undefined && {
        'cabinInventory.$.totalSeats': dto.totalSeats,
      }),
      ...(dto.freeBaggageCount !== undefined && {
        'cabinInventory.$.freeBaggageCount': dto.freeBaggageCount,
      }),
      ...(dto.maxBagWeightKg !== undefined && {
        'cabinInventory.$.maxBagWeightKg': dto.maxBagWeightKg,
      }),
    };
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_UPDATE',
        message:
          'Send at least one of price, totalSeats, freeBaggageCount, maxBagWeightKg',
        errors: [
          {
            field: 'body',
            messages: [
              'send at least one of price, totalSeats, freeBaggageCount, maxBagWeightKg',
            ],
          },
        ],
      });
    }

    const updated = await this.flightModel
      .findOneAndUpdate(
        {
          ...this.editableFlight(flightId, airlineId),
          'cabinInventory.category': category,
          ...(dto.totalSeats !== undefined && {
            // The matched cabin must still hold the seats already booked and held.
            $expr: this.seatsFit(category, dto.totalSeats),
          }),
        },
        { $set: changes },
        { new: true },
      )
      .lean<Flight>()
      .exec();
    if (updated) {
      return toFlightDto(updated);
    }
    throw await this.rejection(
      flightId,
      airlineId,
      category,
      'update',
      dto.totalSeats,
    );
  }

  // True when the cabin of this category has bookedSeats + heldSeats <= totalSeats.
  private seatsFit(category: CabinCategory, totalSeats: number) {
    return {
      $anyElementTrue: {
        $map: {
          input: '$cabinInventory',
          as: 'cabin',
          in: {
            $and: [
              { $eq: ['$$cabin.category', category] },
              {
                $lte: [
                  { $add: ['$$cabin.bookedSeats', '$$cabin.heldSeats'] },
                  totalSeats,
                ],
              },
            ],
          },
        },
      },
    };
  }

  // Own airline, SCHEDULED and not yet departed. The departure check matters until the
  // DEPARTED job (FLT-30) has moved a flight whose time has passed.
  private editableFlight(flightId: string, airlineId: Types.ObjectId) {
    return {
      _id: flightId,
      airlineId,
      status: FlightStatus.SCHEDULED,
      departureAtUtc: { $gt: new Date(Date.now()) },
    };
  }

  // Why a conditional update matched nothing. Read-only; the answer is only an
  // explanation, the rules were already enforced by the update's filter.
  private async rejection(
    flightId: string,
    airlineId: Types.ObjectId,
    category: CabinCategory,
    action: 'add' | 'update',
    totalSeats?: number,
  ): Promise<HttpException> {
    const flight = await this.flightModel
      .findOne({ _id: flightId, airlineId })
      .select(
        'status departureAtUtc cabinInventory.category cabinInventory.bookedSeats cabinInventory.heldSeats',
      )
      .lean<FlightState>()
      .exec();
    if (!flight) {
      return this.flightNotFound();
    }
    if (flight.status !== FlightStatus.SCHEDULED) {
      return new ConflictException({
        code: 'FLIGHT_NOT_SCHEDULED',
        message: `Only a SCHEDULED flight can be changed (this one is ${flight.status})`,
      });
    }
    if (flight.departureAtUtc.getTime() <= Date.now()) {
      return new ConflictException({
        code: 'FLIGHT_ALREADY_DEPARTED',
        message:
          'This flight has already departed and can no longer be changed',
      });
    }
    const hasCabin = flight.cabinInventory.some(
      (cabin) => cabin.category === category,
    );
    if (action === 'add' && hasCabin) {
      return new ConflictException({
        code: 'CABIN_ALREADY_EXISTS',
        message: `This flight already has a ${category} cabin`,
        errors: [
          { field: 'category', messages: ['already defined for this flight'] },
        ],
      });
    }
    if (action === 'update' && !hasCabin) {
      return this.cabinNotFound(category);
    }
    const cabin = flight.cabinInventory.find((c) => c.category === category);
    if (
      action === 'update' &&
      totalSeats !== undefined &&
      cabin &&
      cabin.bookedSeats + cabin.heldSeats > totalSeats
    ) {
      return new ConflictException({
        code: 'SEATS_BELOW_BOOKED',
        message: `totalSeats cannot be lower than the seats already booked or held (${cabin.bookedSeats} booked, ${cabin.heldSeats} held)`,
        errors: [
          {
            field: 'totalSeats',
            messages: [
              `must be at least ${cabin.bookedSeats + cabin.heldSeats} (seats already booked or held)`,
            ],
          },
        ],
      });
    }
    // The flight changed between the update and this read: ask the caller to retry.
    return new ConflictException({
      code: 'FLIGHT_CHANGED',
      message: 'The flight was changed at the same time, please try again',
    });
  }

  private requireFlightId(flightId: string): void {
    if (!OBJECT_ID.test(flightId)) {
      throw this.flightNotFound();
    }
  }

  // The path value is the category (cabins have no _id in the schema).
  private parseCategory(cabinId: string): CabinCategory {
    const category = cabinId.trim().toUpperCase();
    if (!(Object.values(CabinCategory) as string[]).includes(category)) {
      throw this.cabinNotFound(cabinId);
    }
    return category as CabinCategory;
  }

  // Money is Decimal128. toFixed(2) gives the plain decimal text, never an exponent.
  private toDecimal(amount: number): Types.Decimal128 {
    return Types.Decimal128.fromString(amount.toFixed(2));
  }

  private flightNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'FLIGHT_NOT_FOUND',
      message: 'Flight not found',
    });
  }

  private cabinNotFound(category: string): NotFoundException {
    return new NotFoundException({
      code: 'CABIN_NOT_FOUND',
      message: `This flight has no ${category} cabin`,
    });
  }
}
