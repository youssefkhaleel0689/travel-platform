import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingsGateway } from '../common/bookings/bookings.gateway';
import { ReferenceDataService } from '../common/reference-data/reference-data.service';
import { MAX_FAILED_LOGIN_ATTEMPTS } from './auth.constants';
import { Role } from './enums/role.enum';
import { UserStatus } from './enums/user-status.enum';
import { PasswordService } from './password.service';
import { SessionsService } from './sessions.service';
import { User } from './schemas/user.schema';
import { UsersService } from './users.service';

type Filter = Record<string, unknown>;

describe('UsersService', () => {
  const NOW = new Date('2026-11-09T12:00:00.000Z');
  const USER_ID = '6720f1c2a1b2c3d4e5f60001';
  const SESSION_ID = '6720f1c2a1b2c3d4e5f60002';
  const objectId = new Types.ObjectId(USER_ID);

  let model: {
    create: jest.Mock;
    findById: jest.Mock;
    findOne: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    updateOne: jest.Mock;
  };
  let passwords: jest.Mocked<
    Pick<PasswordService, 'hash' | 'verify' | 'satisfiesPolicy' | 'generateTemporaryPassword'>
  >;
  let sessions: jest.Mocked<Pick<SessionsService, 'revokeAllForUser'>>;
  let referenceData: jest.Mocked<
    Pick<ReferenceDataService, 'assertSupportedCurrency'>
  >;
  let bookings: { hasUpcomingConfirmedBookings: jest.Mock };
  let service: UsersService;

  const exec = (value: unknown) => ({
    exec: jest.fn().mockResolvedValue(value),
  });

  function userDoc(overrides: Record<string, unknown> = {}) {
    return {
      _id: objectId,
      name: 'Test User',
      email: 'user@example.com',
      passwordHash: 'stored-hash',
      phone: null,
      preferredCurrency: null,
      role: Role.USER,
      status: UserStatus.ACTIVE,
      failedLoginAttempts: 0,
      lockedUntil: null,
      save: jest.fn().mockImplementation(function (this: unknown) {
        return Promise.resolve(this);
      }),
      ...overrides,
    };
  }

  beforeEach(() => {
    model = {
      create: jest.fn().mockImplementation((doc) => Promise.resolve(doc)),
      findById: jest.fn().mockReturnValue(exec(userDoc())),
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue(exec(userDoc())),
      }),
      findByIdAndUpdate: jest.fn().mockReturnValue(exec(userDoc())),
      updateOne: jest.fn().mockReturnValue(exec({ modifiedCount: 1 })),
    };
    passwords = {
      hash: jest.fn().mockResolvedValue('new-hash'),
      verify: jest.fn().mockResolvedValue(true),
      satisfiesPolicy: jest.fn().mockReturnValue(true),
      generateTemporaryPassword: jest.fn().mockReturnValue('Tmpabcde12349'),
    };
    sessions = { revokeAllForUser: jest.fn().mockResolvedValue(2) };
    referenceData = { assertSupportedCurrency: jest.fn().mockResolvedValue(undefined) };
    bookings = { hasUpcomingConfirmedBookings: jest.fn().mockResolvedValue(false) };

    service = new UsersService(
      model as unknown as import('mongoose').Model<User>,
      passwords as unknown as PasswordService,
      sessions as unknown as SessionsService,
      referenceData as unknown as ReferenceDataService,
      bookings as unknown as BookingsGateway,
    );
  });

  describe('create (ACC-01, ACC-13)', () => {
    it('stores a hash and never the plain password', async () => {
      await service.create({
        name: 'Test User',
        email: 'User@Example.com',
        password: 'GoodPass1',
      });

      const created = model.create.mock.calls[0][0] as Record<string, unknown>;
      expect(created.passwordHash).toBe('new-hash');
      expect(JSON.stringify(created)).not.toContain('GoodPass1');
      expect(created.role).toBe(Role.USER);
      expect(created.status).toBe(UserStatus.ACTIVE);
      expect(created.termsAcceptedAt).toBeInstanceOf(Date);
    });

    it('rejects a password that breaks the rules before touching the database', async () => {
      passwords.satisfiesPolicy.mockReturnValue(false);

      await expect(
        service.create({ name: 'A', email: 'a@b.com', password: 'weak' }),
      ).rejects.toThrow(BadRequestException);
      expect(model.create).not.toHaveBeenCalled();
    });

    // ACC-09, GEN-12: the currency has to be one of the seeded ones.
    it('checks the preferred currency against the seeded list', async () => {
      await service.create({
        name: 'A',
        email: 'a@b.com',
        password: 'GoodPass1',
        preferredCurrency: 'EGP',
      });

      expect(referenceData.assertSupportedCurrency).toHaveBeenCalledWith('EGP');
    });

    it('marks a temporary password as one that must be changed (ACC-07a)', async () => {
      await service.create({
        name: 'A',
        email: 'a@b.com',
        password: 'GoodPass1',
        role: Role.HOTEL_MODERATOR,
        mustChangePassword: true,
      });

      const created = model.create.mock.calls[0][0] as Record<string, unknown>;
      expect(created.mustChangePassword).toBe(true);
      expect(created.temporaryPasswordIssuedAt).toBeInstanceOf(Date);
    });
  });

  describe('findById', () => {
    it('does not query on a malformed id', async () => {
      await expect(service.findById('not-an-id')).resolves.toBeNull();
      expect(model.findById).not.toHaveBeenCalled();
    });

    it('throws NotFound from findByIdOrThrow', async () => {
      model.findById.mockReturnValue(exec(null));

      await expect(service.findByIdOrThrow(USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByEmailWithPassword (ACC-04)', () => {
    it('normalises the email and asks for the hash explicitly', async () => {
      const select = jest.fn().mockReturnValue(exec(userDoc()));
      model.findOne.mockReturnValue({ select });

      await service.findByEmailWithPassword('  User@Example.COM ');

      expect(model.findOne).toHaveBeenCalledWith({
        email: 'user@example.com',
      });
      expect(select).toHaveBeenCalledWith('+passwordHash');
    });
  });

  describe('lockout (ACC-05)', () => {
    it('counts a failure without locking before the limit', async () => {
      model.findByIdAndUpdate.mockReturnValue(
        exec(userDoc({ failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS - 1 })),
      );

      await expect(
        service.registerFailedLogin(objectId, NOW),
      ).resolves.toEqual({ locked: false, lockedUntil: null });
      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('locks for 15 minutes on the fifth consecutive failure', async () => {
      model.findByIdAndUpdate.mockReturnValue(
        exec(userDoc({ failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS })),
      );

      const result = await service.registerFailedLogin(objectId, NOW);

      expect(result.locked).toBe(true);
      expect(result.lockedUntil).toEqual(
        new Date(NOW.getTime() + 15 * 60 * 1000),
      );
      const [, update] = model.updateOne.mock.calls[0] as [Filter, Filter];
      expect(update).toEqual({
        $set: { failedLoginAttempts: 0, lockedUntil: result.lockedUntil },
      });
    });

    it('uses an atomic $inc so parallel attempts cannot share a stale count', async () => {
      await service.registerFailedLogin(objectId, NOW);

      const [, update] = model.findByIdAndUpdate.mock.calls[0] as [
        unknown,
        Filter,
      ];
      expect(update).toEqual({ $inc: { failedLoginAttempts: 1 } });
    });

    it('reports a live lock and ignores an elapsed one', () => {
      const future = new Date(NOW.getTime() + 60_000);
      const past = new Date(NOW.getTime() - 60_000);

      expect(
        service.isLockedOut(userDoc({ lockedUntil: future }) as never, NOW),
      ).toBe(true);
      expect(
        service.isLockedOut(userDoc({ lockedUntil: past }) as never, NOW),
      ).toBe(false);
      expect(service.isLockedOut(userDoc() as never, NOW)).toBe(false);
    });

    it('clears the counter and the lock on a successful login', async () => {
      await service.registerSuccessfulLogin(objectId);

      const [, update] = model.updateOne.mock.calls[0] as [Filter, Filter];
      expect(update).toEqual({
        $set: { failedLoginAttempts: 0, lockedUntil: null },
      });
    });
  });

  describe('changeOwnPassword (ACC-08)', () => {
    beforeEach(() => {
      model.findById.mockReturnValue({
        select: jest.fn().mockReturnValue(exec(userDoc())),
      });
    });

    it('stores the new hash and keeps the caller signed in', async () => {
      // First call: the current password matches. Second: the new password is
      // not the same as the stored one.
      passwords.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await service.changeOwnPassword(
        USER_ID,
        'OldPass1',
        'NewPass1',
        SESSION_ID,
      );

      const [, update] = model.updateOne.mock.calls[0] as [
        Filter,
        { $set: Record<string, unknown> },
      ];
      expect(update.$set.passwordHash).toBe('new-hash');
      expect(update.$set.mustChangePassword).toBe(false);
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(objectId, {
        exceptSessionId: SESSION_ID,
      });
    });

    it('refuses a wrong current password and writes nothing', async () => {
      passwords.verify.mockResolvedValue(false);

      await expect(
        service.changeOwnPassword(USER_ID, 'WrongPass1', 'NewPass1'),
      ).rejects.toMatchObject({
        response: { code: 'INVALID_CURRENT_PASSWORD' },
      });
      expect(model.updateOne).not.toHaveBeenCalled();
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('refuses reusing the same password', async () => {
      passwords.verify.mockResolvedValue(true);

      await expect(
        service.changeOwnPassword(USER_ID, 'SamePass1', 'SamePass1'),
      ).rejects.toMatchObject({ response: { code: 'PASSWORD_UNCHANGED' } });
      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('throws Unauthorized, not NotFound, for a wrong current password', async () => {
      passwords.verify.mockResolvedValue(false);

      await expect(
        service.changeOwnPassword(USER_ID, 'WrongPass1', 'NewPass1'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('resetPasswordToTemporary (ACC-07a)', () => {
    it('forces a change, ends every session and returns the password once', async () => {
      const result = await service.resetPasswordToTemporary(USER_ID, NOW);

      expect(result.temporaryPassword).toBe('Tmpabcde12349');
      const [, update] = model.updateOne.mock.calls[0] as [
        Filter,
        { $set: Record<string, unknown> },
      ];
      expect(update.$set.mustChangePassword).toBe(true);
      expect(update.$set.temporaryPasswordIssuedAt).toEqual(NOW);
      expect(update.$set.passwordHash).toBe('new-hash');
      // No session survives an admin reset.
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(objectId, {
        now: NOW,
      });
    });
  });

  describe('updateProfile (ACC-09)', () => {
    it('saves only the three editable fields', async () => {
      const doc = userDoc();
      model.findById.mockReturnValue(exec(doc));

      await service.updateProfile(USER_ID, {
        name: 'New Name',
        phone: '+201234567890',
        preferredCurrency: 'EUR',
      });

      expect(doc.name).toBe('New Name');
      expect(doc.phone).toBe('+201234567890');
      expect(doc.preferredCurrency).toBe('EUR');
      expect(doc.email).toBe('user@example.com');
      expect(doc.role).toBe(Role.USER);
      expect(doc.save).toHaveBeenCalled();
    });

    it('leaves out fields that were not sent', async () => {
      const doc = userDoc({ phone: '+201111111111' });
      model.findById.mockReturnValue(exec(doc));

      await service.updateProfile(USER_ID, { name: 'Only Name' });

      expect(doc.phone).toBe('+201111111111');
    });

    it('rejects an unsupported currency before saving', async () => {
      referenceData.assertSupportedCurrency.mockRejectedValue(
        new BadRequestException('Unknown currency'),
      );

      await expect(
        service.updateProfile(USER_ID, { preferredCurrency: 'XXX' }),
      ).rejects.toThrow(BadRequestException);
      expect(model.findById).not.toHaveBeenCalled();
    });
  });

  describe('deactivateOwnAccount (ACC-12)', () => {
    it('deactivates, stamps the date and ends every session', async () => {
      const doc = userDoc();
      model.findById.mockReturnValue(exec(doc));

      const result = await service.deactivateOwnAccount(USER_ID);

      expect(result.status).toBe(UserStatus.DEACTIVATED);
      expect(doc.deactivatedAt).toBeInstanceOf(Date);
      expect(sessions.revokeAllForUser).toHaveBeenCalled();
    });

    // The whole point of the requirement: a deactivated account cannot sign in
    // to manage or cancel a booking, so it must not leave one behind.
    it('refuses while an upcoming confirmed booking exists (409)', async () => {
      const doc = userDoc();
      model.findById.mockReturnValue(exec(doc));
      bookings.hasUpcomingConfirmedBookings.mockResolvedValue(true);

      await expect(
        service.deactivateOwnAccount(USER_ID),
      ).rejects.toMatchObject({
        response: { code: 'UPCOMING_BOOKINGS_EXIST' },
      });
      expect(doc.save).not.toHaveBeenCalled();
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('asks the booking modules about this account only', async () => {
      model.findById.mockReturnValue(exec(userDoc()));

      await service.deactivateOwnAccount(USER_ID);

      expect(bookings.hasUpcomingConfirmedBookings).toHaveBeenCalledWith(
        USER_ID,
      );
    });

    it('refuses an account that is already deactivated (409)', async () => {
      model.findById.mockReturnValue(
        exec(userDoc({ status: UserStatus.DEACTIVATED })),
      );

      await expect(
        service.deactivateOwnAccount(USER_ID),
      ).rejects.toMatchObject({ response: { code: 'ALREADY_DEACTIVATED' } });
      // The booking check is skipped: the state alone settles it.
      expect(bookings.hasUpcomingConfirmedBookings).not.toHaveBeenCalled();
    });

    it('throws NotFound for an unknown account', async () => {
      model.findById.mockReturnValue(exec(null));

      await expect(service.deactivateOwnAccount(USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('setStatus (ACC-12, ACC-16)', () => {
    it('suspends, stamps the date and ends every session', async () => {
      const doc = userDoc();
      model.findById.mockReturnValue(exec(doc));

      await service.setStatus(USER_ID, UserStatus.SUSPENDED, NOW);

      expect(doc.status).toBe(UserStatus.SUSPENDED);
      expect(doc.suspendedAt).toEqual(NOW);
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(objectId, {
        now: NOW,
      });
    });

    it('reactivating clears the stamps and any lockout, and keeps sessions', async () => {
      const doc = userDoc({
        status: UserStatus.SUSPENDED,
        suspendedAt: NOW,
        failedLoginAttempts: 4,
        lockedUntil: NOW,
      });
      model.findById.mockReturnValue(exec(doc));

      await service.setStatus(USER_ID, UserStatus.ACTIVE, NOW);

      expect(doc.status).toBe(UserStatus.ACTIVE);
      expect(doc.suspendedAt).toBeNull();
      expect(doc.failedLoginAttempts).toBe(0);
      expect(doc.lockedUntil).toBeNull();
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('returns null when the status is already the requested one', async () => {
      const doc = userDoc({ status: UserStatus.ACTIVE });
      model.findById.mockReturnValue(exec(doc));

      await expect(
        service.setStatus(USER_ID, UserStatus.ACTIVE, NOW),
      ).resolves.toBeNull();
      expect(doc.save).not.toHaveBeenCalled();
    });
  });
});
