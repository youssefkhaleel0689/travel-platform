import { BadRequestException } from '@nestjs/common';
import type { BookingsGateway } from '../common/bookings/bookings.gateway';
import type { AdminBookingRow } from '../common/bookings/bookings.port';
import {
  BookingStatus,
  BookingType,
  ProviderType,
} from '../common/bookings/booking-status';
import { AdminAnalyticsService } from './admin-analytics.service';

const HOTEL = '6af83761fa40574d39eb7dc2';
const AIRLINE = '6af83761fa40574d39eb7dc3';

function row(overrides: Partial<AdminBookingRow>): AdminBookingRow {
  return {
    bookingId: '6af8b9fdbc5624b5a1b41d6b',
    bookingType: BookingType.HOTEL,
    bookingReference: null,
    userId: '6720f1c2a1b2c3d4e5f60718',
    providerType: ProviderType.HOTEL,
    providerId: HOTEL,
    providerName: 'Nile View Hotel',
    startsAt: new Date('2026-12-01T00:00:00.000Z'),
    endsAt: new Date('2026-12-03T00:00:00.000Z'),
    totalAmount: '100.00',
    currency: 'USD',
    status: BookingStatus.CONFIRMED,
    createdAt: new Date('2026-11-10T10:00:00.000Z'),
    ...overrides,
  };
}

function setup(rows: AdminBookingRow[]) {
  const gateway = { listAllForAdmin: jest.fn(() => Promise.resolve(rows)) };
  const service = new AdminAnalyticsService(
    gateway as unknown as BookingsGateway,
  );
  return { service, gateway };
}

describe('AdminAnalyticsService (BON-01)', () => {
  it('counts every booking but sums revenue only from confirmed and completed ones', async () => {
    const { service, gateway } = setup([
      row({ totalAmount: '100.10' }),
      row({ totalAmount: '50.20', status: BookingStatus.COMPLETED }),
      row({ totalAmount: '999.00', status: BookingStatus.CANCELLED }),
      row({
        bookingType: BookingType.FLIGHT,
        providerType: ProviderType.AIRLINE,
        providerId: AIRLINE,
        providerName: 'Nile Air',
        totalAmount: '200.00',
      }),
    ]);

    const result = await service.get({ from: '2026-11-01', to: '2026-11-30' });

    expect(gateway.listAllForAdmin).toHaveBeenCalledWith({
      createdFrom: new Date('2026-11-01T00:00:00.000Z'),
      createdTo: new Date('2026-12-01T00:00:00.000Z'),
      bookingType: undefined,
    });
    expect(result.totalBookings).toBe(4);
    // Decimal arithmetic: 100.10 + 50.20 + 200.00, no float drift.
    expect(result.totalRevenue).toBe('350.30');
    expect(result.byProvider).toEqual([
      expect.objectContaining({
        type: BookingType.FLIGHT,
        providerId: AIRLINE,
        bookings: 1,
        revenue: '200.00',
      }),
      expect.objectContaining({
        type: BookingType.HOTEL,
        providerId: HOTEL,
        bookings: 3,
        revenue: '150.30',
      }),
    ]);
  });

  it('never adds amounts in different currencies together', async () => {
    const { service } = setup([
      row({ totalAmount: '100.00' }),
      row({ totalAmount: '500.00', currency: 'EGP' }),
    ]);

    const result = await service.get({ from: '2026-11-01', to: '2026-11-30' });

    expect(result.totalRevenue).toBe('100.00');
    expect(result.byProvider).toHaveLength(2);
  });

  it('rejects from after to with 400 INVALID_DATE_RANGE', async () => {
    const { service, gateway } = setup([]);

    await expect(
      service.get({ from: '2026-11-30', to: '2026-11-01' }),
    ).rejects.toThrow(BadRequestException);
    expect(gateway.listAllForAdmin).not.toHaveBeenCalled();
  });

  it('names the field of an impossible calendar date', async () => {
    const { service } = setup([]);

    const error = await service
      .get({ from: '2026-11-01', to: '2026-02-30' })
      .catch((e: unknown) => e);

    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ field: 'to' }],
    });
  });
});
