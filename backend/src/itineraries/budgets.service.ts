import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CreateBudgetEntryDto,
  UpdateBudgetEntryDto,
} from './dto/budget-entry.dto';
import {
  CreateTransportCostDto,
  UpdateTransportCostDto,
} from './dto/transport-cost.dto';
import { ItinerariesService } from './itineraries.service';
import { findDayOrThrow, findOwnedByChildOrThrow } from './itinerary-lookup';
import { toBudgetEntryView, toTransportCostView } from './itinerary.view';
import {
  BudgetEntry,
  Itinerary,
  TransportCost,
} from './schemas/itinerary.schema';

@Injectable()
export class BudgetsService {
  constructor(
    private readonly itineraries: ItinerariesService,
    @InjectModel(Itinerary.name)
    private readonly itineraryModel: Model<Itinerary>,
  ) {}

  // ---------- budget entries (ITN-14) ----------

  private findOwnedByEntry(userId: string, budgetId: string) {
    return findOwnedByChildOrThrow(
      this.itineraryModel,
      userId,
      'days.budgetEntries._id',
      budgetId,
      'Budget entry not found',
    );
  }

  async createEntry(
    userId: string,
    itineraryId: string,
    dayId: string,
    dto: CreateBudgetEntryDto,
  ) {
    const doc = await this.itineraries.findOwnedOrThrow(userId, itineraryId);
    const day = findDayOrThrow(doc, dayId);
    day.budgetEntries.push({
      category: dto.category,
      amount: dto.amount,
      currency: dto.currency,
    } as BudgetEntry);
    await doc.save();
    return toBudgetEntryView(day.budgetEntries[day.budgetEntries.length - 1]);
  }

  async updateEntry(
    userId: string,
    budgetId: string,
    dto: UpdateBudgetEntryDto,
  ) {
    const doc = await this.findOwnedByEntry(userId, budgetId);
    const oid = new Types.ObjectId(budgetId);
    const entry = doc.days
      .flatMap((d) => d.budgetEntries)
      .find((b) => b._id.equals(oid))!;
    if (dto.category !== undefined) entry.category = dto.category;
    if (dto.amount !== undefined) entry.amount = dto.amount;
    if (dto.currency !== undefined) entry.currency = dto.currency;
    await doc.save();
    return toBudgetEntryView(entry);
  }

  async removeEntry(userId: string, budgetId: string): Promise<void> {
    const doc = await this.findOwnedByEntry(userId, budgetId);
    const oid = new Types.ObjectId(budgetId);
    for (const day of doc.days) {
      day.budgetEntries = day.budgetEntries.filter((b) => !b._id.equals(oid));
    }
    await doc.save();
  }

  // ---------- intercity transport costs (ITN-16) ----------

  private findOwnedByTransport(userId: string, transportId: string) {
    return findOwnedByChildOrThrow(
      this.itineraryModel,
      userId,
      'transportCosts._id',
      transportId,
      'Transport cost not found',
    );
  }

  async createTransport(
    userId: string,
    itineraryId: string,
    dto: CreateTransportCostDto,
  ) {
    const doc = await this.itineraries.findOwnedOrThrow(userId, itineraryId);
    this.assertDifferentCities(dto.fromCity, dto.toCity);
    const day = findDayOrThrow(doc, dto.dayId);
    doc.transportCosts.push({
      mode: dto.mode,
      fromCity: dto.fromCity,
      toCity: dto.toCity,
      amount: dto.amount,
      currency: dto.currency,
      dayId: day._id,
    } as TransportCost);
    await doc.save();
    return toTransportCostView(
      doc.transportCosts[doc.transportCosts.length - 1],
    );
  }

  async updateTransport(
    userId: string,
    transportId: string,
    dto: UpdateTransportCostDto,
  ) {
    const doc = await this.findOwnedByTransport(userId, transportId);
    const oid = new Types.ObjectId(transportId);
    const cost = doc.transportCosts.find((t) => t._id.equals(oid))!;
    this.assertDifferentCities(
      dto.fromCity ?? cost.fromCity,
      dto.toCity ?? cost.toCity,
    );
    if (dto.mode !== undefined) cost.mode = dto.mode;
    if (dto.fromCity !== undefined) cost.fromCity = dto.fromCity;
    if (dto.toCity !== undefined) cost.toCity = dto.toCity;
    if (dto.amount !== undefined) cost.amount = dto.amount;
    if (dto.currency !== undefined) cost.currency = dto.currency;
    if (dto.dayId !== undefined) {
      cost.dayId = findDayOrThrow(doc, dto.dayId)._id;
    }
    await doc.save();
    return toTransportCostView(cost);
  }

  async removeTransport(userId: string, transportId: string): Promise<void> {
    const doc = await this.findOwnedByTransport(userId, transportId);
    const oid = new Types.ObjectId(transportId);
    doc.set(
      'transportCosts',
      doc.toObject().transportCosts.filter((t) => !t._id.equals(oid)),
    );
    await doc.save();
  }

  private assertDifferentCities(from: string, to: string) {
    if (from === to) {
      throw new BadRequestException({
        code: 'INVALID_VALUE',
        message: 'fromCity and toCity must be different',
      });
    }
  }
}
