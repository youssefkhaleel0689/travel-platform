import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { EMAIL_TOKEN_TTL_MS, EmailTokenService } from './email-token.service';

const USER_ID = '6720f1c2a1b2c3d4e5f60718';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// A model stand-in with the three calls the service makes.
function model(found: { userId: Types.ObjectId } | null = null) {
  return {
    updateMany: jest.fn(() => Promise.resolve({ modifiedCount: 0 })),
    create: jest.fn((doc: Record<string, unknown>) => Promise.resolve(doc)),
    findOneAndUpdate: jest.fn(() => ({ exec: () => Promise.resolve(found) })),
  };
}

function setup(found: { userId: Types.ObjectId } | null = null) {
  const verification = model(found);
  const reset = model(found);
  const service = new EmailTokenService(verification as never, reset as never);
  return { service, verification, reset };
}

describe('EmailTokenService (ACC-02, ACC-07)', () => {
  it('stores only the hash of a fresh 64-hex token, valid for 30 minutes', async () => {
    const { service, verification } = setup();
    const before = Date.now();

    const token = await service.issueVerification(USER_ID);

    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const [stored] = verification.create.mock.calls[0] as [
      { tokenHash: string; expiresAt: Date; usedAt: null },
    ];
    expect(stored.tokenHash).toBe(sha256(token));
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.usedAt).toBeNull();
    expect(stored.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + EMAIL_TOKEN_TTL_MS,
    );
  });

  it('a new reset link invalidates the older unused ones of the account', async () => {
    const { service, reset } = setup();

    await service.issueReset(USER_ID);

    expect(reset.updateMany).toHaveBeenCalledWith(
      { userId: new Types.ObjectId(USER_ID), usedAt: null },
      { $set: { usedAt: expect.any(Date) as Date } },
    );
  });

  it('consumes a token in one conditional update (unused and not expired)', async () => {
    const userId = new Types.ObjectId(USER_ID);
    const { service, reset } = setup({ userId });
    const token = 'a'.repeat(64);

    await expect(service.consumeReset(token)).resolves.toBe(USER_ID);

    expect(reset.findOneAndUpdate).toHaveBeenCalledWith(
      {
        tokenHash: sha256(token),
        usedAt: null,
        expiresAt: { $gt: expect.any(Date) as Date },
      },
      { $set: { usedAt: expect.any(Date) as Date } },
      { returnDocument: 'after' },
    );
  });

  it('rejects a used, expired or unknown token with 400 INVALID_TOKEN', async () => {
    const { service } = setup(null);

    const error = await service
      .consumeVerification('b'.repeat(64))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'INVALID_TOKEN',
    });
  });

  it('rejects a malformed token without touching the database', async () => {
    const { service, verification } = setup();

    await expect(service.consumeVerification('not-a-token')).rejects.toThrow(
      BadRequestException,
    );
    expect(verification.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
