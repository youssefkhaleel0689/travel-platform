import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Model, Types } from 'mongoose';
import { HoldReleaseReason } from '../../common/bookings/bookings.port';
import { BookingStatus, FlightBooking } from '../schemas/flight-booking.schema';
import { FlightBookingsPortAdapter } from './flight-bookings-port.adapter';

/** How many expired holds one run releases; the rest wait a minute. */
const EXPIRY_BATCH_SIZE = 100;

/**
 * FLT-22: "the hold expires after 10 minutes if payment isn't completed", and GEN-11:
 * PENDING_PAYMENT becomes EXPIRED and the seats go back.
 *
 * Payments' own sweep (PaymentExpiryService, C2) only looks at bookings with an open
 * payment, so a hold the user never started paying for would keep its seats forever.
 * This job covers every held booking. Both jobs end in the same releaseHold, which only
 * matches a PENDING_PAYMENT booking, so whichever runs first releases the seats and the
 * other changes nothing.
 *
 * A TTL index cannot do this: it deletes the document, and the seat counters on the
 * flight have to move in the same transaction as the status.
 */
@Injectable()
export class FlightHoldExpiryService {
  private readonly logger = new Logger(FlightHoldExpiryService.name);
  private running = false;

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
    private readonly port: FlightBookingsPortAdapter,
  ) {}

  /** Every minute: a 10-minute hold then keeps its seats for 11 minutes at most. */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'expire-flight-holds' })
  async scheduledRun(): Promise<void> {
    // One run at a time: a slow run must not let two work on the same bookings.
    if (this.running) {
      this.logger.warn(
        'Previous flight hold expiry is still running; skipping',
      );
      return;
    }
    this.running = true;
    try {
      const expired = await this.releaseExpired();
      if (expired > 0) {
        this.logger.log(`Expired ${expired} flight booking hold(s)`);
      }
    } catch (error) {
      // A failed run must never stop the schedule: the next one retries.
      this.logger.error(
        'Flight hold expiry failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Releases the PENDING_PAYMENT bookings whose hold has run out, oldest first, and
   * returns how many it handled. Public so a test can run it without waiting.
   */
  async releaseExpired(now = new Date()): Promise<number> {
    // Served by the { status, holdExpiresAt } index on flightBookings.
    const expired = await this.bookingModel
      .find(
        {
          status: BookingStatus.PENDING_PAYMENT,
          holdExpiresAt: { $lte: now },
        },
        { _id: 1 },
      )
      .sort({ holdExpiresAt: 1 })
      .limit(EXPIRY_BATCH_SIZE)
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();

    let handled = 0;
    for (const { _id } of expired) {
      const bookingId = _id.toString();
      try {
        await this.port.releaseHold(bookingId, HoldReleaseReason.HOLD_EXPIRED);
        handled += 1;
      } catch (error) {
        // One bad booking must not stop the rest of the batch.
        this.logger.error(
          `Could not release the hold of flight booking ${bookingId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return handled;
  }
}
