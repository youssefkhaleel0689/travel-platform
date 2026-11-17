import airports from '../data/airports.json';
import attractions from '../data/attractions.json';
import cities from '../data/cities.json';
import countries from '../data/countries.json';
import currencies from '../data/currencies.json';

// Row shapes of the JSON files; they keep the column names of the dataset.
export type CurrencyRow = { code: string };
export type CountryRow = { code: string; name: string; currency: string };
export type CityRow = { city_id: string; name: string; country_code: string };
export type AirportRow = {
  iata_code: string;
  name: string;
  city_id: string;
  country_code: string;
  time_zone: string;
};
export type AttractionRow = {
  attraction_id: string;
  name: string;
  city_id: string;
};

export type ReferenceDataset = {
  currencies: CurrencyRow[];
  countries: CountryRow[];
  cities: CityRow[];
  airports: AirportRow[];
  attractions: AttractionRow[];
};

// Imported, not read from disk, so tsc copies the files into dist/ on build.
export const referenceDataset: ReferenceDataset = {
  currencies,
  countries,
  cities,
  airports,
  attractions,
};
