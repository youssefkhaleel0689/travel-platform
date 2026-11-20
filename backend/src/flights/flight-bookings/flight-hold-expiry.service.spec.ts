import { Logger } from '@nestjs/common';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { HoldReleaseReason } from '../../common/bookings/bookings.port';
import { BookingStatus, FlightBooking } from '../schemas/flight-booking.schema';
import type { ChangeFlightService } from './change-flight.service';
import type { FlightBookingsPortAdapter } from './flight-bookings-port.adapter';
import { FlightHoldExpiryService } from './flight-hold-expiry.service';

const NOW = new Date('2026-11-18T12:00:00.000Z');
const FIRST = new Types.ObjectId();
const SECOND = new Types.ObjectId();

type Rows = { _id: Types.ObjectId }[];

// The find() query chain. It records its calls so a test can check the order and the
// limit.
interface FindQuery {
  sort: jest.Mock<FindQuery>;
  limit: jest.Mock<FindQuery>;
  lean: jest.Mock<FindQuery>;
  exec: jest.Mock<Promise<Rows>>;
}

function setup(found: Rows = [{ _id: FIRST }, { _id: SECOND }]) {
  const find: FindQuery = {
    sort: jest.fn(() => find),
    limit: jest.fn(() => find),
    lean: jest.fn(() => find),
    exec: jest.fn(() => Promise.resolve(found)),
  };
  const bookingModel = { find: jest.fn(() => find) };
  const port = { releaseHold: jest.fn(() => Promise.resolve()) };
  const changes = {
    settleExpiredChanges: jest.fn((): Promise<string[]> => Promise.resolve([])),
  };
  const service = new FlightHoldExpiryService(
    bookingModel as unknown as Model<FlightBooking>,
    port as unknown as FlightBookingsPortAdapter,
    changes as unknown as ChangeFlightService,
  );
  return { service, bookingModel, find, port, changes };
}

describe('FlightHoldExpiryService (FLT-22, GEN-11)', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('releaseExpired', () => {
    it('releases every held booking past its expiry, oldest first, 100 at a time', async () => {
      const { service, bookingModel, find, port } = setup();

      await expect(service.releaseExpired(NOW)).resolves.toBe(2);

      expect(bookingModel.find).toHaveBeenCalledWith(
        {
          status: BookingStatus.PENDING_PAYMENT,
          holdExpiresAt: { $lte: NOW },
        },
        { _id: 1 },
      );
      expect(find.sort).toHaveBeenCalledWith({ holdExpiresAt: 1 });
      expect(find.limit).toHaveBeenCalledWith(100);
      expect(port.releaseHold.mock.calls).toEqual([
        [FIRST.toString(), HoldReleaseReason.HOLD_EXPIRED],
        [SECOND.toString(), HoldReleaseReason.HOLD_EXPIRED],
      ]);
    });

    it('does nothing when no hold has run out', async () => {
      const { service, port } = setup([]);

      await expect(service.releaseExpired(NOW)).resolves.toBe(0);
      expect(port.releaseHold).not.toHaveBeenCalled();
    });

    it('carries on with the batch when one booking fails, and logs it', async () => {
      const { service, port } = setup();
      port.releaseHold.mockImplementationOnce(() =>
        Promise.reject(new Error('Seat counters out of sync')),
      );

      await expect(service.releaseExpired(NOW)).resolves.toBe(1);
      expect(port.releaseHold).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledWith(
        `Could not release the hold of flight booking ${FIRST.toString()}`,
        expect.stringContaining('Seat counters out of sync'),
      );
    });
  });

  describe('scheduledRun', () => {
    it('logs how many holds it expired', async () => {
      const { service } = setup();

      await service.scheduledRun();

      expect(logSpy).toHaveBeenCalledWith('Expired 2 flight booking hold(s)');
    });

    it('stays quiet when there was nothing to expire', async () => {
      const { service } = setup([]);

      await service.scheduledRun();

      expect(logSpy).not.toHaveBeenCalled();
    });

    it('skips a run while the previous one is still going', async () => {
      const { service, find } = setup();
      let finish: (rows: Rows) => void = () => undefined;
      find.exec.mockImplementationOnce(
        () => new Promise((resolve) => (finish = resolve)),
      );

      const first = service.scheduledRun();
      await service.scheduledRun();
      finish([]);
      await first;

      expect(find.exec).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        'Previous flight hold expiry is still running; skipping',
      );
    });

    it('never throws, so the schedule keeps running', async () => {
      const { service, find } = setup();
      find.exec.mockImplementationOnce(() =>
        Promise.reject(new Error('connection lost')),
      );

      await expect(service.scheduledRun()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        'Flight hold expiry failed',
        expect.stringContaining('connection lost'),
      );

      // The flag was reset: the next run goes ahead.
      await service.scheduledRun();
      expect(find.exec).toHaveBeenCalledTimes(2);
    });

    // FLT-27: flight changes whose seat hold has ended are settled in the same run.
    it('settles expired flight changes, and logs the ones that were settled', async () => {
      const { service, changes } = setup([]);
      changes.settleExpiredChanges.mockResolvedValue([
        'applied',
        'released',
        'waiting',
      ]);

      await service.scheduledRun();

      expect(changes.settleExpiredChanges).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(
        'Settled 2 expired flight change(s): applied, released',
      );
    });

    it('still settles flight changes when releasing holds failed', async () => {
      const { service, find, changes } = setup();
      find.exec.mockImplementationOnce(() =>
        Promise.reject(new Error('connection lost')),
      );

      await service.scheduledRun();

      expect(changes.settleExpiredChanges).toHaveBeenCalledTimes(1);
    });

    it('never throws when settling flight changes fails', async () => {
      const { service, changes } = setup([]);
      changes.settleExpiredChanges.mockRejectedValue(new Error('Stripe down'));

      await expect(service.scheduledRun()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        'Settling expired flight changes failed',
        expect.stringContaining('Stripe down'),
      );
    });
  });
});
