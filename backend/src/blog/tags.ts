import { MAX_TAGS_PER_POST, TAG_MAX_LENGTH } from './blog.constants';

// "Egypt", " egypt " and "EGYPT" are stored as the same tag (BLG-08).
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

export const TAG_PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{N} _-]*[\p{L}\p{N}])?$/u;

export function isValidTag(tag: string): boolean {
  return tag.length <= TAG_MAX_LENGTH && TAG_PATTERN.test(tag);
}

export function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of raw) {
    const tag = normalizeTag(value);
    if (tag !== '' && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

export const TAG_RULES =
  `At most ${MAX_TAGS_PER_POST} tags, each at most ${TAG_MAX_LENGTH} ` +
  'characters of letters, digits, spaces, hyphens or underscores. ' +
  'Stored in lower case without duplicates.';
