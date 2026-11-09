import {
  BadRequestException,
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
