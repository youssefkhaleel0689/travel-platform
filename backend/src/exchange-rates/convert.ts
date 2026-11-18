import Decimal from 'decimal.js';

// Rates are "units of currency per 1 USD", so converting goes through USD.
// Amounts are decimal strings (money is never a JavaScript float); the result
// keeps full precision and is rounded only when it is shown (budget summary).
export function convertAmount(
  amount: Decimal.Value,
  from: string,
  to: string,
  rates: Record<string, number>,
): Decimal {
  const value = new Decimal(amount);
  if (from === to) return value;
  const fromRate = rates[from];
  const toRate = rates[to];
  if (!fromRate || !toRate) {
    throw new Error(`No exchange rate for ${!fromRate ? from : to}`);
  }
  return value.dividedBy(fromRate).times(toRate);
}
