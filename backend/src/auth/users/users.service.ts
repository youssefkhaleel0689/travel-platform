import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { Role, UserStatus } from '../../common/auth/auth.enums';
import { PageDto } from '../../common/pagination/dto/page.dto';
import { paginateQuery } from '../../common/pagination/paginate';
import { PasswordService } from '../password/password.service';
import { User } from '../schemas/user.schema';
import {
  LOCKOUT_DURATION_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
} from './login-lockout';

// What the rest of the app sees of a user. Never includes passwordHash or the lockout fields.
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  preferredCurrency: string | null;
  role: Role;
  status: UserStatus;
  mustChangePassword: boolean;
  createdAt: Date;
  // ACC-12, ACC-16: when the status last changed, so the admin list and the
  // profile can show it. Null while the account has never been in that state.
  suspendedAt: Date | null;
  deactivatedAt: Date | null;
}

/** ACC-09: the only three fields an account may edit on itself. */
export interface ProfileUpdateInput {
  name?: string;
  phone?: string | null;
  preferredCurrency?: string | null;
}

/** ACC-14: how the admin account list is narrowed. */
export interface AccountListFilters {
  /** Case-insensitive partial match on the name or the email. */
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

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: Role;
  termsAcceptedAt?: Date | null;
  mustChangePassword?: boolean;
}

/**
 * Result of a login check (ACC-04, ACC-05). 'invalid' covers an unknown email and a wrong
 * password alike.
 */
export type CredentialCheck =
  | { kind: 'ok'; profile: UserProfile }
  | { kind: 'invalid' }
  | { kind: 'locked'; lockedUntil: Date };

// A lock is running while lockedUntil is in the future; an expired lock counts as none.
function isLockActive(
  lockedUntil: Date | null | undefined,
  now: Date,
): lockedUntil is Date {
  return lockedUntil instanceof Date && lockedUntil.getTime() > now.getTime();
}

// A route id is always 24 hex characters. Types.ObjectId.isValid is not used because it
// also accepts any 12-character string.
const OBJECT_ID = /^[0-9a-f]{24}$/i;

interface MongoDuplicateKeyError {
  code: 11000;
  keyValue?: Record<string, unknown>;
  keyPattern?: Record<string, unknown>;
}

// Local copy: the guard in all-exceptions.filter.ts is not exported.
function isDuplicateKeyError(e: unknown): e is MongoDuplicateKeyError {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === 11000
  );
}

function isDuplicateEmail(e: unknown): boolean {
  return (
    isDuplicateKeyError(e) &&
    ('email' in (e.keyPattern ?? {}) || 'email' in (e.keyValue ?? {}))
  );
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function emailAlreadyRegistered(): ConflictException {
  return new ConflictException({
    code: 'EMAIL_ALREADY_REGISTERED',
    message: 'email is already registered',
    errors: [{ field: 'email', messages: ['email is already registered'] }],
  });
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly passwordService: PasswordService,
  ) {}

  /**
   * Callers pass the plain password so nobody can store it unhashed (GEN-13).
   * There is no find-before-insert: the unique email index is the guarantee, and a
   * pre-check would race with a concurrent registration.
   */
  async create(input: CreateUserInput): Promise<UserProfile> {
    const passwordHash = await this.passwordService.hash(input.password);
    try {
      const created = await this.userModel.create({
        name: input.name,
        email: normalizeEmail(input.email),
        passwordHash,
        role: input.role,
        termsAcceptedAt: input.termsAcceptedAt ?? null,
        mustChangePassword: input.mustChangePassword ?? false,
      });
      return this.toUserProfile(created.toObject());
    } catch (error) {
      if (isDuplicateEmail(error)) {
        throw emailAlreadyRegistered();
      }
      throw error;
    }
  }

  /** Null when the id is not an ObjectId or no user has it. */
  async findById(id: string): Promise<UserProfile | null> {
    if (!OBJECT_ID.test(id)) {
      return null;
    }
    const user = await this.userModel.findById(id).lean<User>().exec();
    return user ? this.toUserProfile(user) : null;
  }

  async findByEmail(email: string): Promise<UserProfile | null> {
    // Normalized here: schema setters (trim, lowercase) are not relied on for query values.
    const user = await this.userModel
      .findOne({ email: normalizeEmail(email) })
      .lean<User>()
      .exec();
    return user ? this.toUserProfile(user) : null;
  }

  /**
   * Login check (ACC-04, ACC-05). The hash never leaves this method.
   *
   * Ticket design: checking the lock first and counting the failure after bcrypt (~250 ms)
   * is a time-of-check/time-of-use flaw: parallel requests all pass the check before any
   * failure is counted, so an attacker gets every parallel guess evaluated. Instead, each
   * attempt first reserves a ticket with one conditional atomic update, BEFORE bcrypt: the
   * update matches only while no lock runs and fewer than MAX_FAILED_LOGIN_ATTEMPTS tickets
   * are taken, and it adds 1 to the counter. At most MAX passwords are ever compared per
   * lock period, however many requests arrive at once.
   *
   * 1. Reserve a ticket (it also clears an expired lock). The new counter is its number.
   * 2. No ticket, so no bcrypt against the stored hash:
   *    - unknown email: the same bcrypt work on a dummy hash (timing does not reveal which
   *      emails are registered) and 'invalid'; nothing was written;
   *    - a lock running: 'locked';
   *    - otherwise all tickets are taken but no lock is written: this request writes the
   *      lock itself (see lockExhaustedTickets: a stuck last ticket heals itself) and
   *      answers 'locked'.
   * 3. Ticket taken, bcrypt:
   *    - right password: the counter and lock are reset and 'ok' with the profile whatever
   *      its status (the caller decides what a status means; a suspended account still gets
   *      403, so giving its ticket back is harmless);
   *    - wrong password with a ticket below MAX: 'invalid' (step 1 already counted it);
   *    - wrong password with the last ticket: the account is locked for
   *      LOCKOUT_DURATION_MS and the counter reset; this 5th failure already answers 'locked'.
   */
  async verifyCredentials(
    email: string,
    password: string,
  ): Promise<CredentialCheck> {
    const normalized = normalizeEmail(email);
    const now = new Date();

    const ticket = await this.userModel
      .findOneAndUpdate(
        {
          email: normalized,
          $and: [
            { $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
            {
              $or: [
                { failedLoginAttempts: { $lt: MAX_FAILED_LOGIN_ATTEMPTS } },
                { failedLoginAttempts: { $exists: false } },
              ],
            },
          ],
        },
        { $inc: { failedLoginAttempts: 1 }, $set: { lockedUntil: null } },
        { returnDocument: 'after' },
      )
      .select('+passwordHash')
      .lean<User>()
      .exec();

    if (!ticket) {
      return this.withoutTicket(normalized, password, now);
    }

    if (await this.passwordService.verify(password, ticket.passwordHash)) {
      await this.resetLoginFailures(ticket._id);
      return { kind: 'ok', profile: this.toUserProfile(ticket) };
    }
    if (ticket.failedLoginAttempts < MAX_FAILED_LOGIN_ATTEMPTS) {
      return { kind: 'invalid' };
    }
    const lockedUntil = new Date(now.getTime() + LOCKOUT_DURATION_MS);
    await this.userModel
      .updateOne(
        { _id: ticket._id },
        { $set: { lockedUntil, failedLoginAttempts: 0 } },
      )
      .exec();
    return { kind: 'locked', lockedUntil };
  }

  // Step 2 of verifyCredentials: the reservation matched nothing. The stored hash is never
  // compared here.
  private async withoutTicket(
    normalizedEmail: string,
    password: string,
    now: Date,
  ): Promise<CredentialCheck> {
    const user = await this.userModel
      .findOne({ email: normalizedEmail })
      .select('lockedUntil')
      .lean<Pick<User, '_id' | 'lockedUntil'>>()
      .exec();
    if (!user) {
      await this.passwordService.verifyDummy(password);
      return { kind: 'invalid' };
    }
    // Compared with the same `now` as the reservation, so a lock that ends between the two
    // queries still reads as the lock that refused the ticket.
    if (isLockActive(user.lockedUntil, now)) {
      return { kind: 'locked', lockedUntil: user.lockedUntil };
    }
    return this.lockExhaustedTickets(user._id, now);
  }

  /**
   * All MAX tickets are taken and no lock runs. Usually the request holding the last ticket
   * is still in bcrypt and about to write the lock or the reset. But if it died first
   * (crash, database error, bcrypt error), the counter would stay at MAX with no lock and no
   * request could ever reserve a ticket again: locked forever. So this request writes the
   * lock itself, with one conditional update that matches only while the counter is at MAX
   * and no lock runs. A stuck last ticket then heals itself after one lock period: when the
   * lock ends, the next reservation clears it. If the in-flight ticket turns out to hold the
   * right password, its reset clears this lock; if it holds a wrong one, it writes its own.
   * The stored hash is never compared here.
   */
  private async lockExhaustedTickets(
    userId: Types.ObjectId,
    now: Date,
  ): Promise<CredentialCheck> {
    const lockedUntil = new Date(now.getTime() + LOCKOUT_DURATION_MS);
    const written = await this.userModel
      .updateOne(
        {
          _id: userId,
          failedLoginAttempts: { $gte: MAX_FAILED_LOGIN_ATTEMPTS },
          $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }],
        },
        { $set: { lockedUntil, failedLoginAttempts: 0 } },
      )
      .exec();
    if (written.matchedCount > 0) {
      return { kind: 'locked', lockedUntil };
    }
    // Another request wrote a lock or a reset in between: read which.
    const current = await this.userModel
      .findById(userId)
      .select('lockedUntil')
      .lean<Pick<User, 'lockedUntil'>>()
      .exec();
    if (current && isLockActive(current.lockedUntil, now)) {
      return { kind: 'locked', lockedUntil: current.lockedUntil };
    }
    // A reset (or a counter below MAX) with no lock: this attempt was still refused a
    // ticket, so it answers locked for the full duration.
    return { kind: 'locked', lockedUntil };
  }

  // ACC-05: a right password gives its ticket back and clears any lock.
  private async resetLoginFailures(userId: Types.ObjectId): Promise<void> {
    await this.userModel
      .updateOne(
        { _id: userId },
        { $set: { failedLoginAttempts: 0, lockedUntil: null } },
      )
      .exec();
  }

  /**
   * ACC-08: changes the account's own password.
   *
   * The current password is required, so a stolen cookie on its own cannot take
   * over the account, and the new one must differ from it.
   *
   * NOTE (ACC-06, PR 4): the access token is stateless today, so there is no way
   * to revoke the tokens already issued to this account's other devices. When
   * sessions arrive, revoke every session but the caller's here.
   */
  async changeOwnPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.userModel
      .findById(userId)
      .select('+passwordHash')
      .exec();
    if (!user) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Account not found',
      });
    }

    if (!(await this.passwordService.verify(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException({
        code: 'INVALID_CURRENT_PASSWORD',
        message: 'Current password is incorrect',
      });
    }
    if (await this.passwordService.verify(newPassword, user.passwordHash)) {
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
            passwordHash: await this.passwordService.hash(newPassword),
            // Choosing a password clears the temporary-password state (ACC-07a).
            mustChangePassword: false,
            temporaryPasswordIssuedAt: null,
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
        },
      )
      .exec();
  }

  /**
   * ACC-07a: an admin resets the password to a temporary one. The account can
   * then do nothing but set a new password, and the temporary password is
   * returned once and never stored in readable form.
   */
  async resetPasswordToTemporary(
    userId: string,
    now = new Date(),
  ): Promise<{ profile: UserProfile; temporaryPassword: string }> {
    const profile = await this.findByIdOrThrow(userId);
    const temporaryPassword = this.passwordService.generateTemporary();

    await this.userModel
      .updateOne(
        { _id: profile.id },
        {
          $set: {
            passwordHash: await this.passwordService.hash(temporaryPassword),
            mustChangePassword: true,
            temporaryPasswordIssuedAt: now,
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
        },
      )
      .exec();

    return { profile, temporaryPassword };
  }

  /** ACC-09: name, phone and preferred currency. Email and role never change here. */
  async updateProfile(
    userId: string,
    input: ProfileUpdateInput,
  ): Promise<UserProfile> {
    const update: Record<string, unknown> = {};
    if (input.name !== undefined) {
      update.name = input.name;
    }
    if (input.phone !== undefined) {
      update.phone = input.phone;
    }
    if (input.preferredCurrency !== undefined) {
      update.preferredCurrency = input.preferredCurrency;
    }

    const updated = await this.userModel
      .findByIdAndUpdate(
        userId,
        { $set: update },
        { returnDocument: 'after', runValidators: true },
      )
      .lean<User>()
      .exec();
    if (!updated) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Account not found',
      });
    }
    return this.toUserProfile(updated);
  }

  /**
   * ACC-12, ACC-16: changes the account status. Returns null when the status
   * already was the requested one, so callers stay idempotent.
   *
   * Nothing is deleted. The global guard reloads the user on every request, so
   * a suspended or deactivated account stops working at once without any token
   * having to be revoked.
   */
  async setStatus(
    userId: string,
    status: UserStatus,
    now = new Date(),
  ): Promise<UserProfile | null> {
    const current = await this.findByIdOrThrow(userId);
    if (current.status === status) {
      return null;
    }

    const update: Record<string, unknown> = {
      status,
      suspendedAt: status === UserStatus.SUSPENDED ? now : null,
      deactivatedAt: status === UserStatus.DEACTIVATED ? now : null,
    };
    if (status === UserStatus.ACTIVE) {
      // Reactivation also clears a lockout, so the person can log in at once.
      update.failedLoginAttempts = 0;
      update.lockedUntil = null;
    }

    const updated = await this.userModel
      .findByIdAndUpdate(userId, { $set: update }, { returnDocument: 'after' })
      .lean<User>()
      .exec();
    return updated ? this.toUserProfile(updated) : null;
  }

  /**
   * ACC-14: one page of accounts for the admin list, newest registration first,
   * optionally narrowed by a name or email fragment, a role and a status.
   */
  async listAccounts(
    page: number,
    filters: AccountListFilters = {},
  ): Promise<PageDto<UserProfile>> {
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

    const result = await paginateQuery(this.userModel, filter, {
      page,
      sort: { createdAt: -1, _id: -1 },
    });
    return new PageDto(
      result.items.map((item) => this.toUserProfile(item as unknown as User)),
      result.meta,
    );
  }

  /** The profile, or 404. Used wherever an account id comes from a route. */
  async findByIdOrThrow(id: string): Promise<UserProfile> {
    const profile = await this.findById(id);
    if (!profile) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Account not found',
      });
    }
    return profile;
  }

  // select:false only affects queries; create() returns the document with passwordHash,
  // so every result goes through this mapper. Fields are listed one by one.
  private toUserProfile(user: User): UserProfile {
    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      phone: user.phone ?? null,
      preferredCurrency: user.preferredCurrency ?? null,
      role: user.role,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt,
      suspendedAt: user.suspendedAt ?? null,
      deactivatedAt: user.deactivatedAt ?? null,
    };
  }
}
