import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { ItinerariesService } from './itineraries.service';
import { ItineraryBudgetSummaryService } from './itinerary-budget-summary.service';
import { renderItineraryPdf, ItineraryPdfView } from './itinerary-pdf';

@Injectable()
export class ItineraryPdfService {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly summaries: ItineraryBudgetSummaryService,
  ) {}

  /** ITN-28: owner-only PDF export in the requested display currency. */
  async render(
    user: AuthenticatedUser,
    id: string,
    currency: string,
  ): Promise<Buffer> {
    const [itinerary, summary] = await Promise.all([
      this.itineraries.findOne(user, id),
      this.summaries.forOwner(user, id, currency),
    ]);

    const view: ItineraryPdfView = {
      title: itinerary.title,
      startDate: itinerary.startDate,
      countries: itinerary.countries,
      days: itinerary.days.map((day) => ({
        dayNumber: day.dayNumber,
        date: day.date,
        city: day.city,
        notes: day.notes,
        activities: day.activities.map((activity) => ({
          name: activity.name,
          time: activity.time,
          cost: activity.cost,
          currency: activity.currency,
        })),
      })),
      cityGroups: itinerary.cityGroups.map((group) => ({
        city: group.city,
        fromDay: group.fromDay,
        toDay: group.toDay,
        dayCount: group.dayCount,
      })),
      transportCosts: itinerary.transportCosts.map((cost) => ({
        mode: cost.mode,
        fromCity: cost.fromCity,
        toCity: cost.toCity,
        amount: cost.amount,
        currency: cost.currency,
      })),
      summary: {
        currency: summary.currency,
        total: summary.total,
        byCategory: summary.byCategory as unknown as Record<string, string>,
        rateDate: summary.rateDate,
        ratesStale: summary.ratesStale,
      },
    };

    return renderItineraryPdf(view);
  }
}
