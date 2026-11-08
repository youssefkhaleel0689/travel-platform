import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { PageDto } from '../common/pagination/dto/page.dto';
import { LeanDoc, paginateQuery } from '../common/pagination/paginate';
import { ReferenceDataService } from '../common/reference-data/reference-data.service';
import {
  CURRENT_TERMS_VERSION,
  LOCKOUT_MINUTES,
  MAX_FAILED_LOGIN_ATTEMPTS,
  PASSWORD_RULE_MESSAGE,
} from './auth.constants';
import { Role } from './enums/role.enum';
import { UserStatus } from './enums/user-status.enum';
import { PasswordService } from './password.service';
import { SessionsService } from './sessions.service';
import { User, UserDocument } from './schemas/user.schema';

const MINUTE_MS = 60 * 1000;

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  phone?: string | null;
  preferredCurrency?: string | null;
  role?: Role;
  /** ACC-07a, ACC-13: the account must pick its own password before it can work. */
  mustChangePassword?: boolean;
}

export interface ProfileUpdateInput {
  name?: string;
  phone?: string | null;
  preferredCurrency?: string | null;
}

export interface AccountListFilters {
  /** Case-insensitive partial match on the name or the email (ACC-14). */
  search?: string;
  role?: Role;
  status?: UserStatus;
}

/**
 * Escapes every regular-expression metacharacter, so a search term is matched
 * literally. Without this, a term such as "(.*)+$" would be compiled as a
 * pattern and could be used to stall the server.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Owns the users collection. Every other module reaches user data through this
 * service and never through the Mongoose model, so the rules below hold
 * everywhere: the email is unique and lowercase, the password exists only as a
 * bcrypt hash, and changing it ends the account's other sessions.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionsService,
    private readonly referenceData: ReferenceDataService,
  ) {}

  /**
   * ACC-01 (registration), ACC-13 (moderator creation) and the admin seed all
   * create accounts here. The unique index on email turns a race between two
   * registrations into a 409 DUPLICATE_KEY instead of two accounts.
   */
  async create(input: CreateUserInput): Promise<UserDocument> {
    if (!this.passwords.satisfiesPolicy(input.password)) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        errors: [{ field: 'password', messages: [PASSWORD_RULE_MESSAGE] }],
      });
    }
    if (input.preferredCurrency) {
      await this.referenceData.assertSupportedCurrency(input.preferredCurrency);
    }

    const now = new Date();
    const mustChangePassword = input.mustChangePassword ?? false;
    return this.userModel.create({
      name: input.name,
      email: input.email,
      passwordHash: await this.passwords.hash(input.password),
      phone: input.phone ?? null,
      preferredCurrency: input.preferredCurrency ?? null,
      role: input.role ?? Role.USER,
      status: UserStatus.ACTIVE,
      termsAcceptedAt: now,
      termsVersion: CURRENT_TERMS_VERSION,
      failedLoginAttempts: 0,
      lockedUntil: null,
      mustChangePassword,
      temporaryPasswordIssuedAt: mustChangePassword ? now : null,
      deactivatedAt: null,
      suspendedAt: null,
    });
  }

  /** Without the password hash, which the schema never selects by default. */
  async findById(id: string | Types.ObjectId): Promise<UserDocument | null> {
    if (typeof id === 'string' && !Types.ObjectId.isValid(id)) {
      return null;
    }
    return this.userModel.findById(id).exec();
  }

  async findByIdOrThrow(id: string | Types.ObjectId): Promise<UserDocument> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('Account not found');
    }
    return user;
  }

  /** For login (ACC-04). The hash has to be asked for explicitly. */
  async findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email: email.trim().toLowerCase() })
      .select('+passwordHash')
      .exec();
  }

  /** ACC-05: true while the lockout window has not passed. */
  isLockedOut(user: UserDocument, now = new Date()): boolean {
    return user.lockedUntil !== null && user.lockedUntil > now;
  }

  /**
   * ACC-05: counts one failed login and locks the account for 15 minutes on
   * the fifth consecutive failure. $inc is atomic, so parallel attempts cannot
   * share a stale counter.
   */
  async registerFailedLogin(
    userId: Types.ObjectId,
    now = new Date(),
  ): Promise<{ locked: boolean; lockedUntil: Date | null }> {
    const updated = await this.userModel
      .findByIdAndUpdate(
        userId,
        { $inc: { failedLoginAttempts: 1 } },
        { returnDocument: 'after' },
      )
      .exec();
    if (!updated || updated.failedLoginAttempts < MAX_FAILED_LOGIN_ATTEMPTS) {
      return { locked: false, lockedUntil: null };
    }
    // The counter restarts with the lock, so the next window is another 5 tries.
    const lockedUntil = new Date(now.getTime() + LOCKOUT_MINUTES * MINUTE_MS);
    await this.userModel
      .updateOne(
        { _id: userId },
        { $set: { failedLoginAttempts: 0, lockedUntil } },
      )
      .exec();
    return { locked: true, lockedUntil };
  }

  /** ACC-05: a successful login resets the counter and clears the lock. */
  async registerSuccessfulLogin(userId: Types.ObjectId): Promise<void> {
    await this.userModel
      .updateOne(
        { _id: userId },
        { $set: { failedLoginAttempts: 0, lockedUntil: null } },
      )
      .exec();
  }

  /**
   * ACC-08: the current password must be given, so a stolen cookie alone
   * cannot take over the account. Afterwards every other session is revoked,
   * and the caller's own session survives.
   */
  async changeOwnPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    keepSessionId?: string,
  ): Promise<void> {
    const user = await this.userModel
      .findById(userId)
      .select('+passwordHash')
      .exec();
    if (!user) {
      throw new NotFoundException('Account not found');
    }

    const matches = await this.passwords.verify(
      currentPassword,
      user.passwordHash,
    );
    if (!matches) {
      throw new UnauthorizedException({
        code: 'INVALID_CURRENT_PASSWORD',
        message: 'Current password is incorrect',
      });
    }
    if (await this.passwords.verify(newPassword, user.passwordHash)) {
      throw new BadRequestException({
        code: 'PASSWORD_UNCHANGED',
        message: 'The new password must be different from the current one',
      });
    }

    await this.userModel
      .updateOne(
        { _id: user._id },
        {
          $set: {
            passwordHash: await this.passwords.hash(newPassword),
            // A chosen password clears the temporary-password state (ACC-07a).
            mustChangePassword: false,
            temporaryPasswordIssuedAt: null,
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
        },
      )
      .exec();

    await this.sessions.revokeAllForUser(user._id, {
      exceptSessionId: keepSessionId,
    });
  }

  /**
   * ACC-07a: an admin resets the password to a temporary one. The account can
   * then do nothing but set a new password (enforced by AuthenticatedGuard),
   * and all its open sessions are ended at once.
   *
   * Returns the temporary password so the admin can pass it to the person; it
   * is never stored in plain text and never logged.
   */
  async resetPasswordToTemporary(
    userId: string,
    now = new Date(),
  ): Promise<{ user: UserDocument; temporaryPassword: string }> {
    const user = await this.findByIdOrThrow(userId);
    const temporaryPassword = this.passwords.generateTemporaryPassword();

    await this.userModel
      .updateOne(
        { _id: user._id },
        {
          $set: {
            passwordHash: await this.passwords.hash(temporaryPassword),
            mustChangePassword: true,
            temporaryPasswordIssuedAt: now,
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
        },
      )
      .exec();
    await this.sessions.revokeAllForUser(user._id, { now });

    return { user, temporaryPassword };
  }

  /** ACC-09: name, phone and preferred currency. Email and role never change here. */
  async updateProfile(
    userId: string,
    input: ProfileUpdateInput,
  ): Promise<UserDocument> {
    if (input.preferredCurrency) {
      await this.referenceData.assertSupportedCurrency(input.preferredCurrency);
    }
    const user = await this.findByIdOrThrow(userId);

    if (input.name !== undefined) {
      user.name = input.name;
    }
    if (input.phone !== undefined) {
      user.phone = input.phone;
    }
    if (input.preferredCurrency !== undefined) {
      user.preferredCurrency = input.preferredCurrency;
    }
    return user.save();
  }

  /**
   * ACC-14: one page of accounts for the admin list, newest registration
   * first, optionally narrowed by a name or email fragment, a role and a
   * status.
   *
   * Returns lean documents; AdminAccountDto decides which fields reach the
   * client, so the password hash cannot travel with them.
   */
  async listAccounts(
    page: number,
    filters: AccountListFilters = {},
  ): Promise<PageDto<LeanDoc<User>>> {
    const filter: QueryFilter<User> = {};
    if (filters.role) {
      filter.role = filters.role;
    }
    if (filters.status) {
      filter.status = filters.status;
    }
    if (filters.search) {
      const term = new RegExp(escapeRegExp(filters.search.trim()), 'i');
      filter.$or = [{ name: term }, { email: term }];
    }
    return paginateQuery(this.userModel, filter, {
      page,
      sort: { createdAt: -1, _id: -1 },
    });
  }

  /**
   * Changes the account status and ends its sessions when the new status can no
   * longer log in (ACC-12, ACC-16). Returns null when the status already was
   * the requested one, so callers can stay idempotent.
   */
  async setStatus(
    userId: string,
    status: UserStatus,
    now = new Date(),
  ): Promise<UserDocument | null> {
    const user = await this.findByIdOrThrow(userId);
    if (user.status === status) {
      return null;
    }

    user.status = status;
    user.suspendedAt = status === UserStatus.SUSPENDED ? now : null;
    user.deactivatedAt = status === UserStatus.DEACTIVATED ? now : null;
    if (status === UserStatus.ACTIVE) {
      // Reactivation also clears a lockout, so the person can log in at once.
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
    }
    await user.save();

    if (status !== UserStatus.ACTIVE) {
      await this.sessions.revokeAllForUser(user._id, { now });
    }
    return user;
  }
}
