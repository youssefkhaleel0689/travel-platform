import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter } from 'mongoose';
import { PageDto } from '../pagination/dto/page.dto';
import { paginateQuery } from '../pagination/paginate';
import { AirportDto } from './dto/airport.dto';
import { CityDto } from './dto/city.dto';
import { CountryDto } from './dto/country.dto';
import { CurrencyDto } from './dto/currency.dto';
import {
  COUNTRY_CODE,
  CURRENCY_CODE,
  IATA_CODE,
  SLUG_ID,
} from './reference-data.patterns';
import { Airport } from './schemas/airport.schema';
import { City } from './schemas/city.schema';
import { Country } from './schemas/country.schema';
import { Currency } from './schemas/currency.schema';

// Fields are listed one by one so that _id and any new field are never exposed by accident.
function toAirportDto(doc: Airport): AirportDto {
  return {
    id: doc._id,
    name: doc.name,
    cityId: doc.cityId,
    countryId: doc.countryId,
    timeZone: doc.timeZone,
  };
}

function toCountryDto(doc: Country): CountryDto {
  return { id: doc._id, name: doc.name, currency: doc.currency };
}

function toCityDto(doc: City): CityDto {
  return { id: doc._id, name: doc.name, countryId: doc.countryId };
}

function toCurrencyDto(doc: Currency): CurrencyDto {
  return { id: doc._id };
}

function unknownReference(code: string, message: string): BadRequestException {
  return new BadRequestException({ code, message });
}

// The typeof check matters: a RegExp would turn the array ['CAI'] into the text "CAI".
function isWellFormed(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value);
}

// Read-only access to the seeded reference data for the other modules.
@Injectable()
export class ReferenceDataService {
  constructor(
    @InjectModel(Country.name) private readonly countryModel: Model<Country>,
    @InjectModel(City.name) private readonly cityModel: Model<City>,
    @InjectModel(Airport.name) private readonly airportModel: Model<Airport>,
    @InjectModel(Currency.name) private readonly currencyModel: Model<Currency>,
  ) {}

  /** For the airport list endpoint. An unknown filter value gives an empty page. */
  async listAirports(
    page: number,
    filters: { cityId?: string; countryId?: string } = {},
  ): Promise<PageDto<AirportDto>> {
    const { cityId, countryId } = filters;
    // Only set filters are sent: an undefined value must not reach the query.
    const filter: QueryFilter<Airport> = {
      ...(cityId !== undefined && { cityId }),
      ...(countryId !== undefined && { countryId }),
    };
    const result = await paginateQuery(this.airportModel, filter, {
      page,
      sort: { name: 1 },
    });
    return new PageDto(result.items.map(toAirportDto), result.meta);
  }

  /** For the country list endpoint. */
  async listCountries(page: number): Promise<PageDto<CountryDto>> {
    const result = await paginateQuery(
      this.countryModel,
      {},
      { page, sort: { name: 1 } },
    );
    return new PageDto(result.items.map(toCountryDto), result.meta);
  }

  /** For the city list endpoint. An unknown filter value gives an empty page. */
  async listCities(
    page: number,
    filters: { countryId?: string } = {},
  ): Promise<PageDto<CityDto>> {
    const { countryId } = filters;
    const filter: QueryFilter<City> = {
      ...(countryId !== undefined && { countryId }),
    };
    const result = await paginateQuery(this.cityModel, filter, {
      page,
      sort: { name: 1 },
    });
    return new PageDto(result.items.map(toCityDto), result.meta);
  }

  /** For the currency list endpoint. */
  async listCurrencies(page: number): Promise<PageDto<CurrencyDto>> {
    const result = await paginateQuery(
      this.currencyModel,
      {},
      { page, sort: { _id: 1 } },
    );
    return new PageDto(result.items.map(toCurrencyDto), result.meta);
  }

  /** For modules that receive an airport id in a request and need its data. */
  async getAirportOrThrow(id: string): Promise<AirportDto> {
    if (!isWellFormed(id, IATA_CODE)) {
      throw unknownReference('UNKNOWN_AIRPORT', 'Unknown airport');
    }
    const airport = await this.airportModel.findById(id).lean<Airport>().exec();
    if (!airport) {
      throw unknownReference('UNKNOWN_AIRPORT', `Unknown airport: ${id}`);
    }
    return toAirportDto(airport);
  }

  /** For modules that receive a city id in a request and store a reference to it. */
  async assertCityExists(id: string): Promise<void> {
    if (!isWellFormed(id, SLUG_ID)) {
      throw unknownReference('UNKNOWN_CITY', 'Unknown city');
    }
    const city = await this.cityModel.exists({ _id: id }).exec();
    if (!city) {
      throw unknownReference('UNKNOWN_CITY', `Unknown city: ${id}`);
    }
  }

  /**
   * For modules that receive a list of country ids in a request. Runs one query.
   * The error lists every missing id once and only counts the malformed ones.
   */
  async assertCountriesExist(ids: string[]): Promise<void> {
    const uniqueIds = [...new Set(ids)];
    const wellFormedIds = uniqueIds.filter((id) =>
      isWellFormed(id, COUNTRY_CODE),
    );
    const invalidCount = uniqueIds.length - wellFormedIds.length;

    let missing: string[] = [];
    if (wellFormedIds.length > 0) {
      const found = await this.countryModel
        .find({ _id: { $in: wellFormedIds } })
        .select('_id')
        .lean<Pick<Country, '_id'>[]>()
        .exec();
      const foundIds = new Set(found.map((country) => country._id));
      missing = wellFormedIds.filter((id) => !foundIds.has(id));
    }

    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(missing.join(', '));
    }
    if (invalidCount > 0) {
      parts.push(`${invalidCount} invalid value${invalidCount > 1 ? 's' : ''}`);
    }
    if (parts.length > 0) {
      throw unknownReference(
        'UNKNOWN_COUNTRY',
        `Unknown countries: ${parts.join(' and ')}`,
      );
    }
  }

  /**
   * The ids of every seeded airport in a city, sorted (ITN-26: flights to "any airport
   * in the city"). A malformed or unknown city id gives an empty list, without a query
   * for the malformed one.
   */
  async listAirportIdsInCity(cityId: string): Promise<string[]> {
    if (!isWellFormed(cityId, SLUG_ID)) {
      return [];
    }
    const rows = await this.airportModel
      .find({ cityId })
      .select('_id')
      .sort({ _id: 1 })
      .lean<Pick<Airport, '_id'>[]>()
      .exec();
    return rows.map((row) => row._id);
  }

  /**
   * Every seeded currency code, sorted (ITN-18): the currencies the exchange rates are
   * fetched for. Small fixed list, so it is read whole.
   */
  async listCurrencyCodes(): Promise<string[]> {
    const rows = await this.currencyModel
      .find({})
      .select('_id')
      .sort({ _id: 1 })
      .lean<Pick<Currency, '_id'>[]>()
      .exec();
    return rows.map((row) => row._id);
  }

  /**
   * Country and city ids whose id equals the keyword or whose name contains it,
   * case-insensitively and literally (ITN-21 free-text search of public itineraries).
   */
  async findPlaceIdsByKeyword(
    keyword: string,
  ): Promise<{ countryIds: string[]; cityIds: string[] }> {
    const text = keyword.trim();
    if (text.length === 0) {
      return { countryIds: [], cityIds: [] };
    }
    const contains = new RegExp(
      text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'i',
    );
    const [countries, cities] = await Promise.all([
      this.countryModel
        .find({ $or: [{ _id: text.toUpperCase() }, { name: contains }] })
        .select('_id')
        .lean<Pick<Country, '_id'>[]>()
        .exec(),
      this.cityModel
        .find({ $or: [{ _id: text.toLowerCase() }, { name: contains }] })
        .select('_id')
        .lean<Pick<City, '_id'>[]>()
        .exec(),
    ]);
    return {
      countryIds: countries.map((row) => row._id),
      cityIds: cities.map((row) => row._id),
    };
  }

  /**
   * For itinerary budgets and preferred currency (ACC-09, ITN-14, ITN-16, ITN-18).
   * Booking prices, payments and refunds are always USD (PAY-04) and must not use this check.
   */
  async assertSupportedCurrency(code: string): Promise<void> {
    if (!isWellFormed(code, CURRENCY_CODE)) {
      throw unknownReference('UNSUPPORTED_CURRENCY', 'Unsupported currency');
    }
    const currency = await this.currencyModel.exists({ _id: code }).exec();
    if (!currency) {
      throw unknownReference(
        'UNSUPPORTED_CURRENCY',
        `Unsupported currency: ${code}`,
      );
    }
  }
}
