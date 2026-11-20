import type { Airport } from '../schemas/airport.schema';
import type { Attraction } from '../schemas/attraction.schema';
import type { City } from '../schemas/city.schema';
import type { Country } from '../schemas/country.schema';
import type { Currency } from '../schemas/currency.schema';
import type { ReferenceDataset } from './reference-data.dataset';

export type ReferenceDocuments = {
  currencies: Currency[];
  countries: Country[];
  cities: City[];
  airports: Airport[];
  attractions: Attraction[];
};

// Dataset column names -> schema field names.
export function mapReferenceData(data: ReferenceDataset): ReferenceDocuments {
  return {
    currencies: data.currencies.map((row) => ({ _id: row.code })),
    countries: data.countries.map((row) => ({
      _id: row.code,
      name: row.name,
      currency: row.currency,
    })),
    cities: data.cities.map((row) => ({
      _id: row.city_id,
      name: row.name,
      countryId: row.country_code,
    })),
    airports: data.airports.map((row) => ({
      _id: row.iata_code,
      name: row.name,
      cityId: row.city_id,
      countryId: row.country_code,
      timeZone: row.time_zone,
    })),
    attractions: data.attractions.map((row) => ({
      _id: row.attraction_id,
      name: row.name,
      cityId: row.city_id,
    })),
  };
}
