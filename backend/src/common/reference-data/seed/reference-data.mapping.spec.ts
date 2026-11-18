import { mapReferenceData } from './reference-data.mapping';

describe('mapReferenceData', () => {
  it('maps dataset columns to schema fields and keeps only those', () => {
    const docs = mapReferenceData({
      currencies: [{ code: 'EGP' }],
      countries: [{ code: 'EG', name: 'Egypt', currency: 'EGP' }],
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
    });

    expect(docs).toEqual({
      currencies: [{ _id: 'EGP' }],
      countries: [{ _id: 'EG', name: 'Egypt', currency: 'EGP' }],
      cities: [{ _id: 'cairo', name: 'Cairo', countryId: 'EG' }],
      airports: [
        {
          _id: 'CAI',
          name: 'Cairo International Airport',
          cityId: 'cairo',
          countryId: 'EG',
          timeZone: 'Africa/Cairo',
        },
      ],
      attractions: [{ _id: 'att-1', name: 'Pyramids', cityId: 'cairo' }],
    });
  });
});
