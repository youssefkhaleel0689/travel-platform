import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { HotelBookingsService } from './hotel-bookings.service';

/**
 * Background worker: expires unpaid holds (PENDING_PAYMENT -> EXPIRED, HTL-18) and completes finished stays
 * (CONFIRMED -> COMPLETED, GEN-11). Correctness of inventory does NOT depend on this worker (expired holds never
 * block), it only keeps statuses tidy and lets Payments cancel the PaymentIntent.
 * Set B2_DISABLE_WORKER=true to turn it off (e.g. in tests).
 */
@Injectable()
export class BookingMaintenanceWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookingMaintenanceWorker.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly bookings: HotelBookingsService) {}

  onModuleInit() {
    if (process.env.B2_DISABLE_WORKER === 'true') return;
    const everyMs = Number(process.env.B2_WORKER_INTERVAL_MS) || 60_000;
    this.timer = setInterval(() => void this.tick(), everyMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    try {
      const expired = await this.bookings.expireDueHolds();
      const completed = await this.bookings.completeDueBookings();
      if (expired || completed)
        this.logger.log(`expired=${expired} completed=${completed}`);
    } catch (e) {
      this.logger.error(`Maintenance tick failed: ${(e as Error).message}`);
    }
  }
}
