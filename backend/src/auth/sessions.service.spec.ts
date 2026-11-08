import { Types } from 'mongoose';
import { Session } from './schemas/session.schema';
import { SessionsService } from './sessions.service';
import {
  REFRESH_TOKEN_DAYS,
  SESSION_INACTIVITY_MINUTES,
} from './auth.constants';

type Filter = Record<string, unknown>;

describe('SessionsService', () => {
  const NOW = new Date('2026-11-09T12:00:00.000Z');
  const SESSION_ID = '6720f1c2a1b2c3d4e5f60002';

  let model: {
    create: jest.Mock;
    findOneAndUpdate: jest.Mock;
    updateOne: jest.Mock;
    updateMany: jest.Mock;
    findOne: jest.Mock;
  };
  let service: SessionsService;

  beforeEach(() => {
    const exec = (value: unknown) => ({ exec: jest.fn().mockResolvedValue(value) });
    model = {
      create: jest.fn().mockResolvedValue({ _id: SESSION_ID }),
      findOneAndUpdate: jest.fn().mockReturnValue(exec({ _id: SESSION_ID })),
      updateOne: jest.fn().mockReturnValue(exec({ modifiedCount: 1 })),
      updateMany: jest.fn().mockReturnValue(exec({ modifiedCount: 3 })),
      findOne: jest.fn().mockReturnValue(exec(null)),
    };
    service = new SessionsService(
      model as unknown as import('mongoose').Model<Session>,
    );
  });

  describe('create', () => {
    it('stores only the hash and sets the absolute expiry', async () => {
      const userId = new Types.ObjectId();

      await service.create(userId, 'sha256-hash', NOW);

      const created = model.create.mock.calls[0][0] as Record<string, unknown>;
      expect(created.refreshTokenHash).toBe('sha256-hash');
      expect(created.lastActivityAt).toEqual(NOW);
      expect(created.revokedAt).toBeNull();
      expect(created.expiresAt).toEqual(
        new Date(NOW.getTime() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000),
      );
      // Nothing resembling a raw token is written.
      expect(Object.keys(created)).not.toContain('refreshToken');
    });
  });

  describe('touchIfUsable (ACC-06)', () => {
    it('asks for a session that is live, unrevoked and recently active', async () => {
      await service.touchIfUsable(SESSION_ID, NOW);

      const [filter, update] = model.findOneAndUpdate.mock.calls[0] as [
        Filter,
        Filter,
      ];
      expect(filter.revokedAt).toBeNull();
      expect(filter.expiresAt).toEqual({ $gt: NOW });
      expect(filter.lastActivityAt).toEqual({
        $gt: new Date(NOW.getTime() - SESSION_INACTIVITY_MINUTES * 60 * 1000),
      });
      // The check and the touch are one atomic operation, so two parallel
      // requests cannot both read a stale lastActivityAt.
      expect(update).toEqual({ $set: { lastActivityAt: NOW } });
    });

    it('returns null for a malformed id without querying', async () => {
      await expect(service.touchIfUsable('not-an-object-id')).resolves.toBeNull();
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('only revokes a session that is still open', async () => {
      await service.revoke(SESSION_ID, NOW);

      const [filter, update] = model.updateOne.mock.calls[0] as [Filter, Filter];
      expect(filter.revokedAt).toBeNull();
      expect(update).toEqual({ $set: { revokedAt: NOW } });
    });

    it('ignores a malformed id', async () => {
      await service.revoke('nope');
      expect(model.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('revokeAllForUser', () => {
    it('revokes every open session of the user', async () => {
      const userId = new Types.ObjectId();

      await expect(
        service.revokeAllForUser(userId, { now: NOW }),
      ).resolves.toBe(3);

      const [filter] = model.updateMany.mock.calls[0] as [Filter];
      expect(filter).toEqual({ userId, revokedAt: null });
    });

    // ACC-08: a password change signs out the other devices but not this one.
    it('can keep the caller’s own session alive', async () => {
      const userId = new Types.ObjectId();

      await service.revokeAllForUser(userId, { exceptSessionId: SESSION_ID });

      const [filter] = model.updateMany.mock.calls[0] as [Filter];
      expect(filter._id).toEqual({ $ne: new Types.ObjectId(SESSION_ID) });
    });

    it('ignores a malformed exception id rather than skipping the revoke', async () => {
      const userId = new Types.ObjectId();

      await service.revokeAllForUser(userId, { exceptSessionId: 'nope' });

      const [filter] = model.updateMany.mock.calls[0] as [Filter];
      expect(filter._id).toBeUndefined();
    });
  });

  describe('findByRefreshTokenHash', () => {
    it('never matches a revoked or expired session', async () => {
      await service.findByRefreshTokenHash('hash', NOW);

      const [filter] = model.findOne.mock.calls[0] as [Filter];
      expect(filter).toEqual({
        refreshTokenHash: 'hash',
        revokedAt: null,
        expiresAt: { $gt: NOW },
      });
    });
  });
});
