import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { toDecimal128 } from '../common/money/money';
import { ReferenceDataService } from '../common/reference-data/reference-data.service';
import {
  CreateBudgetEntryDto,
  UpdateBudgetEntryDto,
} from './dto/budget-entry.dto';
import {
  CreateTransportCostDto,
  UpdateTransportCostDto,
} from './dto/transport-cost.dto';
import { ItinerariesService } from './itineraries.service';
import {
  findDayOrThrow,
  findOwnedByChildOrThrow,
  NotFoundError,
} from './itinerary-lookup';
import { toBudgetEntryView, toTransportCostView } from './itinerary.view';
import {
  BudgetEntry,
  Itinerary,
  TransportCost,
} from './schemas/itinerary.schema';

export const BUDGET_ENTRY_NOT_FOUND: NotFoundError = {
  code: 'BUDGET_ENTRY_NOT_FOUND',
  message: 'Budget entry not found',
};

export const TRANSPORT_COST_NOT_FOUND: NotFoundError = {
  code: 'TRANSPORT_COST_NOT_FOUND',
  message: 'Transport cost not found',
};

// Amounts arrive as numbers with at most 2 decimals (validated in the DTOs)
// and are stored as Decimal128, never as a float.
const money = (amount: number) => toDecimal128(amount.toFixed(2));

@Injectable()
export class BudgetsService {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly referenceData: ReferenceDataService,
    @InjectModel(Itinerary.name)
    private readonly itineraryModel: Model<Itinerary>,
  ) {}

  // ---------- budget entries (ITN-14) ----------

  private findOwnedByEntry(user: AuthenticatedUser, budgetId: string) {
    return findOwnedByChildOrThrow(
      this.itineraryModel,
      user,
      'days.budgetEntries._id',
      budgetId,
      BUDGET_ENTRY_NOT_FOUND,
    );
  }

  async createEntry(
    user: AuthenticatedUser,
    itineraryId: string,
    dayId: string,
    dto: CreateBudgetEntryDto,
  ) {
    const doc = await this.itineraries.findOwnedOrThrow(user, itineraryId);
    const day = findDayOrThrow(doc, dayId);
    await this.referenceData.assertSupportedCurrency(dto.currency);
    day.budgetEntries.push({
      category: dto.category,
      amount: money(dto.amount),
      currency: dto.currency,
    } as BudgetEntry);
    await doc.save();
    return toBudgetEntryView(day.budgetEntries[day.budgetEntries.length - 1]);
  }

  async updateEntry(
    user: AuthenticatedUser,
    budgetId: string,
    dto: UpdateBudgetEntryDto,
  ) {
    const doc = await this.findOwnedByEntry(user, budgetId);
    if (dto.currency !== undefined) {
      await this.referenceData.assertSupportedCurrency(dto.currency);
    }
    const oid = new Types.ObjectId(budgetId);
    const entry = doc.days
      .flatMap((d) => d.budgetEntries)
      .find((b) => b._id.equals(oid))!;
    if (dto.category !== undefined) entry.category = dto.category;
    if (dto.amount !== undefined) entry.amount = money(dto.amount);
    if (dto.currency !== undefined) entry.currency = dto.currency;
    await doc.save();
    return toBudgetEntryView(entry);
  }

  async removeEntry(user: AuthenticatedUser, budgetId: string): Promise<void> {
    const doc = await this.findOwnedByEntry(user, budgetId);
    const oid = new Types.ObjectId(budgetId);
    for (const day of doc.days) {
      day.budgetEntries = day.budgetEntries.filter((b) => !b._id.equals(oid));
    }
    await doc.save();
  }

  // ---------- intercity transport costs (ITN-16) ----------

  private findOwnedByTransport(user: AuthenticatedUser, transportId: string) {
    return findOwnedByChildOrThrow(
      this.itineraryModel,
      user,
      'transportCosts._id',
      transportId,
      TRANSPORT_COST_NOT_FOUND,
    );
  }

  async createTransport(
    user: AuthenticatedUser,
    itineraryId: string,
    dto: CreateTransportCostDto,
  ) {
    const doc = await this.itineraries.findOwnedOrThrow(user, itineraryId);
    this.assertDifferentCities(dto.fromCity, dto.toCity);
    const day = findDayOrThrow(doc, dto.dayId);
    await this.assertReferences(dto);
    doc.transportCosts.push({
      mode: dto.mode,
      fromCity: dto.fromCity,
      toCity: dto.toCity,
      amount: money(dto.amount),
      currency: dto.currency,
      dayId: day._id,
    } as TransportCost);
    await doc.save();
    return toTransportCostView(
      doc.transportCosts[doc.transportCosts.length - 1],
    );
  }

  async updateTransport(
    user: AuthenticatedUser,
    transportId: string,
    dto: UpdateTransportCostDto,
  ) {
    const doc = await this.findOwnedByTransport(user, transportId);
    const oid = new Types.ObjectId(transportId);
    const cost = doc.transportCosts.find((t) => t._id.equals(oid))!;
    this.assertDifferentCities(
      dto.fromCity ?? cost.fromCity,
      dto.toCity ?? cost.toCity,
    );
    const newDay =
      dto.dayId === undefined ? undefined : findDayOrThrow(doc, dto.dayId);
    await this.assertReferences(dto);
    if (dto.mode !== undefined) cost.mode = dto.mode;
    if (dto.fromCity !== undefined) cost.fromCity = dto.fromCity;
    if (dto.toCity !== undefined) cost.toCity = dto.toCity;
    if (dto.amount !== undefined) cost.amount = money(dto.amount);
    if (dto.currency !== undefined) cost.currency = dto.currency;
    if (newDay !== undefined) cost.dayId = newDay._id;
    await doc.save();
    return toTransportCostView(cost);
  }

  async removeTransport(
    user: AuthenticatedUser,
    transportId: string,
  ): Promise<void> {
    const doc = await this.findOwnedByTransport(user, transportId);
    const oid = new Types.ObjectId(transportId);
    doc.set(
      'transportCosts',
      doc.toObject().transportCosts.filter((t) => !t._id.equals(oid)),
    );
    await doc.save();
  }

  /** Cities and currency must exist in the seeded reference data (GEN-12). */
  private async assertReferences(dto: UpdateTransportCostDto): Promise<void> {
    if (dto.fromCity !== undefined) {
      await this.referenceData.assertCityExists(dto.fromCity);
    }
    if (dto.toCity !== undefined) {
      await this.referenceData.assertCityExists(dto.toCity);
    }
    if (dto.currency !== undefined) {
      await this.referenceData.assertSupportedCurrency(dto.currency);
    }
  }

  private assertDifferentCities(from: string, to: string) {
    if (from === to) {
      throw new BadRequestException({
        code: 'SAME_CITY',
        message: 'fromCity and toCity must be different',
      });
    }
  }
}
