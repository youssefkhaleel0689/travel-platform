import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { Types } from 'mongoose';
import { PLATFORM_CURRENCY } from '../common/money/money';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { ReferenceDataService } from '../common/reference-data/reference-data.service';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { computeBudgetSummary } from './budget-summary.logic';
import { ItinerariesService } from './itineraries.service';
import { ItineraryBookingsService } from './itinerary-bookings.service';
import { ItineraryDocument } from './schemas/itinerary.schema';

// Decimal128 from the database as the decimal string the summary adds up.
const moneyText = (value: Types.Decimal128): string => value.toString();

@Injectable()
export class ItineraryBudgetSummaryService {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly exchangeRates: ExchangeRatesService,
    private readonly referenceData: ReferenceDataService,
    private readonly bookingLinks: ItineraryBookingsService,
  ) {}

  // ITN-14, ITN-18: my own itinerary. ITN-27: plus my linked bookings, which
  // stay in the platform currency because booking prices are never converted.
  async forOwner(user: AuthenticatedUser, id: string, currency: string) {
    const doc = await this.itineraries.findOwnedOrThrow(user, id);
    await this.referenceData.assertSupportedCurrency(currency);
    const [summary, linkedBookings] = await Promise.all([
      this.summarize(doc, currency),
      this.bookingLinks.summaryFor(doc),
    ]);
    const totalWithBookings =
      currency === PLATFORM_CURRENCY
        ? new Decimal(summary.total)
            .plus(new Decimal(linkedBookings.total))
            .toFixed(2)
        : null;
    return { ...summary, linkedBookings, totalWithBookings };
  }

  async summarize(doc: ItineraryDocument, currency: string) {
    const rates = await this.exchangeRates.getRates();
    const summary = computeBudgetSummary({
      days: doc.days.map((d) => ({
        id: d._id.toString(),
        city: d.city,
        budgetEntries: d.budgetEntries.map((b) => ({
          category: b.category,
          amount: moneyText(b.amount),
          currency: b.currency,
        })),
        activities: d.activities.map((a) => ({
          cost: a.cost ? moneyText(a.cost) : null,
          currency: a.currency ?? null,
        })),
      })),
      transportCosts: doc.transportCosts.map((t) => ({
        amount: moneyText(t.amount),
        currency: t.currency,
        dayId: t.dayId.toString(),
      })),
      startDate: doc.startDate,
      currency,
      rates: rates.rates,
    });
    return { ...summary, rateDate: rates.rateDate, ratesStale: rates.stale };
  }
}
