import { Logger } from '@nestjs/common';
import {
  FLIGHT_STATUS_INTERVAL_MS,
  FlightStatusJob,
} from './flight-status.job';
import type { FlightStatusService } from './flight-status.service';

function setup(markDeparted: jest.Mock) {
  const service = { markDeparted } as unknown as FlightStatusService;
  return new FlightStatusJob(service);
}

describe('FlightStatusJob (FLT-30)', () => {
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
    const job = setup(markDeparted);

    job.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(markDeparted).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(FLIGHT_STATUS_INTERVAL_MS);
    expect(markDeparted).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(FLIGHT_STATUS_INTERVAL_MS * 2);
    expect(markDeparted).toHaveBeenCalledTimes(4);

    job.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(FLIGHT_STATUS_INTERVAL_MS * 3);
    expect(markDeparted).toHaveBeenCalledTimes(4);
  });

  it('logs how many flights were marked, and nothing when none changed', async () => {
    const markDeparted = jest
      .fn()
      .mockResolvedValueOnce(2)
      .mockResolvedValue(0);
    const job = setup(markDeparted);
    await job.run();
    await job.run();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('Marked 2 flight(s) as DEPARTED');
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
});
