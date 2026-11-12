import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role, UserStatus } from '../../common/auth/auth.enums';
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
    };
  }
}
