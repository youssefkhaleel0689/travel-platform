import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateActivityDto } from './activity.dto';
import { CreateBudgetEntryDto } from './budget-entry.dto';
import { CreateDayDto } from './day.dto';

// Same options as the global ValidationPipe in app.setup.ts
async function errorsOf<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

describe('CreateDayDto', () => {
  it('only accepts a well-formed city id (existence is checked in the service)', async () => {
    expect(await errorsOf(CreateDayDto, { city: 'paris' })).toEqual([]);
    expect(await errorsOf(CreateDayDto, { city: 'New York!' })).toEqual([
      'city',
    ]);
  });
});

describe('CreateActivityDto', () => {
  it('requires a currency when a cost is given', async () => {
    expect(await errorsOf(CreateActivityDto, { name: 'A' })).toEqual([]);
    expect(
      await errorsOf(CreateActivityDto, {
        name: 'A',
        cost: 5,
        currency: 'EUR',
      }),
    ).toEqual([]);
    expect(await errorsOf(CreateActivityDto, { name: 'A', cost: 5 })).toEqual([
      'currency',
    ]);
  });

  it('validates time and cost', async () => {
    expect(
      await errorsOf(CreateActivityDto, { name: 'A', time: '24:00' }),
    ).toEqual(['time']);
    expect(
      await errorsOf(CreateActivityDto, { name: 'A', time: '08:05' }),
    ).toEqual([]);
    expect(
      await errorsOf(CreateActivityDto, {
        name: 'A',
        cost: -1,
        currency: 'EUR',
      }),
    ).toEqual(['cost']);
  });
});

describe('CreateBudgetEntryDto', () => {
  it('accepts the four categories and rejects others', async () => {
    const body = { category: 'food', amount: 10, currency: 'USD' };
    expect(await errorsOf(CreateBudgetEntryDto, body)).toEqual([]);
    expect(
      await errorsOf(CreateBudgetEntryDto, { ...body, category: 'shopping' }),
    ).toEqual(['category']);
    expect(
      await errorsOf(CreateBudgetEntryDto, { ...body, currency: 'EURO' }),
    ).toEqual(['currency']);
    expect(
      await errorsOf(CreateBudgetEntryDto, { ...body, amount: -5 }),
    ).toEqual(['amount']);
  });
});
