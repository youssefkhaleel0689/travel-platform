import { HttpException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { ReferenceDataService } from './reference-data.service';
import { Airport } from './schemas/airport.schema';
import { City } from './schemas/city.schema';
import { Country } from './schemas/country.schema';
import { Currency } from './schemas/currency.schema';

type Doc = Record<string, unknown>;
type Filter = Record<string, unknown>;

type Calls = {
  find: Filter[];
  sort: Record<string, 1 | -1>[];
  count: Filter[];
  queries: number;
};

// True when a document passes an equality or $in filter.
function matches(doc: Doc, filter: Filter): boolean {
  return Object.entries(filter).every(([key, value]) => {
    const operator = value as { $in?: unknown[] } | null;
    return operator?.$in ? operator.$in.includes(doc[key]) : doc[key] === value;
  });
}

// Chainable stand-in for a Mongoose query; exec() resolves to the given result.
class FakeQuery<R> {
  constructor(
    private readonly calls: Calls,
    private readonly result: R,
  ) {}

  sort(sort: Record<string, 1 | -1>): this {
    this.calls.sort.push(sort);
    return this;
  }

  skip(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  select(): this {
    return this;
  }

  lean(): this {
    return this;
  }

  exec(): Promise<R> {
    return Promise.resolve(this.result);
  }
}

// Builds a fake model over fixed documents; the cast to Model is done only here.
function fakeModel<T>(docs: Doc[]) {
  const calls: Calls = { find: [], sort: [], count: [], queries: 0 };
  const firstMatch = (filter: Filter) =>
    docs.find((doc) => matches(doc, filter)) ?? null;
  const model = {
    find(filter: Filter) {
      calls.queries++;
      calls.find.push(filter);
      return new FakeQuery(
        calls,
        docs.filter((doc) => matches(doc, filter)),
      );
    },
    countDocuments(filter: Filter) {
      calls.queries++;
      calls.count.push(filter);
      return new FakeQuery(
        calls,
        docs.filter((doc) => matches(doc, filter)).length,
      );
    },
    findById(id: string) {
      calls.queries++;
      return new FakeQuery(calls, firstMatch({ _id: id }));
    },
    exists(filter: Filter) {
      calls.queries++;
      return new FakeQuery(calls, firstMatch(filter));
    },
  };
  return { model: model as unknown as Model<T>, calls };
}

function buildService() {
  const countries = fakeModel<Country>([
    { _id: 'EG', name: 'Egypt', currency: 'EGP', __v: 0 },
    { _id: 'FR', name: 'France', currency: 'EUR' },
  ]);
  const cities = fakeModel<City>([
    { _id: 'cairo', name: 'Cairo', countryId: 'EG', __v: 0 },
  ]);
  const airports = fakeModel<Airport>([
    {
      _id: 'CAI',
      name: 'Cairo International Airport',
      cityId: 'cairo',
      countryId: 'EG',
      timeZone: 'Africa/Cairo',
      __v: 0,
    },
  ]);
  const currencies = fakeModel<Currency>([{ _id: 'USD', __v: 0 }]);
  const service = new ReferenceDataService(
    countries.model,
    cities.model,
    airports.model,
    currencies.model,
  );
  return { service, countries, cities, airports, currencies };
}

// Returns the status and body of the HttpException a call rejects with.
async function httpError(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), body: error.getResponse() };
    }
    throw error;
  }
  throw new Error('Expected the call to reject');
}

const cairoAirport = {
  id: 'CAI',
  name: 'Cairo International Airport',
  cityId: 'cairo',
  countryId: 'EG',
  timeZone: 'Africa/Cairo',
};

describe('ReferenceDataService', () => {
  describe('mapping', () => {
    it('maps an airport _id to id and exposes only the DTO fields', async () => {
      const { service } = buildService();
      const result = await service.listAirports(1);
      expect(result.items).toEqual([cairoAirport]);
      expect(result.meta.totalItems).toBe(1);
    });

    it('maps a country', async () => {
      const { service } = buildService();
      const result = await service.listCountries(1);
      expect(result.items[0]).toEqual({
        id: 'EG',
        name: 'Egypt',
        currency: 'EGP',
      });
    });

    it('maps a city', async () => {
      const { service } = buildService();
      const result = await service.listCities(1);
      expect(result.items).toEqual([
        { id: 'cairo', name: 'Cairo', countryId: 'EG' },
      ]);
    });

    it('maps a currency', async () => {
      const { service } = buildService();
      const result = await service.listCurrencies(1);
      expect(result.items).toEqual([{ id: 'USD' }]);
    });
  });

  describe('sorting', () => {
    it('sorts airports, countries and cities by name, with the _id tie-breaker', async () => {
      const { service, airports, countries, cities } = buildService();
      await service.listAirports(1);
      await service.listCountries(1);
      await service.listCities(1);
      for (const { calls } of [airports, countries, cities]) {
        expect(calls.sort).toEqual([{ name: 1, _id: 1 }]);
      }
    });

    it('sorts currencies by _id', async () => {
      const { service, currencies } = buildService();
      await service.listCurrencies(1);
      expect(currencies.calls.sort).toEqual([{ _id: 1 }]);
    });
  });

  describe('filters', () => {
    it('sends no filter keys when none are given', async () => {
      const { service, airports, cities } = buildService();
      await service.listAirports(1, {});
      await service.listCities(1);
      expect(airports.calls.find).toEqual([{}]);
      expect(Object.keys(airports.calls.find[0])).toEqual([]);
      expect(cities.calls.find).toEqual([{}]);
    });

    it('passes the airport filters to find and countDocuments', async () => {
      const { service, airports } = buildService();
      const filter = { cityId: 'cairo', countryId: 'EG' };
      const result = await service.listAirports(1, filter);
      expect(airports.calls.find).toEqual([filter]);
      expect(airports.calls.count).toEqual([filter]);
      expect(result.items).toEqual([cairoAirport]);
    });

    it('passes the city filter to find and countDocuments', async () => {
      const { service, cities } = buildService();
      await service.listCities(1, { countryId: 'EG' });
      expect(cities.calls.find).toEqual([{ countryId: 'EG' }]);
      expect(cities.calls.count).toEqual([{ countryId: 'EG' }]);
    });

    it('returns an empty page for an unknown filter value', async () => {
      const { service } = buildService();
      const airports = await service.listAirports(1, { cityId: 'nowhere' });
      const cities = await service.listCities(1, { countryId: 'ZZ' });
      for (const result of [airports, cities]) {
        expect(result.items).toEqual([]);
        expect(result.meta.totalItems).toBe(0);
        expect(result.meta.totalPages).toBe(0);
      }
    });
  });

  describe('getAirportOrThrow', () => {
    it('returns the airport DTO', async () => {
      const { service } = buildService();
      await expect(service.getAirportOrThrow('CAI')).resolves.toEqual(
        cairoAirport,
      );
    });

    it('throws 400 UNKNOWN_AIRPORT for an unknown id', async () => {
      const { service } = buildService();
      await expect(
        httpError(service.getAirportOrThrow('XXX')),
      ).resolves.toEqual({
        status: 400,
        body: { code: 'UNKNOWN_AIRPORT', message: 'Unknown airport: XXX' },
      });
    });

    it('throws the same code for a malformed id, without a query or the value', async () => {
      const { service, airports } = buildService();
      await expect(
        httpError(service.getAirportOrThrow('cai')),
      ).resolves.toEqual({
        status: 400,
        body: { code: 'UNKNOWN_AIRPORT', message: 'Unknown airport' },
      });
      expect(airports.calls.queries).toBe(0);
    });

    it('treats a value that is not a string as malformed', async () => {
      const { service, airports } = buildService();
      for (const value of [{ $ne: null }, ['CAI']]) {
        const { body } = await httpError(
          service.getAirportOrThrow(value as unknown as string),
        );
        expect(body).toEqual({
          code: 'UNKNOWN_AIRPORT',
          message: 'Unknown airport',
        });
      }
      expect(airports.calls.queries).toBe(0);
    });
  });

  describe('assertCityExists', () => {
    it('passes for a known city', async () => {
      const { service } = buildService();
      await expect(service.assertCityExists('cairo')).resolves.toBeUndefined();
    });

    it('throws 400 UNKNOWN_CITY for an unknown city', async () => {
      const { service } = buildService();
      await expect(
        httpError(service.assertCityExists('nowhere')),
      ).resolves.toEqual({
        status: 400,
        body: { code: 'UNKNOWN_CITY', message: 'Unknown city: nowhere' },
      });
    });

    it('throws the same code for a malformed id, without a query or the value', async () => {
      const { service, cities } = buildService();
      await expect(
        httpError(service.assertCityExists('New York')),
      ).resolves.toEqual({
        status: 400,
        body: { code: 'UNKNOWN_CITY', message: 'Unknown city' },
      });
      expect(cities.calls.queries).toBe(0);
    });
  });

  describe('listAirportIdsInCity', () => {
    it("lists the city's airports, sorted by code", async () => {
      const { service, airports } = buildService();

      await expect(service.listAirportIdsInCity('cairo')).resolves.toEqual([
        'CAI',
      ]);
      expect(airports.calls.find).toEqual([{ cityId: 'cairo' }]);
      expect(airports.calls.sort).toEqual([{ _id: 1 }]);
    });

    it('gives an empty list for a city without airports', async () => {
      const { service } = buildService();

      await expect(service.listAirportIdsInCity('nowhere')).resolves.toEqual(
        [],
      );
    });

    it('gives an empty list for a malformed id, without a query', async () => {
      const { service, airports } = buildService();

      await expect(service.listAirportIdsInCity('New York')).resolves.toEqual(
        [],
      );
      expect(airports.calls.queries).toBe(0);
    });
  });

  describe('assertCountriesExist', () => {
    it('passes when every country exists, using one query', async () => {
      const { service, countries } = buildService();
      await expect(
        service.assertCountriesExist(['EG', 'FR']),
      ).resolves.toBeUndefined();
      expect(countries.calls.find).toEqual([{ _id: { $in: ['EG', 'FR'] } }]);
    });

    it('reports every missing id together, each one once', async () => {
      const { service, countries } = buildService();
      await expect(
        httpError(service.assertCountriesExist(['EG', 'ZZ', 'XX', 'ZZ'])),
      ).resolves.toEqual({
        status: 400,
        body: {
          code: 'UNKNOWN_COUNTRY',
          message: 'Unknown countries: ZZ, XX',
        },
      });
      expect(countries.calls.find).toHaveLength(1);
    });

    it('lists unknown ids and counts malformed ones, querying only well-formed ids', async () => {
      const { service, countries } = buildService();
      await expect(
        httpError(service.assertCountriesExist(['EG', 'ZZ', 'eg'])),
      ).resolves.toEqual({
        status: 400,
        body: {
          code: 'UNKNOWN_COUNTRY',
          message: 'Unknown countries: ZZ and 1 invalid value',
        },
      });
      expect(countries.calls.find).toEqual([{ _id: { $in: ['EG', 'ZZ'] } }]);
    });

    it('reports malformed ids even when every well-formed id exists', async () => {
      const { service } = buildService();
      const { body } = await httpError(
        service.assertCountriesExist(['EG', 'eg']),
      );
      expect(body).toEqual({
        code: 'UNKNOWN_COUNTRY',
        message: 'Unknown countries: 1 invalid value',
      });
    });

    it('runs no query when every id is malformed', async () => {
      const { service, countries } = buildService();
      await expect(
        httpError(service.assertCountriesExist(['eg', '<b>', 'eg'])),
      ).resolves.toEqual({
        status: 400,
        body: {
          code: 'UNKNOWN_COUNTRY',
          message: 'Unknown countries: 2 invalid values',
        },
      });
      expect(countries.calls.queries).toBe(0);
    });

    it('runs no query for an empty list', async () => {
      const { service, countries } = buildService();
      await expect(service.assertCountriesExist([])).resolves.toBeUndefined();
      expect(countries.calls.find).toEqual([]);
    });
  });

  describe('assertSupportedCurrency', () => {
    it('passes for a seeded currency', async () => {
      const { service } = buildService();
      await expect(
        service.assertSupportedCurrency('USD'),
      ).resolves.toBeUndefined();
    });

    it('throws 400 UNSUPPORTED_CURRENCY for any other code', async () => {
      const { service } = buildService();
      await expect(
        httpError(service.assertSupportedCurrency('CHF')),
      ).resolves.toEqual({
        status: 400,
        body: {
          code: 'UNSUPPORTED_CURRENCY',
          message: 'Unsupported currency: CHF',
        },
      });
    });

    it('throws the same code for a malformed code, without a query or the value', async () => {
      const { service, currencies } = buildService();
      await expect(
        httpError(service.assertSupportedCurrency('usd')),
      ).resolves.toEqual({
        status: 400,
        body: { code: 'UNSUPPORTED_CURRENCY', message: 'Unsupported currency' },
      });
      expect(currencies.calls.queries).toBe(0);
    });
  });
});
