import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { convertAmount } from './convert';
import { ExchangeRatesService } from './exchange-rates.service';
import { ExchangeRateSnapshot } from './schemas/exchange-rate-snapshot.schema';

const RATES = {
  USD: 1,
  EUR: 0.9,
  GBP: 0.8,
  EGP: 50,
  AED: 3.67,
  JPY: 150,
  SAR: 3.75,
};

function setup(
  cached: Partial<ExchangeRateSnapshot> | null,
  env: Record<string, string | undefined> = {},
) {
  const updateOne = jest.fn().mockResolvedValue({});
  const model = {
    findOne: jest.fn().mockReturnValue({ lean: () => Promise.resolve(cached) }),
    updateOne,
  } as unknown as Model<ExchangeRateSnapshot>;
  const config = {
    get: jest.fn((key: string) => env[key]),
  } as unknown as ConfigService;
  return { service: new ExchangeRatesService(model, config), updateOne };
}

function mockFetch(impl: () => Promise<Partial<Response>>) {
  const spy = jest.fn(impl);
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

const okResponse =
  (rates: Record<string, unknown> = RATES) =>
  () =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          base: 'USD',
          date: '2026-11-05T00:00:00.000Z',
          rates,
        }),
    });

const snapshot = (fetchedAt: Date): Partial<ExchangeRateSnapshot> => ({
  base: 'USD',
  rates: { ...RATES, EUR: 0.5 },
  rateDate: new Date('2026-11-01'),
  fetchedAt,
});

describe('ExchangeRatesService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("uses today's saved rates without calling the API", async () => {
    const { service } = setup(snapshot(new Date()));
    const spy = mockFetch(okResponse());
    const result = await service.getRates();
    expect(spy).not.toHaveBeenCalled();
    expect(result).toMatchObject({ stale: false, rateDate: '2026-11-01' });
  });

  it('fetches and saves when nothing is saved', async () => {
    const { service, updateOne } = setup(null);
    const spy = mockFetch(okResponse());
    const result = await service.getRates();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ stale: false, rateDate: '2026-11-05' });
    expect(result.rates.EUR).toBe(0.9);
  });

  it('uses the default URL when FXRATES_API_URL is empty in .env', async () => {
    const { service } = setup(null, {
      FXRATES_API_URL: '',
      FXRATES_API_KEY: '',
    });
    const spy = mockFetch(okResponse());
    const result = await service.getRates();
    expect(result.stale).toBe(false);
    const calledUrl = String((spy.mock.calls[0] as unknown[])[0]);
    expect(calledUrl.startsWith('https://api.fxratesapi.com/latest')).toBe(
      true,
    );
    const init = (spy.mock.calls[0] as unknown[])[1] as { headers: object };
    expect(init.headers).toEqual({});
  });

  it('sends the API key as a header, never in the URL', async () => {
    const { service } = setup(null, { FXRATES_API_KEY: 'k123' });
    const spy = mockFetch(okResponse());
    await service.getRates();
    const calledUrl = String((spy.mock.calls[0] as unknown[])[0]);
    expect(calledUrl).not.toContain('k123');
    const init = (spy.mock.calls[0] as unknown[])[1] as {
      headers: Record<string, string>;
    };
    expect(init.headers.Authorization).toBe('Bearer k123');
  });

  it('refreshes when the saved rates are from an earlier day', async () => {
    const { service } = setup(snapshot(new Date(Date.now() - 2 * 86400000)));
    const spy = mockFetch(okResponse());
    const result = await service.getRates();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.rates.EUR).toBe(0.9);
  });

  it('falls back to old saved rates (stale) when the API fails', async () => {
    const { service, updateOne } = setup(
      snapshot(new Date(Date.now() - 2 * 86400000)),
    );
    mockFetch(() => Promise.resolve({ ok: false, status: 500 }));
    const result = await service.getRates();
    expect(result.stale).toBe(true);
    expect(result.rates.EUR).toBe(0.5);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('falls back when the request itself throws (timeout / network)', async () => {
    const { service } = setup(snapshot(new Date(Date.now() - 2 * 86400000)));
    mockFetch(() => Promise.reject(new Error('network down')));
    expect((await service.getRates()).stale).toBe(true);
  });

  it('throws 503 when the API fails and nothing is saved', async () => {
    const { service } = setup(null);
    mockFetch(() => Promise.resolve({ ok: false, status: 500 }));
    await expect(service.getRates()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('rejects incomplete or invalid API data instead of saving it', async () => {
    const { service, updateOne } = setup(null);
    mockFetch(okResponse({ ...RATES, EUR: 'abc' }));
    await expect(service.getRates()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    mockFetch(okResponse({ USD: 1 }));
    await expect(service.getRates()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('shares one API call between concurrent requests', async () => {
    const { service } = setup(null);
    const spy = mockFetch(okResponse());
    await Promise.all([
      service.getRates(),
      service.getRates(),
      service.getRates(),
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('convertAmount', () => {
  it('converts through USD and returns the same amount for the same currency', () => {
    expect(convertAmount(90, 'EUR', 'USD', RATES)).toBeCloseTo(100);
    expect(convertAmount(100, 'USD', 'EGP', RATES)).toBe(5000);
    expect(convertAmount(80, 'GBP', 'EUR', RATES)).toBeCloseTo(90);
    expect(convertAmount(7, 'EGP', 'EGP', RATES)).toBe(7);
  });

  it('throws for a currency without a rate', () => {
    expect(() => convertAmount(1, 'XYZ', 'USD', RATES)).toThrow();
  });
});
