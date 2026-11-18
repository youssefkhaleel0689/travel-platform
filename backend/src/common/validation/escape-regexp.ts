/**
 * Escapes every regular-expression metacharacter so user input is matched as
 * literal text. Without it a search term such as "(.*)+$" would be compiled
 * as a pattern and could stall the server (ReDoS). Same rule as the ACC-14
 * admin account search.
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
