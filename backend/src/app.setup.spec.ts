import { corsOrigins, DEFAULT_CORS_ORIGINS } from './app.setup';

describe('corsOrigins', () => {
  it('allows the Next.js dev server when CORS_ORIGINS is not set', () => {
    expect(corsOrigins(undefined)).toEqual(['http://localhost:3001']);
    expect(corsOrigins('')).toEqual([...DEFAULT_CORS_ORIGINS]);
  });

  it('reads a comma-separated list, trimmed, without trailing slashes or empty entries', () => {
    expect(
      corsOrigins(' https://travel.example/ , http://localhost:3001,, '),
    ).toEqual(['https://travel.example', 'http://localhost:3001']);
  });

  it('never turns into a wildcard', () => {
    expect(corsOrigins(',,')).toEqual([...DEFAULT_CORS_ORIGINS]);
  });
});
