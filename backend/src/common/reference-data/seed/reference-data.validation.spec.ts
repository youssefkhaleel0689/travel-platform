import { ReferenceDataset, referenceDataset } from './reference-data.dataset';
import {
  assertValidReferenceData,
  ReferenceDataValidationError,
  validateReferenceData,
} from './reference-data.validation';

// A small valid dataset; each test breaks one thing in its own copy.
function validData(): ReferenceDataset {
  return {
    currencies: [{ code: 'EGP' }, { code: 'EUR' }],
    countries: [
      { code: 'EG', name: 'Egypt', currency: 'EGP' },
      { code: 'FR', name: 'France', currency: 'EUR' },
    ],
    cities: [{ city_id: 'cairo', name: 'Cairo', country_code: 'EG' }],
    airports: [
      {
        iata_code: 'CAI',
        name: 'Cairo International Airport',
        city_id: 'cairo',
        country_code: 'EG',
        time_zone: 'Africa/Cairo',
      },
    ],
    attractions: [
      { attraction_id: 'att-1', name: 'Pyramids', city_id: 'cairo' },
    ],
  };
}

describe('validateReferenceData', () => {
  it('passes on the real data', () => {
    expect(validateReferenceData(referenceDataset)).toEqual([]);
    expect(() => assertValidReferenceData(referenceDataset)).not.toThrow();
  });

  it('passes on the valid test data', () => {
    expect(validateReferenceData(validData())).toEqual([]);
  });

  it('reports a duplicate id', () => {
    const data = validData();
    data.airports.push({ ...data.airports[0] });
    expect(validateReferenceData(data)).toEqual([
      { file: 'airports.json', id: 'CAI', reason: 'duplicate id' },
    ]);
  });

  it('reports a missing city for an airport and an attraction', () => {
    const data = validData();
    data.airports[0].city_id = 'giza';
    data.attractions[0].city_id = 'luxor';
    expect(validateReferenceData(data)).toEqual([
      {
        file: 'airports.json',
        id: 'CAI',
        reason: 'city_id "giza" does not exist in cities.json',
      },
      {
        file: 'attractions.json',
        id: 'att-1',
        reason: 'city_id "luxor" does not exist in cities.json',
      },
    ]);
  });

  it('reports a missing country for a city', () => {
    const data = validData();
    data.cities.push({ city_id: 'berlin', name: 'Berlin', country_code: 'DE' });
    expect(validateReferenceData(data)).toEqual([
      {
        file: 'cities.json',
        id: 'berlin',
        reason: 'country_code "DE" does not exist in countries.json',
      },
    ]);
  });

  it('reports an airport country that does not exist and differs from its city', () => {
    const data = validData();
    data.airports[0].country_code = 'DE';
    expect(validateReferenceData(data)).toEqual([
      {
        file: 'airports.json',
        id: 'CAI',
        reason: 'country_code "DE" does not exist in countries.json',
      },
      {
        file: 'airports.json',
        id: 'CAI',
        reason:
          'country_code "DE" differs from "EG", the country of city "cairo"',
      },
    ]);
  });

  it("reports an airport whose country differs from its city's country", () => {
    const data = validData();
    data.airports[0].country_code = 'FR';
    expect(validateReferenceData(data)).toEqual([
      {
        file: 'airports.json',
        id: 'CAI',
        reason:
          'country_code "FR" differs from "EG", the country of city "cairo"',
      },
    ]);
  });

  it('reports an invalid time zone', () => {
    const data = validData();
    data.airports[0].time_zone = 'Mars/Olympus';
    expect(validateReferenceData(data)).toEqual([
      {
        file: 'airports.json',
        id: 'CAI',
        reason:
          'time_zone "Mars/Olympus" is not accepted by Intl.DateTimeFormat',
      },
    ]);
  });

  it('reports a missing currency', () => {
    const data = validData();
    data.countries[0].currency = 'USD';
    expect(validateReferenceData(data)).toEqual([
      {
        file: 'countries.json',
        id: 'EG',
        reason: 'currency "USD" does not exist in currencies.json',
      },
    ]);
  });

  it('reports an id that does not match its pattern', () => {
    const data = validData();
    data.currencies.push({ code: 'usd' });
    expect(validateReferenceData(data)).toEqual([
      {
        file: 'currencies.json',
        id: 'usd',
        reason: 'code "usd" does not match /^[A-Z]{3}$/',
      },
    ]);
  });

  it('throws one error that lists every problem', () => {
    const data = validData();
    data.airports.push({ ...data.airports[0] });
    data.attractions[0].city_id = 'luxor';
    data.cities.push({ city_id: 'berlin', name: 'Berlin', country_code: 'DE' });
    data.airports[0].country_code = 'FR';
    data.airports[0].time_zone = 'Mars/Olympus';
    data.countries[0].currency = 'USD';

    let thrown: unknown;
    try {
      assertValidReferenceData(data);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ReferenceDataValidationError);
    const { issues, message } = thrown as ReferenceDataValidationError;
    expect(issues.map((i) => `${i.file} ${i.id}`)).toEqual([
      'countries.json EG',
      'cities.json berlin',
      'airports.json CAI',
      'airports.json CAI',
      'airports.json CAI',
      'attractions.json att-1',
    ]);
    expect(message).toContain('invalid (6 errors)');
    expect(message).toContain('duplicate id');
    expect(message).toContain('currency "USD"');
    expect(message).toContain('country_code "DE"');
    expect(message).toContain('country_code "FR"');
    expect(message).toContain('time_zone "Mars/Olympus"');
    expect(message).toContain('city_id "luxor"');
  });
});
