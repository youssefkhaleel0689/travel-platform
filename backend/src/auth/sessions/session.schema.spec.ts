import { Error as MongooseError, model, Types } from 'mongoose';
import { Session, SessionSchema } from './session.schema';

// One model for the whole file. validate() needs no database connection.
const SessionModel = model(Session.name, SessionSchema);

// Returns the invalid paths.
async function errorPaths(doc: Record<string, unknown>): Promise<string[]> {
  try {
    await new SessionModel(doc).validate();
    return [];
  } catch (error) {
    if (error instanceof MongooseError.ValidationError) {
      return Object.keys(error.errors);
    }
    throw error;
  }
}

const NOW = new Date('2026-11-17T10:00:00.000Z');
const validSession = {
  userId: new Types.ObjectId(),
  refreshTokenHash: 'a'.repeat(64),
  lastActivityAt: NOW,
  expiresAt: new Date(NOW.getTime() + 5 * 60 * 60 * 1000),
};

describe('Session schema (ACC-06)', () => {
  describe('collection and indexes', () => {
    it('pins the collection name', () => {
      expect(SessionSchema.get('collection')).toBe('sessions');
    });

    it('has a unique refreshTokenHash index', () => {
      expect(SessionSchema.indexes()).toContainEqual([
        { refreshTokenHash: 1 },
        expect.objectContaining({ unique: true }),
      ]);
    });

    it('has a TTL index on expiresAt that deletes at expiresAt', () => {
      expect(SessionSchema.indexes()).toContainEqual([
        { expiresAt: 1 },
        expect.objectContaining({ expireAfterSeconds: 0 }),
      ]);
    });

    it('has a userId index', () => {
      expect(SessionSchema.indexes()).toContainEqual([
        { userId: 1 },
        expect.anything(),
      ]);
    });

    it('does not return refreshTokenHash by default', () => {
      expect(SessionSchema.path('refreshTokenHash').options.select).toBe(false);
    });

    // A Mixed path (what `type: Types.ObjectId` compiles to through @Prop) casts nothing,
    // so a string user id would be stored and matched as a string.
    it('declares userId as an ObjectId path, so string ids are cast', () => {
      expect(SessionSchema.path('userId').instance).toBe('ObjectId');
    });

    it('casts a string userId to an ObjectId', () => {
      const id = new Types.ObjectId();
      const session = new SessionModel({
        ...validSession,
        userId: id.toString(),
      });
      expect(session.userId).toBeInstanceOf(Types.ObjectId);
      expect(session.userId.equals(id)).toBe(true);
    });

    it('references the User model from userId', () => {
      expect(SessionSchema.path('userId').options.ref).toBe('User');
    });

    it('keeps createdAt but no updatedAt', () => {
      expect(SessionSchema.path('createdAt')).toBeDefined();
      expect(SessionSchema.path('updatedAt')).toBeUndefined();
    });
  });

  describe('fields', () => {
    it('accepts a complete session', async () => {
      await expect(errorPaths(validSession)).resolves.toEqual([]);
    });

    it('defaults revokedAt to null', () => {
      expect(new SessionModel(validSession).revokedAt).toBeNull();
    });

    it.each(['userId', 'refreshTokenHash', 'lastActivityAt', 'expiresAt'])(
      'requires %s',
      async (field) => {
        const doc: Record<string, unknown> = { ...validSession };
        delete doc[field];
        await expect(errorPaths(doc)).resolves.toContain(field);
      },
    );
  });
});
