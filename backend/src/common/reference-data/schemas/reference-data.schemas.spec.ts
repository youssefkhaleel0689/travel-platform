import { Error as MongooseError, model, Schema } from 'mongoose';
import { Airport, AirportSchema } from './airport.schema';
import { Attraction, AttractionSchema } from './attraction.schema';
import { City, CitySchema } from './city.schema';
import { Country, CountrySchema } from './country.schema';
import { Currency, CurrencySchema } from './currency.schema';

// Returns the invalid paths. validate() needs no database connection.
async function errorPaths<T>(
  name: string,
  schema: Schema<T>,
  doc: Record<string, unknown>,
): Promise<string[]> {
  const TestModel = model<T>(name, schema);
  try {
    await new TestModel(doc).validate();
    return [];
  } catch (error) {
    if (error instanceof MongooseError.ValidationError) {
      return Object.keys(error.errors);
    }
    throw error;
  }
}

const validCountry = { _id: 'EG', name: 'Egypt', currency: 'EGP' };
const validCity = { _id: 'new_york', name: 'New York', countryId: 'US' };
const validAirport = {
  _id: 'CAI',
  name: 'Cairo International Airport',
  cityId: 'cairo',
  countryId: 'EG',
  timeZone: 'Africa/Cairo',
};
const validAttraction = { _id: 'att-1', name: 'Pyramids', cityId: 'cairo' };

describe('reference data schemas', () => {
  describe('valid documents', () => {
    it('accepts a valid country', async () => {
      await expect(
        errorPaths(Country.name, CountrySchema, validCountry),
      ).resolves.toEqual([]);
    });

    it('accepts a valid city', async () => {
      await expect(
        errorPaths(City.name, CitySchema, validCity),
      ).resolves.toEqual([]);
    });

    it('accepts a valid airport', async () => {
      await expect(
        errorPaths(Airport.name, AirportSchema, validAirport),
      ).resolves.toEqual([]);
    });

    it('accepts a valid attraction', async () => {
      await expect(
        errorPaths(Attraction.name, AttractionSchema, validAttraction),
      ).resolves.toEqual([]);
    });

    it('accepts a valid currency', async () => {
      const doc = { _id: 'USD' };
      await expect(
        errorPaths(Currency.name, CurrencySchema, doc),
      ).resolves.toEqual([]);
    });
  });

  describe('bad _id format', () => {
    it('rejects a country code that is too long', async () => {
      const doc = { ...validCountry, _id: 'EGY' };
      await expect(
        errorPaths(Country.name, CountrySchema, doc),
      ).resolves.toEqual(['_id']);
    });

    it('rejects a city id with uppercase letters or spaces', async () => {
      const doc = { ...validCity, _id: 'New York' };
      await expect(errorPaths(City.name, CitySchema, doc)).resolves.toEqual([
        '_id',
      ]);
    });

    it('rejects an airport code that is not 3 letters', async () => {
      const doc = { ...validAirport, _id: 'CAIR' };
      await expect(
        errorPaths(Airport.name, AirportSchema, doc),
      ).resolves.toEqual(['_id']);
    });

    it('rejects an attraction id with invalid characters', async () => {
      const doc = { ...validAttraction, _id: 'att 1' };
      await expect(
        errorPaths(Attraction.name, AttractionSchema, doc),
      ).resolves.toEqual(['_id']);
    });

    it('rejects a lowercase currency code', async () => {
      const doc = { _id: 'usd' };
      await expect(
        errorPaths(Currency.name, CurrencySchema, doc),
      ).resolves.toEqual(['_id']);
    });

    it('rejects an _id with surrounding spaces, because _id is not trimmed', async () => {
      const doc = { ...validCountry, _id: ' EG ' };
      await expect(
        errorPaths(Country.name, CountrySchema, doc),
      ).resolves.toEqual(['_id']);
    });
  });

  describe('missing required fields', () => {
    it('rejects a document without _id', async () => {
      await expect(
        errorPaths(Currency.name, CurrencySchema, {}),
      ).resolves.toEqual(['_id']);
    });

    it('rejects a country without a name', async () => {
      const doc = { _id: 'EG', currency: 'EGP' };
      await expect(
        errorPaths(Country.name, CountrySchema, doc),
      ).resolves.toEqual(['name']);
    });

    it('rejects a name with only spaces, because trim empties it', async () => {
      const doc = { ...validCity, name: '   ' };
      await expect(errorPaths(City.name, CitySchema, doc)).resolves.toEqual([
        'name',
      ]);
    });

    it('rejects an airport without a time zone', async () => {
      const doc = {
        _id: 'CAI',
        name: 'Cairo International Airport',
        cityId: 'cairo',
        countryId: 'EG',
      };
      await expect(
        errorPaths(Airport.name, AirportSchema, doc),
      ).resolves.toEqual(['timeZone']);
    });

    it('rejects an attraction without a city', async () => {
      const doc = { _id: 'att-1', name: 'Pyramids' };
      await expect(
        errorPaths(Attraction.name, AttractionSchema, doc),
      ).resolves.toEqual(['cityId']);
    });
  });

  describe('lowercase country code', () => {
    it('rejects it as a country _id', async () => {
      const doc = { ...validCountry, _id: 'eg' };
      await expect(
        errorPaths(Country.name, CountrySchema, doc),
      ).resolves.toEqual(['_id']);
    });

    it('rejects it as a city countryId', async () => {
      const doc = { ...validCity, countryId: 'us' };
      await expect(errorPaths(City.name, CitySchema, doc)).resolves.toEqual([
        'countryId',
      ]);
    });

    it('rejects it as an airport countryId', async () => {
      const doc = { ...validAirport, countryId: 'eg' };
      await expect(
        errorPaths(Airport.name, AirportSchema, doc),
      ).resolves.toEqual(['countryId']);
    });
  });

  describe('bad reference format', () => {
    it('rejects an invalid attraction cityId', async () => {
      const doc = { ...validAttraction, cityId: 'New York' };
      await expect(
        errorPaths(Attraction.name, AttractionSchema, doc),
      ).resolves.toEqual(['cityId']);
    });

    it('rejects an invalid airport cityId', async () => {
      const doc = { ...validAirport, cityId: 'New York' };
      await expect(
        errorPaths(Airport.name, AirportSchema, doc),
      ).resolves.toEqual(['cityId']);
    });

    it('rejects a lowercase country currency', async () => {
      const doc = { ...validCountry, currency: 'egp' };
      await expect(
        errorPaths(Country.name, CountrySchema, doc),
      ).resolves.toEqual(['currency']);
    });
  });
});
