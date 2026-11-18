import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

/** All money is handled as integer cents (BigInt); no floating point arithmetic. */
export function toCents(value: string | Types.Decimal128 | { toString(): string }): bigint {
  const s = value.toString().trim();
  const m = /^(\d+)(?:\.(\d{1,2})0*)?$/.exec(s);
  if (!m) throw new BadRequestException(`Invalid money amount: ${s}`);
  const frac = (m[2] ?? '').padEnd(2, '0');
  return BigInt(m[1]) * 100n + BigInt(frac);
}

export function centsToString(c: bigint): string {
  const whole = c / 100n;
  const frac = (c % 100n).toString().padStart(2, '0');
  return `${whole}.${frac}`;
}

export const centsToDecimal128 = (c: bigint) => Types.Decimal128.fromString(centsToString(c));

/** Refund = total * percentage / 100, rounded half-up to the cent. Percentage may have 2 decimals. */
export function refundCents(totalCents: bigint, percentage: number): bigint {
  const basisPoints = BigInt(Math.round(percentage * 100));
  return (totalCents * basisPoints + 5000n) / 10000n;
}

/**
 * Picks the tier with the highest threshold not exceeding daysRemaining (HTL-10 / FLT-09 rule).
 * No applicable tier => 0%.
 */
export function pickRefundPercentage(
  tiers: { daysBeforeCheckIn: number; refundPercentage: number }[],
  daysRemaining: number,
): number {
  const applicable = tiers
    .filter((t) => t.daysBeforeCheckIn <= daysRemaining)
    .sort((a, b) => b.daysBeforeCheckIn - a.daysBeforeCheckIn);
  return applicable.length ? applicable[0].refundPercentage : 0;
}
