import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isEmail } from 'class-validator';
import { Role } from '../../common/auth/auth.enums';
import { passwordRuleViolation } from '../../common/validation/password';
import { UsersService } from '../users/users.service';

export const DEFAULT_ADMIN_NAME = 'Platform Admin';
const ADMIN_NAME_MAX_LENGTH = 100;
const ADMIN_EMAIL_MAX_LENGTH = 254;

interface AdminCredentials {
  name: string;
  email: string;
  password: string;
}

export type AdminSeedResult = 'created' | 'already-exists';

/**
 * Creates the platform admin (ACC-18). There is no admin self-registration: register always
 * creates a USER, and this seeder is the only way an ADMIN account comes into existence.
 *
 * - Credentials come only from backend/.env (ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME). Errors
 *   and logs name the variable and the rule, never the password value.
 * - It never promotes an existing account: an email that belongs to a non-admin is an error.
 * - Idempotent: when the admin already exists nothing changes, not even the password.
 */
@Injectable()
export class AdminSeeder {
  private readonly logger = new Logger(AdminSeeder.name);

  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  async seed(): Promise<AdminSeedResult> {
    // Every variable is checked before the first database query.
    const admin = this.readCredentials();

    const existing = await this.users.findByEmail(admin.email);
    if (existing) {
      return this.alreadyExists(existing.role, admin.email);
    }

    try {
      await this.users.create({
        name: admin.name,
        email: admin.email,
        password: admin.password,
        role: Role.ADMIN,
        mustChangePassword: false,
        termsAcceptedAt: null,
      });
    } catch (error) {
      // A teammate seeded the same email at the same moment: the unique index rejected
      // ours. Accept it only if what is stored now is an admin.
      if (error instanceof ConflictException) {
        const stored = await this.users.findByEmail(admin.email);
        if (stored?.role === Role.ADMIN) {
          return this.alreadyExists(stored.role, admin.email);
        }
      }
      throw error;
    }
    this.logger.log(`Admin account created for ${admin.email}`);
    return 'created';
  }

  private alreadyExists(role: Role, email: string): AdminSeedResult {
    if (role !== Role.ADMIN) {
      throw new Error(
        `ADMIN_EMAIL belongs to a non-admin account (${role}) and will not be promoted`,
      );
    }
    this.logger.log(`Admin account ${email} already exists`);
    return 'already-exists';
  }

  private readCredentials(): AdminCredentials {
    const rawEmail = this.config.get<string>('ADMIN_EMAIL');
    if (rawEmail === undefined || rawEmail.trim() === '') {
      throw new Error('ADMIN_EMAIL is required');
    }
    const email = rawEmail.trim().toLowerCase();
    if (email.length > ADMIN_EMAIL_MAX_LENGTH) {
      throw new Error(
        `ADMIN_EMAIL: must be at most ${ADMIN_EMAIL_MAX_LENGTH} characters`,
      );
    }
    if (!isEmail(email)) {
      throw new Error('ADMIN_EMAIL: must be a valid email');
    }

    // Never trimmed or changed, and never put in a message.
    const password = this.config.get<string>('ADMIN_PASSWORD');
    if (password === undefined || password === '') {
      throw new Error('ADMIN_PASSWORD is required');
    }
    const violation = passwordRuleViolation(password);
    if (violation) {
      throw new Error(`ADMIN_PASSWORD: ${violation}`);
    }

    const rawName = this.config.get<string>('ADMIN_NAME')?.trim();
    const name = rawName ? rawName : DEFAULT_ADMIN_NAME;
    if (name.length > ADMIN_NAME_MAX_LENGTH) {
      throw new Error(
        `ADMIN_NAME: must be at most ${ADMIN_NAME_MAX_LENGTH} characters`,
      );
    }

    return { name, email, password };
  }
}
