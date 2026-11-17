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
 * FLT-30: the system job that marks flights DEPARTED. It runs once when the server starts
 * (to catch up after downtime) and then every minute. A plain timer, so no scheduler
 * dependency is needed; to move to @nestjs/schedule later, put @Cron on run() and drop the
 * timer. A run that is still going is not started twice, and a failure is logged and
 * retried at the next tick: the job never crashes the server.
 */
@Injectable()
export class FlightStatusJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FlightStatusJob.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly flightStatus: FlightStatusService) {}

  onModuleInit(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), FLIGHT_STATUS_INTERVAL_MS);
    // The timer alone must not keep the process (or a test run) alive.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async run(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const changed = await this.flightStatus.markDeparted();
      if (changed > 0) {
        this.logger.log(`Marked ${changed} flight(s) as DEPARTED`);
      }
    } catch (error) {
      this.logger.error(
        'Could not mark departed flights',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
