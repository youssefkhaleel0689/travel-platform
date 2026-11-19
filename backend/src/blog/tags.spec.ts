import { isValidTag, normalizeTag, normalizeTags } from './tags';
import { excerptOf } from './posts.service';

describe('tags (BLG-08)', () => {
  it('stores one spelling per tag: trimmed, lower case, single spaces', () => {
    expect(normalizeTag('  Nile   Cruise ')).toBe('nile cruise');
  });

  it('drops duplicates after normalising, keeping the first position', () => {
    expect(normalizeTags(['Egypt', 'luxor', ' egypt', 'LUXOR', ''])).toEqual([
      'egypt',
      'luxor',
    ]);
  });

  it.each(['egypt', 'nile cruise', 'road-trip', 'top_10', 'القاهرة'])(
    'accepts %s',
    (tag) => expect(isValidTag(tag)).toBe(true),
  );

  it.each(['#egypt', '-start', 'end-', 'a'.repeat(31), 'emoji 🙂'])(
    'refuses %s',
    (tag) => expect(isValidTag(tag)).toBe(false),
  );
});

describe('excerptOf (BLG-09)', () => {
  it('returns a short body unchanged', () => {
    expect(excerptOf('Short and sweet.')).toBe('Short and sweet.');
  });

  it('cuts a long body at a word boundary, at most 200 characters plus an ellipsis', () => {
    const body = 'word '.repeat(100);
    const excerpt = excerptOf(body);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(201);
    expect(excerpt).not.toMatch(/\s…$/);
  });
});
