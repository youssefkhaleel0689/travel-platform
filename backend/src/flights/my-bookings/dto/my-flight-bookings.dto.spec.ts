import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CancelFlightBookingDto,
  FlightBookingGroup,
  ListMyFlightBookingsQueryDto,
} from './my-flight-bookings.dto';

const options = { whitelist: true, forbidNonWhitelisted: true };

async function errorFields(
  type: new () => object,
  plain: object,
): Promise<string[]> {
  const errors = await validate(plainToInstance(type, plain), options);
  return errors.map((error) => error.property).sort();
}

describe('ListMyFlightBookingsQueryDto (FLT-25)', () => {
  it('defaults to the first page of the UPCOMING group', async () => {
    const dto = plainToInstance(ListMyFlightBookingsQueryDto, {});

    expect(dto.page).toBe(1);
    expect(dto.group).toBe(FlightBookingGroup.UPCOMING);
    expect(await validate(dto, options)).toEqual([]);
  });

  it.each(['UPCOMING', 'PAST', 'CANCELLED'])(
    'accepts the group %s',
    async (group) => {
      expect(
        await errorFields(ListMyFlightBookingsQueryDto, { group, page: '2' }),
      ).toEqual([]);
    },
  );

  it.each(['SOON', 'upcoming', 'PENDING_PAYMENT', ''])(
    'rejects the group %j',
    async (group) => {
      expect(
        await errorFields(ListMyFlightBookingsQueryDto, { group }),
      ).toEqual(['group']);
    },
  );

  it.each(['0', '-1', '1.5', 'x'])('rejects the page %s', async (page) => {
    expect(await errorFields(ListMyFlightBookingsQueryDto, { page })).toEqual([
      'page',
    ]);
  });
});

describe('CancelFlightBookingDto (FLT-26)', () => {
  it('accepts an empty body and a reason', async () => {
    expect(await errorFields(CancelFlightBookingDto, {})).toEqual([]);
    expect(
      await errorFields(CancelFlightBookingDto, { reason: 'My plans changed' }),
    ).toEqual([]);
  });

  it('trims the reason', () => {
    const dto = plainToInstance(CancelFlightBookingDto, {
      reason: '  My plans changed  ',
    });

    expect(dto.reason).toBe('My plans changed');
  });

  it('rejects null, a number and a reason over 500 characters', async () => {
    expect(await errorFields(CancelFlightBookingDto, { reason: null })).toEqual(
      ['reason'],
    );
    expect(await errorFields(CancelFlightBookingDto, { reason: 5 })).toEqual([
      'reason',
    ]);
    expect(
      await errorFields(CancelFlightBookingDto, { reason: 'x'.repeat(501) }),
    ).toEqual(['reason']);
  });

  it('rejects a status or any other field the client sends', async () => {
    expect(
      await errorFields(CancelFlightBookingDto, {
        status: 'CANCELLED',
        refundPercentage: 100,
      }),
    ).toEqual(['refundPercentage', 'status']);
  });
});
