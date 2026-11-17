import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CabinCategory } from '../../schemas/flight.schema';
import { CreateCabinDto } from './create-cabin.dto';
import { UpdateCabinDto } from './update-cabin.dto';

// The same options as the global ValidationPipe in app.setup.ts.
async function messages(
  type: new () => object,
  body: Record<string, unknown>,
): Promise<Record<string, string[]>> {
  const errors = await validate(plainToInstance(type, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return Object.fromEntries(
    errors.map((error) => [
      error.property,
      Object.values(error.constraints ?? {}),
    ]),
  );
}

const VALID = {
  category: 'ECONOMY',
  totalSeats: 150,
  price: 199.99,
  freeBaggageCount: 1,
  maxBagWeightKg: 23,
};

describe('CreateCabinDto (FLT-04)', () => {
  it('accepts a valid cabin', async () => {
    expect(await messages(CreateCabinDto, VALID)).toEqual({});
  });

  it('normalises the category (trim, upper case)', () => {
    const dto = plainToInstance(CreateCabinDto, {
      ...VALID,
      category: '  premium_economy ',
    });
    expect(dto.category).toBe(CabinCategory.PREMIUM_ECONOMY);
  });

  it('accepts every category of the fixed set', async () => {
    for (const category of Object.values(CabinCategory)) {
      expect(await messages(CreateCabinDto, { ...VALID, category })).toEqual(
        {},
      );
    }
  });

  it('rejects a category outside the fixed set', async () => {
    const result = await messages(CreateCabinDto, {
      ...VALID,
      category: 'LUXURY',
    });
    expect(result.category).toBeDefined();
  });

  it.each([0, -5, 1.5, '150', null])('rejects totalSeats %p', async (seats) => {
    const result = await messages(CreateCabinDto, {
      ...VALID,
      totalSeats: seats,
    });
    expect(result.totalSeats).toBeDefined();
  });

  it.each([0, -1, 1.234, '10', null, 2_000_000])(
    'rejects price %p',
    async (price) => {
      const result = await messages(CreateCabinDto, { ...VALID, price });
      expect(result.price).toBeDefined();
    },
  );

  it('accepts a price with 2 decimals and a whole price', async () => {
    expect(await messages(CreateCabinDto, { ...VALID, price: 0.01 })).toEqual(
      {},
    );
    expect(await messages(CreateCabinDto, { ...VALID, price: 500 })).toEqual(
      {},
    );
  });

  it('accepts 0 free bags but not a negative or fractional count', async () => {
    expect(
      await messages(CreateCabinDto, { ...VALID, freeBaggageCount: 0 }),
    ).toEqual({});
    for (const value of [-1, 0.5]) {
      const result = await messages(CreateCabinDto, {
        ...VALID,
        freeBaggageCount: value,
      });
      expect(result.freeBaggageCount).toBeDefined();
    }
  });

  it.each([0, 0.05, -3, null])('rejects maxBagWeightKg %p', async (weight) => {
    const result = await messages(CreateCabinDto, {
      ...VALID,
      maxBagWeightKg: weight,
    });
    expect(result.maxBagWeightKg).toBeDefined();
  });

  it('rejects the counters and other fields the client must not send', async () => {
    for (const field of ['bookedSeats', 'heldSeats', 'status', 'airlineId']) {
      const result = await messages(CreateCabinDto, { ...VALID, [field]: 1 });
      expect(result[field]).toBeDefined();
    }
  });

  it('reports every missing field', async () => {
    const result = await messages(CreateCabinDto, {});
    expect(Object.keys(result).sort()).toEqual([
      'category',
      'freeBaggageCount',
      'maxBagWeightKg',
      'price',
      'totalSeats',
    ]);
  });
});

describe('UpdateCabinDto (FLT-04, FLT-05)', () => {
  it('accepts any one of the three fields, or none (the service rejects an empty body)', async () => {
    expect(await messages(UpdateCabinDto, { price: 179.5 })).toEqual({});
    expect(await messages(UpdateCabinDto, { freeBaggageCount: 2 })).toEqual({});
    expect(await messages(UpdateCabinDto, { maxBagWeightKg: 30 })).toEqual({});
    expect(await messages(UpdateCabinDto, {})).toEqual({});
  });

  it('rejects null instead of letting it through as "not sent"', async () => {
    for (const field of ['price', 'freeBaggageCount', 'maxBagWeightKg']) {
      const result = await messages(UpdateCabinDto, { [field]: null });
      expect(result[field]).toBeDefined();
    }
  });

  it('applies the same value rules as creating a cabin', async () => {
    expect((await messages(UpdateCabinDto, { price: 0 })).price).toBeDefined();
    expect(
      (await messages(UpdateCabinDto, { price: 1.234 })).price,
    ).toBeDefined();
    expect(
      (await messages(UpdateCabinDto, { freeBaggageCount: -1 }))
        .freeBaggageCount,
    ).toBeDefined();
    expect(
      (await messages(UpdateCabinDto, { maxBagWeightKg: 0 })).maxBagWeightKg,
    ).toBeDefined();
  });

  it('does not accept totalSeats, category or the counters', async () => {
    for (const field of [
      'totalSeats',
      'category',
      'bookedSeats',
      'heldSeats',
    ]) {
      const result = await messages(UpdateCabinDto, { [field]: 5 });
      expect(result[field]).toBeDefined();
    }
  });
});
