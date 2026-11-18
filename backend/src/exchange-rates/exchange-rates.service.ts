import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ReferenceDataService } from '../common/reference-data/reference-data.service';
import { ExchangeRateSnapshot } from './schemas/exchange-rate-snapshot.schema';

const BASE = 'USD';
const DEFAULT_URL = 'https://api.fxratesapi.com/latest';
const TIMEOUT_MS = 5000;

export interface RatesResult {
  base: string;
  rates: Record<string, number>;
  rateDate: string; // YYYY-MM-DD, the date the rates are from
  stale: boolean; // true when the API failed and older saved rates are used
}

const sameUtcDay = (a: Date, b: Date) =>
  a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name);
  private inFlight: Promise<RatesResult> | null = null;

  constructor(
    @InjectModel(ExchangeRateSnapshot.name)
    private readonly model: Model<ExchangeRateSnapshot>,
    private readonly config: ConfigService,
    private readonly referenceData: ReferenceDataService,
  ) {}

  // 1. rates already fetched today -> use them (no API call)
  // 2. otherwise ask FXRatesAPI and save the answer
  // 3. API failed -> use the last saved rates, flagged as stale
  // 4. API failed and nothing saved -> 503
  async getRates(): Promise<RatesResult> {
    const cached = await this.model.findOne({ base: BASE }).lean();
    if (cached && sameUtcDay(cached.fetchedAt, new Date())) {
      return this.toResult(cached, false);
    }
    try {
      return await this.refresh();
    } catch (err) {
      this.logger.warn(
        `Could not refresh exchange rates: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (cached) {
        return this.toResult(cached, true);
      }
      throw new ServiceUnavailableException({
        code: 'EXCHANGE_RATES_UNAVAILABLE',
        message:
          'Exchange rates are currently unavailable. Please try again later.',
      });
    }
  }

  // Concurrent requests share one API call.
  private refresh(): Promise<RatesResult> {
    if (!this.inFlight) {
      this.inFlight = this.fetchAndStore().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async fetchAndStore(): Promise<RatesResult> {
    // Supported currencies = the seeded currency codes from Countries.csv (5.1, ITN-18).
    const currencies = await this.referenceData.listCurrencyCodes();
    // `||` (not `??`): an empty "FXRATES_API_URL=" line in .env must use the default.
    const url = new URL(
      this.config.get<string>('FXRATES_API_URL') || DEFAULT_URL,
    );
    url.searchParams.set('currencies', currencies.join(','));
    // The key stays on the server: it is sent as a header, never to the frontend.
    const apiKey = this.config.get<string>('FXRATES_API_KEY');

    const res = await fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`FXRatesAPI responded with status ${res.status}`);
    }
    const body = (await res.json()) as {
      success?: boolean;
      base?: string;
      date?: string;
      rates?: Record<string, unknown>;
    };
    if (body.success === false || body.base !== BASE || !body.rates) {
      throw new Error('Unexpected FXRatesAPI response');
    }

    const rates: Record<string, number> = {};
    for (const code of currencies) {
      const value = code === BASE ? 1 : body.rates[code];
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(`FXRatesAPI returned no usable rate for ${code}`);
      }
      rates[code] = value;
    }

    const now = new Date();
    const apiDate = body.date ? new Date(body.date) : now;
    const rateDate = Number.isNaN(apiDate.getTime()) ? now : apiDate;
    await this.model.updateOne(
      { base: BASE },
      { $set: { rates, rateDate, fetchedAt: now } },
      { upsert: true },
    );
    return {
      base: BASE,
      rates,
      rateDate: rateDate.toISOString().slice(0, 10),
      stale: false,
    };
  }

  private toResult(
    snapshot: Pick<ExchangeRateSnapshot, 'base' | 'rates' | 'rateDate'>,
    stale: boolean,
  ): RatesResult {
    return {
      base: snapshot.base,
      rates: snapshot.rates,
      rateDate: snapshot.rateDate.toISOString().slice(0, 10),
      stale,
    };
  }
}
