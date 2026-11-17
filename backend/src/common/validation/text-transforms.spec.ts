import { trimLower, trimText } from './text-transforms';

describe('trimText', () => {
  it('trims and keeps the case', () => {
    expect(trimText({ value: '  Sara Ahmed \t' })).toBe('Sara Ahmed');
  });

  it.each([42, null, undefined, true, ['a ']])(
    'returns %p unchanged',
    (value) => {
      expect(trimText({ value })).toBe(value);
    },
  );
});

describe('trimLower', () => {
  it('trims and lower-cases', () => {
    expect(trimLower({ value: '  Sara@Example.COM ' })).toBe(
      'sara@example.com',
    );
  });

  it.each([42, null, undefined, true, ['A ']])(
    'returns %p unchanged',
    (value) => {
      expect(trimLower({ value })).toBe(value);
    },
  );
});
