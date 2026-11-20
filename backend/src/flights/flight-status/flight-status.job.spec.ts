import { Logger } from '@nestjs/common';
import {
  FLIGHT_STATUS_INTERVAL_MS,
  FlightStatusJob,
} from './flight-status.job';
import type { FlightStatusService } from './flight-status.service';

function setup(
  markDeparted: jest.Mock,
  completeFlownBookings: jest.Mock = jest.fn().mockResolvedValue(0),
) {
  const service = {
    markDeparted,
    completeFlownBookings,
  } as unknown as FlightStatusService;
  return new FlightStatusJob(service);
}

describe('FlightStatusJob (FLT-30, GEN-11)', () => {
  let log: jest.SpyInstance;
  let logError: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('runs once at start-up and then every minute until the module is destroyed', async () => {
    const markDeparted = jest.fn().mockResolvedValue(0);
    const completeFlownBookings = jest.fn().mockResolvedValue(0);
    const job = setup(markDeparted, completeFlownBookings);

    job.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(markDeparted).toHaveBeenCalledTimes(1);
    expect(completeFlownBookings).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(FLIGHT_STATUS_INTERVAL_MS);
    expect(markDeparted).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(FLIGHT_STATUS_INTERVAL_MS * 2);
    expect(markDeparted).toHaveBeenCalledTimes(4);
    expect(completeFlownBookings).toHaveBeenCalledTimes(4);

    await job.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(FLIGHT_STATUS_INTERVAL_MS * 3);
    expect(markDeparted).toHaveBeenCalledTimes(4);
  });

  it('marks flights first and then completes their bookings', async () => {
    const order: string[] = [];
    const job = setup(
      jest.fn(() => {
        order.push('flights');
        return Promise.resolve(0);
      }),
      jest.fn(() => {
        order.push('bookings');
        return Promise.resolve(0);
      }),
    );
    await job.run();
    expect(order).toEqual(['flights', 'bookings']);
  });

  it('logs how many flights and bookings changed, and nothing when none did', async () => {
    const markDeparted = jest
      .fn()
      .mockResolvedValueOnce(2)
      .mockResolvedValue(0);
    const completeFlownBookings = jest
      .fn()
      .mockResolvedValueOnce(3)
      .mockResolvedValue(0);
    const job = setup(markDeparted, completeFlownBookings);
    await job.run();
    await job.run();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith('Marked 2 flight(s) as DEPARTED');
    expect(log).toHaveBeenCalledWith('Marked 3 flight booking(s) as COMPLETED');
  });

  it('does not start a second run while one is still going', async () => {
    let finish: (value: number) => void = () => undefined;
    const markDeparted = jest.fn(
      () => new Promise<number>((resolve) => (finish = resolve)),
    );
    const job = setup(markDeparted);

    const first = job.run();
    await job.run();
    expect(markDeparted).toHaveBeenCalledTimes(1);

    finish(0);
    await first;
    const third = job.run();
    expect(markDeparted).toHaveBeenCalledTimes(2);
    finish(0);
    await third;
  });

  it('logs a failure, keeps running at the next tick and never throws', async () => {
    const markDeparted = jest
      .fn()
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValue(1);
    const job = setup(markDeparted);

    await expect(job.run()).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledTimes(1);

    await job.run();
    expect(markDeparted).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith('Marked 1 flight(s) as DEPARTED');
  });

  it('still completes bookings when marking flights failed, and the other way round', async () => {
    const completeFlownBookings = jest
      .fn()
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('connection lost'));
    const markDeparted = jest
      .fn()
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce(1);
    const job = setup(markDeparted, completeFlownBookings);

    await job.run();
    expect(completeFlownBookings).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('Marked 1 flight booking(s) as COMPLETED');

    await expect(job.run()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('Marked 1 flight(s) as DEPARTED');
    expect(logError).toHaveBeenCalledTimes(2);
  });

  it('waits for a run in progress before the module is destroyed', async () => {
    let finish: (value: number) => void = () => undefined;
    const markDeparted = jest.fn(
      () => new Promise<number>((resolve) => (finish = resolve)),
    );
    const completeFlownBookings = jest.fn().mockResolvedValue(0);
    const job = setup(markDeparted, completeFlownBookings);

    const running = job.run();
    let destroyed = false;
    const destroying = job.onModuleDestroy().then(() => {
      destroyed = true;
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(destroyed).toBe(false);

    finish(0);
    await running;
    await destroying;
    expect(destroyed).toBe(true);
    expect(completeFlownBookings).toHaveBeenCalledTimes(1);
  });

  it('is destroyed at once when no run is going', async () => {
    const job = setup(jest.fn().mockResolvedValue(0));
    await expect(job.onModuleDestroy()).resolves.toBeUndefined();
  });
});
