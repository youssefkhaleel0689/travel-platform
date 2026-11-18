// TEMPORARY copy of docs/requirements/Mock_Data.xlsx (Countries and Cities).
// When the team's seed script (GEN-12) is merged, replace the contents of this
// one file with lookups from the database. Everything else only imports from here.

export const COUNTRIES = [
  { code: 'EG', name: 'Egypt', currency: 'EGP' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
  { code: 'US', name: 'United States', currency: 'USD' },
  { code: 'FR', name: 'France', currency: 'EUR' },
  { code: 'DE', name: 'Germany', currency: 'EUR' },
  { code: 'JP', name: 'Japan', currency: 'JPY' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR' },
] as const;

export const CITIES = [
  { id: 'cairo', name: 'Cairo', countryCode: 'EG' },
  { id: 'dubai', name: 'Dubai', countryCode: 'AE' },
  { id: 'london', name: 'London', countryCode: 'GB' },
  { id: 'new_york', name: 'New York', countryCode: 'US' },
  { id: 'paris', name: 'Paris', countryCode: 'FR' },
  { id: 'tokyo', name: 'Tokyo', countryCode: 'JP' },
  { id: 'riyadh', name: 'Riyadh', countryCode: 'SA' },
] as const;

export const COUNTRY_CODES: string[] = COUNTRIES.map((c) => c.code);
export const CITY_IDS: string[] = CITIES.map((c) => c.id);

// Supported currencies = the currencies of the seeded countries (ITN-18).
export const SUPPORTED_CURRENCIES: string[] = [
  ...new Set(COUNTRIES.map((c) => c.currency)),
];
