import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'node:crypto';
import { Model, Types } from 'mongoose';
import {
  EmailVerificationToken,
  PasswordResetToken,
} from './schemas/email-token.schema';

export const EMAIL_TOKEN_TTL_MS = 30 * 60 * 1000;

const invalidToken = () =>
  new BadRequestException({
    code: 'INVALID_TOKEN',
    message: 'The link is invalid, expired or already used',
    errors: [{ field: 'token', messages: ['invalid or expired token'] }],
  });

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('hex');
}

/** ACC-02 / ACC-07: short-lived, single-use email links. Only hashes are stored. */
@Injectable()
export class EmailTokenService {
  constructor(
    @InjectModel(EmailVerificationToken.name)
    private readonly verification: Model<EmailVerificationToken>,
    @InjectModel(PasswordResetToken.name)
    private readonly reset: Model<PasswordResetToken>,
  ) {}

  async issueVerification(userId: string): Promise<string> {
    return this.issue(this.verification, userId);
  }

  async consumeVerification(token: string): Promise<string> {
    return this.consume(this.verification, token);
  }

  async issueReset(userId: string): Promise<string> {
    // A newer request invalidates every earlier one (ACC-07).
    await this.reset.updateMany(
      { userId: new Types.ObjectId(userId), usedAt: null },
      { $set: { usedAt: new Date() } },
    );
    return this.issue(this.reset, userId);
  }

  async consumeReset(token: string): Promise<string> {
    return this.consume(this.reset, token);
  }

  private async issue(
    model: Model<EmailVerificationToken | PasswordResetToken>,
    userId: string,
  ): Promise<string> {
    await model.updateMany(
      { userId: new Types.ObjectId(userId), usedAt: null },
      { $set: { usedAt: new Date() } },
    );
    const token = newToken();
    await model.create({
      userId: new Types.ObjectId(userId),
      tokenHash: hash(token),
      expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
      usedAt: null,
    });
    return token;
  }

  private async consume(
    model: Model<EmailVerificationToken | PasswordResetToken>,
    token: string,
  ): Promise<string> {
    if (!/^[a-f0-9]{64}$/i.test(token)) throw invalidToken();
    const row = await model
      .findOne({
        tokenHash: hash(token),
        usedAt: null,
        expiresAt: { $gt: new Date() },
      })
      .exec();
    if (!row) throw invalidToken();
    row.usedAt = new Date();
    await row.save();
    return String(row.userId);
  }
}
