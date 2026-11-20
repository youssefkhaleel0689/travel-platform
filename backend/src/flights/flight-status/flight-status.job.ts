import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { FlightStatusService } from './flight-status.service';

// How often the job runs. A flight can show SCHEDULED for up to this long after its
// departure time, so booking and edit code must still compare departureAtUtc with the
// clock (FLT-04 does).
export const FLIGHT_STATUS_INTERVAL_MS = 60_000;

/**
 * FLT-30 and GEN-11: the system job that marks flights DEPARTED and then completes the
 * bookings whose flights have all departed. It runs once when the server starts (to catch
 * up after downtime) and then every minute. A plain timer, so no scheduler dependency is
 * needed; to move to @nestjs/schedule later, put @Cron on run() and drop the timer. A run
 * that is still going is not started twice, and a failure is logged and retried at the
 * next tick: the job never crashes the server.
 */
@Injectable()
export class FlightStatusJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FlightStatusJob.name);
  private timer?: NodeJS.Timeout;
  // The run in progress, so shutting down can wait for it.
  private current: Promise<void> | null = null;

  constructor(private readonly flightStatus: FlightStatusService) {}

  onModuleInit(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), FLIGHT_STATUS_INTERVAL_MS);
    // The timer alone must not keep the process (or a test run) alive.
    this.timer.unref();
  }

  // Nest calls this before it closes the database connection, so a run that has already
  // started (the one at start-up, in a short test) finishes first instead of failing on a
  // closed connection.
  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.current;
  }

  async run(): Promise<void> {
    if (this.current) {
      return;
    }
    this.current = this.updateStatuses();
    try {
      await this.current;
    } finally {
      this.current = null;
    }
  }

  // Two separate steps: if one fails, the other still runs, and both are retried next tick.
  private async updateStatuses(): Promise<void> {
    try {
      const departed = await this.flightStatus.markDeparted();
      if (departed > 0) {
        this.logger.log(`Marked ${departed} flight(s) as DEPARTED`);
      }
    } catch (error) {
      this.logger.error(
        'Could not mark departed flights',
        error instanceof Error ? error.stack : String(error),
      );
    }
    try {
      const completed = await this.flightStatus.completeFlownBookings();
      if (completed > 0) {
        this.logger.log(`Marked ${completed} flight booking(s) as COMPLETED`);
      }
    } catch (error) {
      this.logger.error(
        'Could not complete flown bookings',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
