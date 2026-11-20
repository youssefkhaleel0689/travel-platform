import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AirlineActor, forbidden } from './airline-actor';
import { AirlineDto } from './dto/airline.dto';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';
import { Airline, AirlineStatus } from '../schemas/airline.schema';
import { AirlineModeratorAssignment } from '../schemas/airline-moderator-assignment.schema';

// Fields are listed one by one so createdBy and any future field are never exposed by accident.
function toAirlineDto(doc: Airline): AirlineDto {
  return {
    id: doc._id.toString(),
    name: doc.name,
    iataCode: doc.iataCode,
    icaoCode: doc.icaoCode ?? null,
    logo: doc.logo ?? null,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * An airline after an ACC-15 status change: what the admin endpoint reports. Kept apart
 * from AirlineDto so deactivatedAt does not become part of the public FLT-01 shape.
 */
export interface AirlineStatusChange {
  id: string;
  name: string;
  status: AirlineStatus;
  deactivatedAt: string | null;
}

function toStatusChange(doc: Airline): AirlineStatusChange {
  return {
    id: doc._id.toString(),
    name: doc.name,
    status: doc.status,
    deactivatedAt: doc.deactivatedAt ? doc.deactivatedAt.toISOString() : null,
  };
}

// A 24-character hex id. Anything else cannot name an airline, so it is a 404 like a
// missing one rather than a cast error.
const OBJECT_ID = /^[0-9a-f]{24}$/i;

function airlineNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'AIRLINE_NOT_FOUND',
    message: 'Airline not found',
  });
}

// Airline profiles (FLT-01). Every method that takes an actor checks the role and, for a
// moderator, the airlineModeratorAssignment document (ACC-11): the link lives only there.
@Injectable()
export class AirlinesService {
  constructor(
    @InjectModel(Airline.name) private readonly airlineModel: Model<Airline>,
    @InjectModel(AirlineModeratorAssignment.name)
    private readonly assignmentModel: Model<AirlineModeratorAssignment>,
  ) {}

  /** FLT-01: an admin creates an airline profile. New airlines are always ACTIVE. */
  async create(
    dto: CreateAirlineDto,
    actor: AirlineActor,
  ): Promise<AirlineDto> {
    if (actor.role !== 'ADMIN') {
      throw forbidden('Only an admin can create an airline');
    }
    const created = await this.airlineModel.create({
      name: dto.name,
      iataCode: dto.iataCode,
      ...(dto.icaoCode !== undefined && { icaoCode: dto.icaoCode }),
      status: AirlineStatus.ACTIVE,
      createdBy: new Types.ObjectId(actor.userId),
    });
    return toAirlineDto(created.toObject());
  }

  /**
   * Public read of one airline. A DEACTIVATED airline is shown only to an admin or to
   * its assigned moderator; everybody else gets 404 so its existence is not revealed.
   * `actor` is undefined for a guest.
   */
  async findOne(id: string, actor?: AirlineActor): Promise<AirlineDto> {
    const airline = await this.airlineModel.findById(id).lean<Airline>().exec();
    if (!airline) {
      throw airlineNotFound();
    }
    if (
      airline.status === AirlineStatus.DEACTIVATED &&
      !(await this.canManage(actor, airline._id))
    ) {
      throw airlineNotFound();
    }
    return toAirlineDto(airline);
  }

  /** FLT-01: an admin or the airline's assigned moderator edits name and codes. */
  async update(
    id: string,
    dto: UpdateAirlineDto,
    actor: AirlineActor,
  ): Promise<AirlineDto> {
    if (actor.role !== 'ADMIN' && actor.role !== 'AIRLINE_MODERATOR') {
      throw forbidden(
        'Only an admin or an airline moderator can edit an airline',
      );
    }

    // Only fields the client sent; an undefined value must not reach the update.
    const changes: Partial<Pick<Airline, 'name' | 'iataCode' | 'icaoCode'>> = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.iataCode !== undefined && { iataCode: dto.iataCode }),
      ...(dto.icaoCode !== undefined && { icaoCode: dto.icaoCode }),
    };
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_UPDATE',
        message: 'Send at least one of name, iataCode, icaoCode',
        errors: [
          {
            field: 'body',
            messages: ['send at least one of name, iataCode, icaoCode'],
          },
        ],
      });
    }

    const airlineId = new Types.ObjectId(id);
    const exists = await this.airlineModel.exists({ _id: airlineId }).exec();
    if (!exists) {
      throw airlineNotFound();
    }
    if (!(await this.canManage(actor, airlineId))) {
      throw forbidden('You can only edit the airline you are assigned to');
    }

    const updated = await this.airlineModel
      .findByIdAndUpdate(
        airlineId,
        { $set: changes },
        {
          returnDocument: 'after',
          runValidators: true,
        },
      )
      .lean<Airline>()
      .exec();
    if (!updated) {
      throw airlineNotFound();
    }
    return toAirlineDto(updated);
  }

  /**
   * For ACC-13 (admin creates an airline moderator): the only writer of the
   * airlineModeratorAssignment link. A moderator already assigned gets 409 DUPLICATE_KEY.
   */
  async assignModerator(moderatorId: string, airlineId: string): Promise<void> {
    const airline = new Types.ObjectId(airlineId);
    const exists = await this.airlineModel.exists({ _id: airline }).exec();
    if (!exists) {
      throw airlineNotFound();
    }
    await this.assignmentModel.create({
      moderatorId: new Types.ObjectId(moderatorId),
      airlineId: airline,
    });
  }

  // ------------------------------------------------------------------
  // Provider status (ACC-15). Called by the admin module from
  // PATCH /api/admin/providers/airline/:id/deactivate|reactivate, which also writes the
  // audit log (GEN-07) and sends the notifications. Same rules as HotelsService.
  // ------------------------------------------------------------------

  /**
   * ACTIVE -> DEACTIVATED in one conditional update, so two admins cannot both succeed.
   * 404 AIRLINE_NOT_FOUND for a missing or malformed id, 409 AIRLINE_ALREADY_DEACTIVATED
   * when it already is. Flights and bookings are not touched: search, details and holds
   * skip a DEACTIVATED airline, and CONFIRMED bookings stay valid.
   */
  async deactivate(airlineId: string): Promise<AirlineStatusChange> {
    return this.changeStatus(
      airlineId,
      AirlineStatus.ACTIVE,
      { status: AirlineStatus.DEACTIVATED, deactivatedAt: new Date() },
      new ConflictException({
        code: 'AIRLINE_ALREADY_DEACTIVATED',
        message: 'Airline is already deactivated',
      }),
    );
  }

  /** DEACTIVATED -> ACTIVE; 404 as above, 409 AIRLINE_ALREADY_ACTIVE when it already is. */
  async reactivate(airlineId: string): Promise<AirlineStatusChange> {
    return this.changeStatus(
      airlineId,
      AirlineStatus.DEACTIVATED,
      { status: AirlineStatus.ACTIVE, deactivatedAt: null },
      new ConflictException({
        code: 'AIRLINE_ALREADY_ACTIVE',
        message: 'Airline is already active',
      }),
    );
  }

  /**
   * ACC-15: the user ids of the airline's moderators, to notify them. Read-only. The
   * assignment paths are Mixed (see schema-id-paths.spec.ts), so the id is passed as an
   * ObjectId: a string would match nothing.
   */
  async findModeratorIds(airlineId: string): Promise<string[]> {
    if (!OBJECT_ID.test(airlineId)) {
      return [];
    }
    const rows = await this.assignmentModel
      .find({ airlineId: new Types.ObjectId(airlineId) }, { moderatorId: 1 })
      .lean<Pick<AirlineModeratorAssignment, 'moderatorId'>[]>()
      .exec();
    return rows.map((row) => row.moderatorId.toString());
  }

  private async changeStatus(
    airlineId: string,
    from: AirlineStatus,
    to: Pick<Airline, 'status' | 'deactivatedAt'>,
    alreadyThere: ConflictException,
  ): Promise<AirlineStatusChange> {
    if (!OBJECT_ID.test(airlineId)) {
      throw airlineNotFound();
    }
    const id = new Types.ObjectId(airlineId);
    const updated = await this.airlineModel
      .findOneAndUpdate(
        { _id: id, status: from },
        { $set: to },
        { returnDocument: 'after' },
      )
      .lean<Airline>()
      .exec();
    if (updated) {
      return toStatusChange(updated);
    }
    // Nothing matched: either there is no such airline, or it is already in `to`.
    const exists = await this.airlineModel.exists({ _id: id }).exec();
    if (!exists) {
      throw airlineNotFound();
    }
    throw alreadyThere;
  }

  // True for an admin, and for a moderator assigned to this airline. Guests and other roles: false.
  private async canManage(
    actor: AirlineActor | undefined,
    airlineId: Types.ObjectId,
  ): Promise<boolean> {
    if (!actor) {
      return false;
    }
    if (actor.role === 'ADMIN') {
      return true;
    }
    if (actor.role !== 'AIRLINE_MODERATOR') {
      return false;
    }
    const assignment = await this.assignmentModel
      .exists({ moderatorId: new Types.ObjectId(actor.userId), airlineId })
      .exec();
    return assignment !== null;
  }
}
