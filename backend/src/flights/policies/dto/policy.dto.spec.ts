import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { flattenValidationErrors } from '../../../common/validation/validation-exception.factory';
import { BaggagePolicyDto } from './baggage-policy.dto';
import { CancellationPolicyDto } from './cancellation-policy.dto';

// The same options as the global ValidationPipe in app.setup.ts; nested errors are
// flattened like the API does (cancellationTiers.1.refundPercentage).
async function messages(
  type: new () => object,
  body: Record<string, unknown>,
): Promise<Record<string, string[]>> {
  const errors = await validate(plainToInstance(type, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return Object.fromEntries(
    flattenValidationErrors(errors).map((e) => [e.field, e.messages]),
  );
}

describe('BaggagePolicyDto (FLT-08)', () => {
  const VALID = { extraBagPrice: 25, maxExtraBagsPerPassenger: 2 };

  it('accepts a valid policy and 0 extra bags', async () => {
    expect(await messages(BaggagePolicyDto, VALID)).toEqual({});
    expect(
      await messages(BaggagePolicyDto, {
        ...VALID,
        maxExtraBagsPerPassenger: 0,
      }),
    ).toEqual({});
  });

  it.each([[0], [-5], [25.555], ['25'], [null], [10001]])(
    'rejects an extra bag price of %p',
    async (price) => {
      expect(
        Object.keys(
          await messages(BaggagePolicyDto, { ...VALID, extraBagPrice: price }),
        ),
      ).toEqual(['extraBagPrice']);
    },
  );

  it.each([[-1], [1.5], ['2'], [null], [21]])(
    'rejects %p extra bags per passenger',
    async (count) => {
      expect(
        Object.keys(
          await messages(BaggagePolicyDto, {
            ...VALID,
            maxExtraBagsPerPassenger: count,
          }),
        ),
      ).toEqual(['maxExtraBagsPerPassenger']);
    },
  );

  it('requires both fields and rejects unknown ones', async () => {
    expect(Object.keys(await messages(BaggagePolicyDto, {}))).toEqual(
      expect.arrayContaining(['extraBagPrice', 'maxExtraBagsPerPassenger']),
    );
    expect(
      Object.keys(
        await messages(BaggagePolicyDto, {
          ...VALID,
          maxBagWeightKg: 23,
          airlineId: 'x',
          version: 9,
        }),
      ),
    ).toEqual(['maxBagWeightKg', 'airlineId', 'version']);
  });
});

describe('CancellationPolicyDto (FLT-09)', () => {
  const tier = (daysBeforeDeparture: unknown, refundPercentage: unknown) => ({
    daysBeforeDeparture,
    refundPercentage,
  });

  it('accepts tiers, a threshold of 0, percentages 0 and 100, and an empty list', async () => {
    expect(
      await messages(CancellationPolicyDto, {
        cancellationTiers: [tier(14, 100), tier(7, 50), tier(0, 0)],
      }),
    ).toEqual({});
    expect(
      await messages(CancellationPolicyDto, { cancellationTiers: [] }),
    ).toEqual({});
  });

  it('rejects a repeated threshold', async () => {
    expect(
      await messages(CancellationPolicyDto, {
        cancellationTiers: [tier(7, 100), tier(7, 50)],
      }),
    ).toEqual({
      cancellationTiers: [
        'each daysBeforeDeparture threshold may be used only once',
      ],
    });
  });

  it('reports field-level errors with the index of the tier', async () => {
    const result = await messages(CancellationPolicyDto, {
      cancellationTiers: [tier(7, 100), tier(-1, 101), tier(2.5, 10.555)],
    });
    expect(result).toEqual({
      'cancellationTiers.1.daysBeforeDeparture': [
        'daysBeforeDeparture must not be negative',
      ],
      'cancellationTiers.1.refundPercentage': [
        'refundPercentage must not be above 100',
      ],
      'cancellationTiers.2.daysBeforeDeparture': [
        'daysBeforeDeparture must be a whole number',
      ],
      'cancellationTiers.2.refundPercentage': [
        'refundPercentage must be a number with at most 2 decimals',
      ],
    });
  });

  it('rejects a missing or non-list value, too many tiers and unknown fields', async () => {
    expect(Object.keys(await messages(CancellationPolicyDto, {}))).toContain(
      'cancellationTiers',
    );
    expect(
      Object.keys(
        await messages(CancellationPolicyDto, { cancellationTiers: 'x' }),
      ),
    ).toContain('cancellationTiers');
    const many = Array.from({ length: 21 }, (_, i) => tier(i, 10));
    expect(
      Object.keys(
        await messages(CancellationPolicyDto, { cancellationTiers: many }),
      ),
    ).toEqual(['cancellationTiers']);
    expect(
      Object.keys(
        await messages(CancellationPolicyDto, {
          cancellationTiers: [tier(1, 1)],
          extraBagPrice: 5,
        }),
      ),
    ).toEqual(['extraBagPrice']);
  });

  it('rejects unknown fields inside a tier', async () => {
    expect(
      Object.keys(
        await messages(CancellationPolicyDto, {
          cancellationTiers: [{ ...tier(1, 1), status: 'x' }],
        }),
      ),
    ).toEqual(['cancellationTiers.0.status']);
  });
});
