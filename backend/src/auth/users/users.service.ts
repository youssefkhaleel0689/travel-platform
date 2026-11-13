import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter } from 'mongoose';
import { Role, UserStatus } from '../../common/auth/auth.enums';
import { PageDto } from '../../common/pagination/dto/page.dto';
import { paginateQuery } from '../../common/pagination/paginate';
import { PasswordService } from '../password/password.service';
import { User } from '../schemas/user.schema';

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
   * Login check (ACC-04): the profile when the email and password match, otherwise null.
   * Returns the profile whatever its status; the caller decides what a status means. The
   * hash never leaves this method.
   */
  async verifyCredentials(
    email: string,
    password: string,
  ): Promise<{ profile: UserProfile } | null> {
    const user = await this.userModel
      .findOne({ email: normalizeEmail(email) })
      .select('+passwordHash')
      .lean<User>()
      .exec();
    if (!user) {
      // Same bcrypt work as a known email, so timing does not reveal registered emails.
      await this.passwordService.verifyDummy(password);
      return null;
    }
    // TODO(ACC-05, PR 3): the lockout check (lockedUntil, failedLoginAttempts) goes here,
    // before the password is compared, and a wrong password increments the counter.
    if (!(await this.passwordService.verify(password, user.passwordHash))) {
      return null;
    }
    return { profile: this.toUserProfile(user) };
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
