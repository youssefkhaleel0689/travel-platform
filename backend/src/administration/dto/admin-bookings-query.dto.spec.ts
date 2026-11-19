import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  BookingStatus,
  BookingType,
} from '../../common/bookings/booking-status';
import { AdminBookingsQueryDto } from './admin-bookings-query.dto';

// The same options the global pipe uses, so an unknown parameter is an error
// here exactly as it is over HTTP.
const options = { whitelist: true, forbidNonWhitelisted: true };

async function errorFields(plain: object): Promise<string[]> {
  const errors = await validate(
    plainToInstance(AdminBookingsQueryDto, plain),
    options,
  );
  return errors.map((error) => error.property).sort();
}

describe('AdminBookingsQueryDto (ACC-17)', () => {
  it('defaults to the first page with no filter', async () => {
    const dto = plainToInstance(AdminBookingsQueryDto, {});

    expect(dto.page).toBe(1);
    expect(dto.type).toBeUndefined();
    expect(await validate(dto, options)).toEqual([]);
  });

  it('accepts every filter together', async () => {
    expect(
      await errorFields({
        page: '2',
        type: BookingType.HOTEL,
        status: BookingStatus.CONFIRMED,
        from: '2026-11-01',
        to: '2026-11-30',
        reference: 'K7M2QX',
      }),
    ).toEqual([]);
  });

  it.each(Object.values(BookingStatus))('accepts the status %s', async (status) => {
    expect(await errorFields({ status })).toEqual([]);
  });

  it.each(['CAR', 'flight', ''])('rejects the type %j', async (type) => {
    expect(await errorFields({ type })).toEqual(['type']);
  });

  it.each(['DRAFT', 'confirmed', ''])('rejects the status %j', async (status) => {
    expect(await errorFields({ status })).toEqual(['status']);
  });

  // A day that does not exist is refused, not silently rolled over into the
  // next month, which is what `new Date()` would do.
  it.each(['2026-13-01', '2026-02-30', '01-11-2026', '2026-11-01T10:00'])(
    'rejects the day %s',
    async (from) => {
      expect(await errorFields({ from })).toEqual(['from']);
    },
  );

  it('upper-cases the reference and trims it', () => {
    const dto = plainToInstance(AdminBookingsQueryDto, {
      reference: '  k7m2qx ',
    });

    expect(dto.reference).toBe('K7M2QX');
  });

  // The reference goes into a query, so only letters and digits are allowed:
  // nothing a regular expression could act on ever reaches the database.
  it.each(['K7M', '.*', 'K7M2QX;drop', 'A'.repeat(21)])(
    'rejects the reference %j',
    async (reference) => {
      expect(await errorFields({ reference })).toEqual(['reference']);
    },
  );

  it.each(['0', '-1', '1.5', 'x'])('rejects the page %s', async (page) => {
    expect(await errorFields({ page })).toEqual(['page']);
  });

  it('rejects an unknown query parameter', async () => {
    expect(await errorFields({ limit: '50' })).toEqual(['limit']);
  });
});
