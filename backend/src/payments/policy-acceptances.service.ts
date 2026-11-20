import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BookingStatus, BookingType } from '../common/bookings/booking-status';
import { BookingsGateway } from '../common/bookings/bookings.gateway';
import { PayableBooking } from '../common/bookings/bookings.port';
import { BookingPoliciesDto } from './dto/booking-policies.dto';
import { PolicyAcceptanceDto } from './dto/policy-acceptance.dto';
import {
  PolicyAcceptance,
  PolicyAcceptanceDocument,
} from './schemas/policy-acceptance.schema';

/**
 * PAY-02: show the provider's terms, record that the user accepted them, and
 * tell the payment flow whether that has happened.
 *
 * The acceptance is tied to the booking's policy version, so it proves what
 * was agreed rather than merely that a box was ticked at some point.
 */
@Injectable()
export class PolicyAcceptancesService {
  constructor(
    @InjectModel(PolicyAcceptance.name)
    private readonly acceptanceModel: Model<PolicyAcceptance>,
    private readonly bookings: BookingsGateway,
  ) {}

  /** PAY-02: the terms to display, and whether they are already accepted. */
  async getPolicies(
    userId: string,
    bookingType: BookingType,
    bookingId: string,
  ): Promise<BookingPoliciesDto> {
    await this.assertOwnBooking(userId, bookingType, bookingId);

    const policies = await this.bookings.getPoliciesOrThrow(
      bookingType,
      bookingId,
    );
    const acceptance = await this.find(
      bookingType,
      bookingId,
      policies.policyVersion,
    );
    return BookingPoliciesDto.from(policies, acceptance);
  }

  /**
   * PAY-02: records the acceptance with its timestamp.
   *
   * Accepting the same version twice returns the first acceptance instead of
   * writing a second one, so a double click or a retried request is harmless
   * and the recorded moment stays the moment the user actually agreed.
   */
  async accept(
    userId: string,
    bookingType: BookingType,
    bookingId: string,
    policyVersion: number,
  ): Promise<PolicyAcceptanceDto> {
    const booking = await this.assertOwnBooking(userId, bookingType, bookingId);

    // Terms are accepted before paying, so the booking must still be a hold.
    if (booking.status !== BookingStatus.PENDING_PAYMENT) {
      throw new ConflictException({
        code: 'BOOKING_NOT_AWAITING_PAYMENT',
        message: `This booking is ${booking.status} and no longer awaits payment`,
      });
    }

    const policies = await this.bookings.getPoliciesOrThrow(
      bookingType,
      bookingId,
    );
    if (policies.policyVersion !== policyVersion) {
      throw new ConflictException({
        code: 'POLICY_VERSION_MISMATCH',
        message:
          'The policies have changed since they were shown. Read them again ' +
          'and accept the current version.',
      });
    }

    const existing = await this.find(bookingType, bookingId, policyVersion);
    if (existing) {
      return PolicyAcceptanceDto.fromDocument(existing);
    }

    try {
      const created = await this.acceptanceModel.create({
        bookingType,
        bookingId: new Types.ObjectId(bookingId),
        userId: new Types.ObjectId(userId),
        providerType: policies.providerType,
        providerId: policies.providerId,
        policyVersion,
        policySnapshot: policies.policySnapshot,
        accepted: true,
        acceptedAt: new Date(),
      });
      return PolicyAcceptanceDto.fromDocument(created);
    } catch (error) {
      // Two requests raced and the unique index rejected the second. The first
      // one is the acceptance; returning it keeps the endpoint idempotent.
      if (isDuplicateKey(error)) {
        const winner = await this.find(bookingType, bookingId, policyVersion);
        if (winner) {
          return PolicyAcceptanceDto.fromDocument(winner);
        }
      }
      throw error;
    }
  }

  /**
   * The acceptance that covers a booking's current policy version, or null.
   * PAY-01 calls this: no acceptance means no payment.
   */
  async find(
    bookingType: BookingType,
    bookingId: string,
    policyVersion: number,
  ): Promise<PolicyAcceptanceDocument | null> {
    if (!Types.ObjectId.isValid(bookingId)) {
      return null;
    }
    return this.acceptanceModel
      .findOne({
        bookingType,
        bookingId: new Types.ObjectId(bookingId),
        policyVersion,
      })
      .exec();
  }

  /**
   * PAY-01 helper: the acceptance for whatever version the booking is on, or
   * null if the terms have not been accepted.
   */
  async findForBooking(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<PolicyAcceptanceDocument | null> {
    const policies = await this.bookings.getPoliciesOrThrow(
      bookingType,
      bookingId,
    );
    return this.find(bookingType, bookingId, policies.policyVersion);
  }

  /**
   * ACC-11: a booking belongs to one user.
   *
   * Another account's booking answers 404, exactly like one that does not
   * exist, so booking ids cannot be probed for which ones are real. The
   * requirement allows 403 or 404; 404 is used here, and in the notification
   * routes, so the whole API behaves the same way.
   */
  private async assertOwnBooking(
    userId: string,
    bookingType: BookingType,
    bookingId: string,
  ): Promise<PayableBooking> {
    const booking = await this.bookings.getPayableOrThrow(
      bookingType,
      bookingId,
    );
    if (booking.userId !== userId) {
      throw new NotFoundException('Booking not found');
    }
    return booking;
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}
