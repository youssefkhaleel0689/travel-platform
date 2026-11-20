import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MediaTargetType } from '../../media/media.constants';
import type { ImageFile, UploadedImage } from '../../media/media.service';
import { MediaService } from '../../media/media.service';
import { AirlineModeratorAssignment } from '../schemas/airline-moderator-assignment.schema';
import { Airline, AirlineStatus } from '../schemas/airline.schema';
import { AirlineActor, forbidden } from './airline-actor';
import { AirlineLogoDto } from './dto/airline-logo.dto';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

function airlineNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'AIRLINE_NOT_FOUND',
    message: 'Airline not found',
  });
}

function logoNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'LOGO_NOT_FOUND',
    message: 'This airline has no logo',
  });
}

// The URL that serves an airline's logo. One logo per airline, so no image id in it.
export function logoUrl(airlineId: string): string {
  return `/api/airlines/${airlineId}/logo`;
}

// FLT-01 / GEN-08: the airline logo. The image itself is stored by the shared media
// service (limit 1 for AIRLINE); this service checks who may change it and keeps
// airline.logo in step.
@Injectable()
export class AirlineLogoService {
  constructor(
    @InjectModel(Airline.name) private readonly airlineModel: Model<Airline>,
    @InjectModel(AirlineModeratorAssignment.name)
    private readonly assignmentModel: Model<AirlineModeratorAssignment>,
    private readonly media: MediaService,
  ) {}

  /**
   * Sets or replaces the logo. Admin, or the moderator assigned to this airline. A bad
   * file (400) is rejected before the old logo is touched; only a valid file replaces it.
   */
  async setLogo(
    id: string,
    actor: AirlineActor,
    file: UploadedImage | undefined,
  ): Promise<AirlineLogoDto> {
    await this.assertMayManage(id, actor);

    const store = () =>
      this.media.storeImage({
        ownerId: actor.userId,
        targetType: MediaTargetType.AIRLINE,
        targetId: id,
        file,
        urlFor: () => logoUrl(id),
      });
    let stored;
    try {
      stored = await store();
    } catch (error) {
      if (!isLimitReached(error)) {
        throw error;
      }
      // The file passed the checks and a logo already exists: replace it.
      await this.media.removeAllForTarget(MediaTargetType.AIRLINE, id);
      stored = await store();
    }
    await this.airlineModel
      .updateOne(
        { _id: new Types.ObjectId(id) },
        { $set: { logo: stored.url } },
      )
      .exec();
    return stored;
  }

  /** Public read of the logo file. A DEACTIVATED airline's logo is hidden like its profile. */
  async openLogo(id: string, actor?: AirlineActor): Promise<ImageFile> {
    if (!OBJECT_ID.test(id)) {
      throw airlineNotFound();
    }
    const airline = await this.airlineModel
      .findById(id)
      .select('status')
      .lean<Pick<Airline, 'status'>>()
      .exec();
    if (!airline) {
      throw airlineNotFound();
    }
    if (
      airline.status === AirlineStatus.DEACTIVATED &&
      !(await this.canManage(actor, new Types.ObjectId(id)))
    ) {
      throw airlineNotFound();
    }
    const [logo] = await this.media.listForTarget(MediaTargetType.AIRLINE, id);
    if (!logo) {
      throw logoNotFound();
    }
    return this.media.openForTarget(MediaTargetType.AIRLINE, id, logo.id);
  }

  /** Removes the logo and its file; airline.logo goes back to null. */
  async removeLogo(id: string, actor: AirlineActor): Promise<void> {
    await this.assertMayManage(id, actor);
    const logos = await this.media.listForTarget(MediaTargetType.AIRLINE, id);
    if (logos.length === 0) {
      throw logoNotFound();
    }
    await this.media.removeAllForTarget(MediaTargetType.AIRLINE, id);
    await this.airlineModel
      .updateOne({ _id: new Types.ObjectId(id) }, { $set: { logo: null } })
      .exec();
  }

  private async assertMayManage(
    id: string,
    actor: AirlineActor,
  ): Promise<void> {
    if (actor.role !== 'ADMIN' && actor.role !== 'AIRLINE_MODERATOR') {
      throw forbidden(
        'Only an admin or an airline moderator can change an airline logo',
      );
    }
    if (!OBJECT_ID.test(id)) {
      throw airlineNotFound();
    }
    const airlineId = new Types.ObjectId(id);
    const exists = await this.airlineModel.exists({ _id: airlineId }).exec();
    if (!exists) {
      throw airlineNotFound();
    }
    if (!(await this.canManage(actor, airlineId))) {
      throw forbidden(
        'You can only change the logo of the airline you are assigned to',
      );
    }
  }

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

function isLimitReached(error: unknown): boolean {
  if (!(error instanceof ConflictException)) {
    return false;
  }
  const body = error.getResponse() as { code?: string };
  return body.code === 'IMAGE_LIMIT_REACHED';
}
