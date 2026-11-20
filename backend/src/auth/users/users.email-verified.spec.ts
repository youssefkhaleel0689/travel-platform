import { ForbiddenException } from '@nestjs/common';
import type { Model } from 'mongoose';
import type { PasswordService } from '../password/password.service';
import type { User } from '../schemas/user.schema';
import { UsersService } from './users.service';

const USER_ID = '6720f1c2a1b2c3d4e5f60718';

function setup(unverified: boolean) {
  const userModel = {
    exists: jest.fn(() => ({
      exec: () => Promise.resolve(unverified ? { _id: USER_ID } : null),
    })),
  };
  const service = new UsersService(
    userModel as unknown as Model<User>,
    {} as PasswordService,
  );
  return { service, userModel };
}

describe('UsersService.assertCanBook (ACC-02)', () => {
  const original = process.env.EMAIL_VERIFICATION_REQUIRED;
  afterEach(() => {
    process.env.EMAIL_VERIFICATION_REQUIRED = original;
  });

  it('does nothing while verification is switched off', async () => {
    process.env.EMAIL_VERIFICATION_REQUIRED = 'false';
    const { service, userModel } = setup(true);

    await expect(service.assertCanBook(USER_ID)).resolves.toBeUndefined();
    expect(userModel.exists).not.toHaveBeenCalled();
  });

  it('blocks an account whose emailVerifiedAt is an explicit null', async () => {
    process.env.EMAIL_VERIFICATION_REQUIRED = 'true';
    const { service, userModel } = setup(true);

    const error = await service.assertCanBook(USER_ID).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      code: 'EMAIL_NOT_VERIFIED',
    });
    // $type null matches a stored null only, not a missing field, so accounts
    // created before ACC-02 existed are not locked out.
    expect(userModel.exists).toHaveBeenCalledWith(
      expect.objectContaining({ emailVerifiedAt: { $type: 'null' } }),
    );
  });

  it('lets a verified (or pre-ACC-02) account book', async () => {
    process.env.EMAIL_VERIFICATION_REQUIRED = 'true';
    const { service } = setup(false);

    await expect(service.assertCanBook(USER_ID)).resolves.toBeUndefined();
  });
});
