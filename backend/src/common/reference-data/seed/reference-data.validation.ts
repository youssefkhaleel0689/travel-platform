import {
  COUNTRY_CODE,
  CURRENCY_CODE,
  IATA_CODE,
  SLUG_ID,
} from '../reference-data.patterns';
import type { ReferenceDataset } from './reference-data.dataset';

export type ValidationIssue = { file: string; id: string; reason: string };

// Lists every problem at once, so the data can be fixed in one go.
export class ReferenceDataValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    const lines = issues.map((i) => `- ${i.file} [${i.id}]: ${i.reason}`);
    super(
      `Reference data is invalid (${issues.length} errors):\n${lines.join('\n')}`,
    );
    this.name = 'ReferenceDataValidationError';
  }
}

// Intl throws a RangeError for a zone it does not know.
function isValidTimeZone(timeZone: unknown): boolean {
  if (typeof timeZone !== 'string') {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function validateReferenceData(
  data: ReferenceDataset,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const checkDuplicates = (file: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) {
        issues.push({ file, id, reason: 'duplicate id' });
      }
      seen.add(id);
    }
  };

  // The typeof check matters: RegExp.test(undefined) tests the text "undefined".
  const checkPattern = (
    file: string,
    id: string,
    field: string,
    value: unknown,
    pattern: RegExp,
  ) => {
    if (typeof value !== 'string' || !pattern.test(value)) {
      const reason = `${field} "${String(value)}" does not match ${String(pattern)}`;
      issues.push({ file, id, reason });
    }
  };

  const currencyCodes = new Set(data.currencies.map((c) => c.code));
  const countryCodes = new Set(data.countries.map((c) => c.code));
  const cityCountries = new Map(
    data.cities.map((c) => [c.city_id, c.country_code]),
  );

  checkDuplicates(
    'currencies.json',
    data.currencies.map((c) => c.code),
  );
  for (const { code } of data.currencies) {
    checkPattern('currencies.json', code, 'code', code, CURRENCY_CODE);
  }

  const countriesFile = 'countries.json';
  checkDuplicates(
    countriesFile,
    data.countries.map((c) => c.code),
  );
  for (const { code, currency } of data.countries) {
    checkPattern(countriesFile, code, 'code', code, COUNTRY_CODE);
    checkPattern(countriesFile, code, 'currency', currency, CURRENCY_CODE);
    if (!currencyCodes.has(currency)) {
      const reason = `currency "${currency}" does not exist in currencies.json`;
      issues.push({ file: countriesFile, id: code, reason });
    }
  }

  const citiesFile = 'cities.json';
  checkDuplicates(
    citiesFile,
    data.cities.map((c) => c.city_id),
  );
  for (const { city_id: id, country_code: countryCode } of data.cities) {
    checkPattern(citiesFile, id, 'city_id', id, SLUG_ID);
    checkPattern(citiesFile, id, 'country_code', countryCode, COUNTRY_CODE);
    if (!countryCodes.has(countryCode)) {
      const reason = `country_code "${countryCode}" does not exist in countries.json`;
      issues.push({ file: citiesFile, id, reason });
    }
  }

  const airportsFile = 'airports.json';
  checkDuplicates(
    airportsFile,
    data.airports.map((a) => a.iata_code),
  );
  for (const airport of data.airports) {
    const { iata_code: id, city_id: cityId } = airport;
    const { country_code: countryCode, time_zone: timeZone } = airport;
    checkPattern(airportsFile, id, 'iata_code', id, IATA_CODE);
    checkPattern(airportsFile, id, 'city_id', cityId, SLUG_ID);
    checkPattern(airportsFile, id, 'country_code', countryCode, COUNTRY_CODE);
    if (!countryCodes.has(countryCode)) {
      const reason = `country_code "${countryCode}" does not exist in countries.json`;
      issues.push({ file: airportsFile, id, reason });
    }
    const cityCountry = cityCountries.get(cityId);
    if (cityCountry === undefined) {
      const reason = `city_id "${cityId}" does not exist in cities.json`;
      issues.push({ file: airportsFile, id, reason });
    } else if (cityCountry !== countryCode) {
      const reason = `country_code "${countryCode}" differs from "${cityCountry}", the country of city "${cityId}"`;
      issues.push({ file: airportsFile, id, reason });
    }
    if (!isValidTimeZone(timeZone)) {
      const reason = `time_zone "${String(timeZone)}" is not accepted by Intl.DateTimeFormat`;
      issues.push({ file: airportsFile, id, reason });
    }
  }

  const attractionsFile = 'attractions.json';
  checkDuplicates(
    attractionsFile,
    data.attractions.map((a) => a.attraction_id),
  );
  for (const { attraction_id: id, city_id: cityId } of data.attractions) {
    checkPattern(attractionsFile, id, 'attraction_id', id, SLUG_ID);
    checkPattern(attractionsFile, id, 'city_id', cityId, SLUG_ID);
    if (!cityCountries.has(cityId)) {
      const reason = `city_id "${cityId}" does not exist in cities.json`;
      issues.push({ file: attractionsFile, id, reason });
    }
  }

  return issues;
}

export function assertValidReferenceData(data: ReferenceDataset): void {
  const issues = validateReferenceData(data);
  if (issues.length > 0) {
    throw new ReferenceDataValidationError(issues);
  }
}
