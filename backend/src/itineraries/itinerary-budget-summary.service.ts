import { Injectable } from '@nestjs/common';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { computeBudgetSummary } from './budget-summary.logic';
import { ItinerariesService } from './itineraries.service';
import { ItineraryDocument } from './schemas/itinerary.schema';

@Injectable()
export class ItineraryBudgetSummaryService {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  // ITN-14, ITN-18: my own itinerary
  async forOwner(userId: string, id: string, currency: string) {
    const doc = await this.itineraries.findOwnedOrThrow(userId, id);
    return this.summarize(doc, currency);
  }

  async summarize(doc: ItineraryDocument, currency: string) {
    const rates = await this.exchangeRates.getRates();
    const summary = computeBudgetSummary({
      days: doc.days.map((d) => ({
        id: d._id.toString(),
        city: d.city,
        budgetEntries: d.budgetEntries,
        activities: d.activities,
      })),
      transportCosts: doc.transportCosts.map((t) => ({
        amount: t.amount,
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
