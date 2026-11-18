import { Injectable } from '@nestjs/common';
import type { Types } from 'mongoose';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { ReferenceDataService } from '../common/reference-data/reference-data.service';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { computeBudgetSummary } from './budget-summary.logic';
import { ItinerariesService } from './itineraries.service';
import { ItineraryDocument } from './schemas/itinerary.schema';

// Decimal128 from the database as the decimal string the summary adds up.
const moneyText = (value: Types.Decimal128): string => value.toString();

@Injectable()
export class ItineraryBudgetSummaryService {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly exchangeRates: ExchangeRatesService,
    private readonly referenceData: ReferenceDataService,
  ) {}

  // ITN-14, ITN-18: my own itinerary
  async forOwner(user: AuthenticatedUser, id: string, currency: string) {
    const doc = await this.itineraries.findOwnedOrThrow(user, id);
    await this.referenceData.assertSupportedCurrency(currency);
    return this.summarize(doc, currency);
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
