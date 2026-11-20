import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export interface EmailInput {
  to: string;
  subject: string;
  text: string;
}

/**
 * GEN-01-B: SMTP delivery of the in-app notices, via a test inbox in dev.
 *
 * Email is disabled unless SMTP_ENABLE=true. When it is enabled, a missing
 * value keeps the service silent (and logs a warning) rather than throwing:
 * a booking or refund must never fail because the mail server is down.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transport?: nodemailer.Transporter;

  /** False unless SMTP_ENABLE=true: callers can skip work for email. */
  get enabled(): boolean {
    return process.env.SMTP_ENABLE === 'true';
  }

  private get sender(): string {
    return (
      process.env.SMTP_FROM ||
      process.env.SMTP_USER ||
      'no-reply@travel-platform.local'
    );
  }

  private getTransport(): nodemailer.Transporter | null {
    if (!this.enabled) return null;
    if (!process.env.SMTP_HOST) {
      this.logger.warn('SMTP_ENABLE=true but SMTP_HOST is empty; email skipped');
      return null;
    }
    if (!this.transport) {
      this.transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASSWORD ?? '',
            }
          : undefined,
      });
    }
    return this.transport;
  }

  async send(input: EmailInput): Promise<void> {
    const transport = this.getTransport();
    if (!transport) return;
    try {
      await transport.sendMail({
        from: this.sender,
        to: input.to,
        subject: input.subject,
        text: input.text,
      });
    } catch (error) {
      this.logger.warn(
        `Could not send email to ${input.to}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** GEN-01-B: a newly created moderator receives their temporary password. */
  async sendModeratorInvitation(
    to: string,
    name: string,
    temporaryPassword: string,
  ): Promise<void> {
    await this.send({
      to,
      subject: 'Your Travel Platform moderator account',
      text:
        `Hello ${name},\n\n` +
        `An administrator created a moderator account for you. ` +
        `Your temporary password is: ${temporaryPassword}\n\n` +
        `Log in and change it before using any other endpoint.\n`,
    });
  }
}
