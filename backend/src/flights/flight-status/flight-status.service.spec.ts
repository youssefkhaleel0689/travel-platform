import type { Model } from 'mongoose';
import { BookingStatus } from '../../common/bookings/booking-status';
import { FlightBooking } from '../schemas/flight-booking.schema';
import { Flight, FlightStatus } from '../schemas/flight.schema';
import { FlightStatusService } from './flight-status.service';

const NOW = new Date('2026-12-20T07:00:00.000Z');

// The filter and update one updateMany call was given.
type UpdateCall = [Record<string, unknown>, Record<string, unknown>];

function setup(modifiedCount = 2, completedCount = 0) {
  const flightModel = {
    updateMany: jest.fn(() => ({
      exec: () => Promise.resolve({ modifiedCount }),
    })),
  };
  const bookingModel = {
    updateMany: jest.fn(() => ({
      exec: () => Promise.resolve({ modifiedCount: completedCount }),
    })),
  };
  const service = new FlightStatusService(
    flightModel as unknown as Model<Flight>,
    bookingModel as unknown as Model<FlightBooking>,
  );
  return { service, flightModel, bookingModel };
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

  it('never touches bookings', async () => {
    const { service, bookingModel } = setup();
    await service.markDeparted(NOW);
    expect(bookingModel.updateMany).not.toHaveBeenCalled();
  });
});

describe('FlightStatusService.completeFlownBookings (GEN-11)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('completes CONFIRMED bookings with no flight left to depart, in one update', async () => {
    const { service, bookingModel } = setup(0, 4);
    await expect(service.completeFlownBookings(NOW)).resolves.toBe(4);
    expect(bookingModel.updateMany).toHaveBeenCalledTimes(1);
    expect(bookingModel.updateMany).toHaveBeenCalledWith(
      {
        status: BookingStatus.CONFIRMED,
        segments: { $not: { $elemMatch: { departureAtUtc: { $gt: NOW } } } },
      },
      { $set: { status: BookingStatus.COMPLETED, completedAt: NOW } },
    );
  });

  it('only matches CONFIRMED bookings, so a held, expired or cancelled one never completes', async () => {
    const { service, bookingModel } = setup();
    await service.completeFlownBookings(NOW);
    const [filter] = bookingModel.updateMany.mock
      .calls[0] as unknown as UpdateCall;
    expect(filter.status).toBe(BookingStatus.CONFIRMED);
  });

  it('uses the server clock when no time is given, for the filter and completedAt', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
    const { service, bookingModel } = setup();
    await expect(service.completeFlownBookings()).resolves.toBe(0);
    const [filter, update] = bookingModel.updateMany.mock
      .calls[0] as unknown as [
      { segments: { $not: { $elemMatch: { departureAtUtc: { $gt: Date } } } } },
      { $set: { completedAt: Date } },
    ];
    expect(filter.segments.$not.$elemMatch.departureAtUtc.$gt.getTime()).toBe(
      NOW.getTime(),
    );
    expect(update.$set.completedAt.getTime()).toBe(NOW.getTime());
  });

  it('never touches flights', async () => {
    const { service, flightModel } = setup();
    await service.completeFlownBookings(NOW);
    expect(flightModel.updateMany).not.toHaveBeenCalled();
  });
});
