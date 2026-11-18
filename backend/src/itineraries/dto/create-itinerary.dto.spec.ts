import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateItineraryDto } from './create-itinerary.dto';
import { SetVisibilityDto } from './set-visibility.dto';

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

describe('CreateItineraryDto', () => {
  const ok = { title: 'Trip', countries: ['FR'], startDate: '2026-12-20' };

  it('accepts a valid body', async () => {
    expect(await errorsOf(CreateItineraryDto, ok)).toEqual([]);
  });

  it('rejects bad title, country and date', async () => {
    expect(await errorsOf(CreateItineraryDto, { ...ok, title: '   ' })).toEqual(
      ['title'],
    );
    expect(
      await errorsOf(CreateItineraryDto, { ...ok, title: 'x'.repeat(101) }),
    ).toEqual(['title']);
    expect(
      await errorsOf(CreateItineraryDto, { ...ok, countries: ['XX'] }),
    ).toEqual(['countries']);
    expect(
      await errorsOf(CreateItineraryDto, { ...ok, countries: [] }),
    ).toEqual(['countries']);
    expect(
      await errorsOf(CreateItineraryDto, { ...ok, startDate: '20/12/2026' }),
    ).toEqual(['startDate']);
  });

  it('rejects unknown fields', async () => {
    expect(await errorsOf(CreateItineraryDto, { ...ok, owner: 'x' })).toEqual([
      'owner',
    ]);
  });
});

describe('SetVisibilityDto', () => {
  it('only accepts public or private', async () => {
    expect(await errorsOf(SetVisibilityDto, { visibility: 'public' })).toEqual(
      [],
    );
    expect(await errorsOf(SetVisibilityDto, { visibility: 'private' })).toEqual(
      [],
    );
    expect(await errorsOf(SetVisibilityDto, { visibility: 'friends' })).toEqual(
      ['visibility'],
    );
  });
});
