import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { AirlineModeratorAssignment } from '../schemas/airline-moderator-assignment.schema';
import { AirlinePolicy } from '../schemas/airline-policy.schema';
import { Airline, AirlineStatus } from '../schemas/airline.schema';
import { sortTiers, toAirlinePolicyDto } from './airline-policy.mapper';
import { AirlinePolicyDto } from './dto/airline-policy.dto';
import { BaggagePolicyDto } from './dto/baggage-policy.dto';
import { CancellationPolicyDto } from './dto/cancellation-policy.dto';

// MongoDB error code of a violated unique index.
const DUPLICATE_KEY_ERROR = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY_ERROR
  );
}

// Policy of an airline (FLT-08 baggage, FLT-09 cancellation tiers). One document per
// airline, created by whichever PUT comes first. Every write first checks that the airline
// exists, that the moderator is assigned to it (ACC-11, read from
// airlineModeratorAssignment on every request) and that it is not DEACTIVATED (ACC-15).
@Injectable()
export class AirlinePoliciesService {
  constructor(
    @InjectModel(AirlinePolicy.name)
    private readonly policyModel: Model<AirlinePolicy>,
    @InjectModel(Airline.name) private readonly airlineModel: Model<Airline>,
    @InjectModel(AirlineModeratorAssignment.name)
    private readonly assignmentModel: Model<AirlineModeratorAssignment>,
  ) {}

  /**
   * Read for other modules (flight details FLT-17, extra bags FLT-19/21, refund quote
   * FLT-26): the stored policy of an airline, or null when the airline has never defined
   * one. A null extraBagPrice means no extra bags can be bought; no tier means 0% refund
   * (see refundPercentageFor). The booking keeps its own snapshot, including `version`.
   */
  getForAirline(airlineId: Types.ObjectId): Promise<AirlinePolicy | null> {
    return this.policyModel.findOne({ airlineId }).lean<AirlinePolicy>().exec();
  }

  /** FLT-08: replace the baggage part of the airline's policy. */
  async setBaggagePolicy(
    airlineId: string,
    dto: BaggagePolicyDto,
    actor: AuthenticatedUser,
  ): Promise<AirlinePolicyDto> {
    const id = await this.authorise(airlineId, actor);
    return this.upsert(id, {
      $set: {
        extraBagPrice: Types.Decimal128.fromString(
          dto.extraBagPrice.toFixed(2),
        ),
        maxExtraBagsPerPassenger: dto.maxExtraBagsPerPassenger,
        updatedBy: new Types.ObjectId(actor.userId),
      },
      $inc: { version: 1 },
      $setOnInsert: { cancellationTiers: [] },
    });
  }

  /** FLT-09: replace the cancellation tiers of the airline's policy. */
  async setCancellationPolicy(
    airlineId: string,
    dto: CancellationPolicyDto,
    actor: AuthenticatedUser,
  ): Promise<AirlinePolicyDto> {
    const id = await this.authorise(airlineId, actor);
    return this.upsert(id, {
      $set: {
        cancellationTiers: sortTiers(dto.cancellationTiers).map((tier) => ({
          daysBeforeDeparture: tier.daysBeforeDeparture,
          refundPercentage: tier.refundPercentage,
        })),
        updatedBy: new Types.ObjectId(actor.userId),
      },
      $inc: { version: 1 },
      $setOnInsert: { extraBagPrice: null, maxExtraBagsPerPassenger: null },
    });
  }

  // The airline must exist (404), the moderator must be assigned to it (403) and it must
  // not be DEACTIVATED (403, ACC-15). The id comes from the path; the assignment is the
  // only proof of ownership.
  private async authorise(
    airlineId: string,
    actor: AuthenticatedUser,
  ): Promise<Types.ObjectId> {
    const id = new Types.ObjectId(airlineId);
    const airline = await this.airlineModel
      .findById(id)
      .select('status')
      .lean<Pick<Airline, 'status'>>()
      .exec();
    if (!airline) {
      throw new NotFoundException({
        code: 'AIRLINE_NOT_FOUND',
        message: 'Airline not found',
      });
    }
    const assigned = await this.assignmentModel
      .exists({ moderatorId: new Types.ObjectId(actor.userId), airlineId: id })
      .exec();
    if (!assigned) {
      throw new ForbiddenException({
        code: 'NOT_ASSIGNED_TO_AIRLINE',
        message:
          'You can only change the policy of the airline you are assigned to',
      });
    }
    if (airline.status === AirlineStatus.DEACTIVATED) {
      throw new ForbiddenException({
        code: 'AIRLINE_DEACTIVATED',
        message: 'Your airline is deactivated and cannot change its policy',
      });
    }
    return id;
  }

  // One atomic upsert: no check-then-write. If two first requests race, the unique index
  // on airlineId makes one of them fail with 11000; it is retried once and then updates.
  private async upsert(
    airlineId: Types.ObjectId,
    update: Record<string, Record<string, unknown>>,
  ): Promise<AirlinePolicyDto> {
    for (let attempt = 0; ; attempt++) {
      try {
        const saved = await this.policyModel
          .findOneAndUpdate({ airlineId }, update, {
            upsert: true,
            returnDocument: 'after',
            runValidators: true,
          })
          .lean<AirlinePolicy>()
          .exec();
        return toAirlinePolicyDto(saved);
      } catch (error) {
        if (attempt === 0 && isDuplicateKeyError(error)) {
          continue;
        }
        throw error;
      }
    }
  }
}
