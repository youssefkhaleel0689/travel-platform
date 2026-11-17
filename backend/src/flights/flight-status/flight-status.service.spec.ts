import type { Model } from 'mongoose';
import { Flight, FlightStatus } from '../schemas/flight.schema';
import { FlightStatusService } from './flight-status.service';

const NOW = new Date('2026-12-20T07:00:00.000Z');

function setup(modifiedCount = 2) {
  const flightModel = {
    updateMany: jest.fn(() => ({
      exec: () => Promise.resolve({ modifiedCount }),
    })),
  };
  const service = new FlightStatusService(
    flightModel as unknown as Model<Flight>,
  );
  return { service, flightModel };
}

describe('FlightStatusService.markDeparted (FLT-30)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('moves SCHEDULED flights whose departure has passed to DEPARTED in one update', async () => {
    const { service, flightModel } = setup(3);
    await expect(service.markDeparted(NOW)).resolves.toBe(3);
    expect(flightModel.updateMany).toHaveBeenCalledTimes(1);
    expect(flightModel.updateMany).toHaveBeenCalledWith(
      { status: FlightStatus.SCHEDULED, departureAtUtc: { $lte: NOW } },
      { $set: { status: FlightStatus.DEPARTED } },
    );
  });

  it('only matches SCHEDULED flights, so CANCELLED and DEPARTED ones are never touched', async () => {
    const { service, flightModel } = setup();
    await service.markDeparted(NOW);
    const [filter] = flightModel.updateMany.mock.calls[0] as unknown as [
      { status: FlightStatus },
    ];
    expect(filter.status).toBe(FlightStatus.SCHEDULED);
  });

  it('counts a flight departing exactly now as departed', async () => {
    const { service, flightModel } = setup();
    await service.markDeparted(NOW);
    const [filter] = flightModel.updateMany.mock.calls[0] as unknown as [
      { departureAtUtc: { $lte: Date } },
    ];
    expect(filter.departureAtUtc.$lte.getTime()).toBe(NOW.getTime());
  });

  it('uses the server clock when no time is given', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
    const { service, flightModel } = setup(0);
    await expect(service.markDeparted()).resolves.toBe(0);
    const [filter] = flightModel.updateMany.mock.calls[0] as unknown as [
      { departureAtUtc: { $lte: Date } },
    ];
    expect(filter.departureAtUtc.$lte.getTime()).toBe(NOW.getTime());
  });
});
