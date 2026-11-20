import { BadRequestException, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { BookingsGateway } from '../common/bookings/bookings.gateway';
import {
  BookingStatus,
  BookingType,
  ProviderType,
} from '../common/bookings/booking-status';
import { PLATFORM_CURRENCY } from '../common/money/money';
import {
  AdminAnalyticsDto,
  AdminAnalyticsQueryDto,
  ProviderAnalyticsDto,
} from './dto/admin-analytics.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const REVENUE_STATUSES = new Set([
  BookingStatus.CONFIRMED,
  BookingStatus.COMPLETED,
]);

function startOfUtcDay(day: string): Date {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== day
  ) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: `${day} is not a valid date (YYYY-MM-DD)`,
      errors: [{ field: 'from', messages: ['invalid calendar date'] }],
    });
  }
  return parsed;
}

/** BON-01: bookings and revenue per provider over a selected UTC date range. */
@Injectable()
export class AdminAnalyticsService {
  constructor(private readonly bookings: BookingsGateway) {}

  async get(query: AdminAnalyticsQueryDto): Promise<AdminAnalyticsDto> {
    const from = startOfUtcDay(query.from);
    const toExclusive = new Date(startOfUtcDay(query.to).getTime() + DAY_MS);
    if (toExclusive.getTime() <= from.getTime()) {
      throw new BadRequestException({
        code: 'INVALID_DATE_RANGE',
        message: 'from must not be later than to',
        errors: [{ field: 'to', messages: ['to must be on or after from'] }],
      });
    }

    const rows = await this.bookings.listAllForAdmin({
      createdFrom: from,
      createdTo: toExclusive,
      bookingType: query.type,
    });

    const grouped = new Map<string, ProviderAnalyticsDto>();
    let totalRevenue = new Decimal(0);
    let totalBookings = 0;

    for (const row of rows) {
      totalBookings += 1;
      const key = `${row.providerType}:${row.providerId}`;
      let entry = grouped.get(key);
      if (!entry) {
        entry = {
          type:
            row.providerType === ProviderType.AIRLINE
              ? BookingType.FLIGHT
              : BookingType.HOTEL,
          providerId: row.providerId,
          providerName: row.providerName,
          bookings: 0,
          revenue: '0.00',
          currency: PLATFORM_CURRENCY,
        };
        grouped.set(key, entry);
      }
      entry.bookings += 1;
      if (REVENUE_STATUSES.has(row.status)) {
        const amount = new Decimal(row.totalAmount);
        entry.revenue = new Decimal(entry.revenue).plus(amount).toFixed(2);
        totalRevenue = totalRevenue.plus(amount);
      }
    }

    return {
      from: query.from,
      to: query.to,
      totalBookings,
      totalRevenue: totalRevenue.toFixed(2),
      currency: PLATFORM_CURRENCY,
      byProvider: [...grouped.values()].sort(
        (a, b) =>
          Number(b.revenue) - Number(a.revenue) ||
          a.providerId.localeCompare(b.providerId),
      ),
    };
  }
}
