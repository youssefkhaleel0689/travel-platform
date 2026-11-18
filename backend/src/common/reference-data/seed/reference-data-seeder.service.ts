import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AnyObject, Model } from 'mongoose';
import { Airport } from '../schemas/airport.schema';
import { Attraction } from '../schemas/attraction.schema';
import { City } from '../schemas/city.schema';
import { Country } from '../schemas/country.schema';
import { Currency } from '../schemas/currency.schema';
import { ReferenceDataset, referenceDataset } from './reference-data.dataset';
import { mapReferenceData } from './reference-data.mapping';
import { assertValidReferenceData } from './reference-data.validation';

@Injectable()
export class ReferenceDataSeeder {
  private readonly logger = new Logger(ReferenceDataSeeder.name);

  constructor(
    @InjectModel(Currency.name) private readonly currencyModel: Model<Currency>,
    @InjectModel(Country.name) private readonly countryModel: Model<Country>,
    @InjectModel(City.name) private readonly cityModel: Model<City>,
    @InjectModel(Airport.name) private readonly airportModel: Model<Airport>,
    @InjectModel(Attraction.name)
    private readonly attractionModel: Model<Attraction>,
  ) {}

  // Safe to run more than once: it replaces by _id and never deletes.
  // Referenced collections are written first.
  async seed(dataset: ReferenceDataset = referenceDataset): Promise<void> {
    assertValidReferenceData(dataset);
    const docs = mapReferenceData(dataset);

    await this.upsert('currencies', this.currencyModel, docs.currencies);
    await this.upsert('countries', this.countryModel, docs.countries);
    await this.upsert('cities', this.cityModel, docs.cities);
    await this.upsert('airports', this.airportModel, docs.airports);
    await this.upsert('attractions', this.attractionModel, docs.attractions);
  }

  private async upsert<T extends { _id: string }>(
    collection: string,
    model: Model<T>,
    docs: T[],
  ): Promise<void> {
    // The replacement keeps _id because Mongoose validates it against the schema,
    // where _id is required; AnyObject is needed as the driver type omits _id.
    const result = await model.bulkWrite<AnyObject>(
      docs.map((doc) => ({
        replaceOne: {
          filter: { _id: doc._id },
          replacement: doc,
          upsert: true,
        },
      })),
    );
    this.logger.log(
      `${collection}: total=${docs.length} upserted=${result.upsertedCount} modified=${result.modifiedCount} matched=${result.matchedCount}`,
    );
  }
}
