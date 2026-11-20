import { Error as MongooseError, model } from 'mongoose';
import { Role, UserStatus } from '../../common/auth/auth.enums';
import { User, UserSchema } from './user.schema';

// One model for the whole file. validate() needs no database connection.
const UserModel = model(User.name, UserSchema);

// Returns the invalid paths.
async function errorPaths(doc: Record<string, unknown>): Promise<string[]> {
  try {
    await new UserModel(doc).validate();
    return [];
  } catch (error) {
    if (error instanceof MongooseError.ValidationError) {
      return Object.keys(error.errors);
    }
    throw error;
  }
}

const validUser = {
  name: 'Sara Ali',
  email: 'sara@example.com',
  passwordHash: '$2b$12$abcdefghijklmnopqrstuuSomeBcryptHashValue0123456789abc',
};

describe('User schema (ACC-01)', () => {
  describe('collection and indexes', () => {
    it('pins the collection name', () => {
      expect(UserSchema.get('collection')).toBe('users');
    });

    it('has a unique email index', () => {
      expect(UserSchema.indexes()).toContainEqual([
        { email: 1 },
        expect.objectContaining({ unique: true }),
      ]);
    });

    it('does not return passwordHash by default', () => {
      expect(UserSchema.path('passwordHash').options.select).toBe(false);
    });
  });

  describe('fields', () => {
    it('accepts only name, email and passwordHash', async () => {
      await expect(errorPaths(validUser)).resolves.toEqual([]);
    });

    it('applies the defaults', () => {
      const user = new UserModel(validUser);
      expect(user.role).toBe(Role.USER);
      expect(user.status).toBe(UserStatus.ACTIVE);
      expect(user.failedLoginAttempts).toBe(0);
      expect(user.mustChangePassword).toBe(false);
      expect(user.lockedUntil).toBeNull();
      expect(user.termsAcceptedAt).toBeNull();
      expect(user.phone).toBeNull();
      expect(user.preferredCurrency).toBeNull();
    });

    it('trims and lower-cases the email', () => {
      const user = new UserModel({
        ...validUser,
        email: '  Sara@Example.COM ',
      });
      expect(user.email).toBe('sara@example.com');
    });

    it.each(['name', 'email', 'passwordHash'])('requires %s', async (field) => {
      const doc: Record<string, unknown> = { ...validUser };
      delete doc[field];
      await expect(errorPaths(doc)).resolves.toContain(field);
    });

    it('rejects an unknown role', async () => {
      await expect(
        errorPaths({ ...validUser, role: 'SUPERADMIN' }),
      ).resolves.toEqual(['role']);
    });

    it('rejects an unknown status', async () => {
      await expect(
        errorPaths({ ...validUser, status: 'BANNED' }),
      ).resolves.toEqual(['status']);
    });

    it('rejects a negative failedLoginAttempts', async () => {
      await expect(
        errorPaths({ ...validUser, failedLoginAttempts: -1 }),
      ).resolves.toEqual(['failedLoginAttempts']);
    });
  });
});
