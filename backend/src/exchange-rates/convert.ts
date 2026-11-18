// Rates are "units of currency per 1 USD", so converting goes through USD.
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>,
): number {
  if (from === to) return amount;
  const fromRate = rates[from];
  const toRate = rates[to];
  if (!fromRate || !toRate) {
    throw new Error(`No exchange rate for ${!fromRate ? from : to}`);
  }
  return (amount / fromRate) * toRate;
}
