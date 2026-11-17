import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Types } from 'mongoose';

/**
 * PAY-04: one platform currency for every flight and hotel price, payment and
 * refund. Booking money is never converted. A user's preferred currency
 * (ACC-09) applies to itinerary budgets only.
 */
export const PLATFORM_CURRENCY = 'USD';

/** USD has 2 decimal places, so one unit is 100 minor units (cents). */
export const PLATFORM_CURRENCY_DECIMALS = 2;
const MINOR_UNITS_PER_UNIT = 10 ** PLATFORM_CURRENCY_DECIMALS;

/** FLT-22, HTL-18: the hold lasts 10 minutes. */
export const HOLD_MINUTES = 10;

// Money is only ever added, multiplied by a percentage and compared here;
// every value keeps 2 decimal places and rounds half up, the way an invoice
// does. Nothing in this file uses the native number type for an amount.
const Money = Decimal.clone({
  precision: 28,
  rounding: Decimal.ROUND_HALF_UP,
});

/**
 * Parses a money string such as "199.99". Rejects anything that is not a
 * finite, non-negative amount with at most 2 decimals, so a bad value cannot
 * travel on into a Stripe call.
 */
export function parseMoney(amount: string): Decimal {
  let value: Decimal;
  try {
    value = new Money(amount);
  } catch {
    // decimal.js throws its own error for text it cannot read at all; this
    // keeps every bad amount on the one path below.
    throw new InternalServerErrorException(
      `Not a usable amount: ${JSON.stringify(amount)}`,
    );
  }
  if (!value.isFinite() || value.isNegative()) {
    throw new InternalServerErrorException(
      `Not a usable amount: ${JSON.stringify(amount)}`,
    );
  }
  if (value.decimalPlaces() > PLATFORM_CURRENCY_DECIMALS) {
    throw new InternalServerErrorException(
      `Amount has more than ${PLATFORM_CURRENCY_DECIMALS} decimal places: ${amount}`,
    );
  }
  return value;
}

/** The canonical string form stored and returned: always 2 decimals. */
export function formatMoney(amount: Decimal | string): string {
  const value = amount instanceof Decimal ? amount : parseMoney(amount);
  return value.toFixed(PLATFORM_CURRENCY_DECIMALS);
}

/**
 * Stripe charges whole minor units, so this is the only place an amount
 * becomes a native number - and only after checking that it really is a whole
 * number of cents and small enough to be exact in a double.
 */
export function toMinorUnits(amount: string | Decimal): number {
  const minor = (
    amount instanceof Decimal ? amount : parseMoney(amount)
  ).times(MINOR_UNITS_PER_UNIT);

  if (!minor.isInteger()) {
    throw new InternalServerErrorException(
      `Amount is not a whole number of minor units: ${minor.toString()}`,
    );
  }
  if (minor.greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw new InternalServerErrorException('Amount is too large to charge');
  }
  return minor.toNumber();
}

/** Turns an amount Stripe reported back into a money string. */
export function fromMinorUnits(minorUnits: number): string {
  return formatMoney(new Money(minorUnits).dividedBy(MINOR_UNITS_PER_UNIT));
}

/**
 * PAY-03: the refundable share of a captured amount, from the provider's
 * cancellation tier. Rounds half up to the cent and never exceeds the amount
 * that was captured.
 */
export function percentageOf(amount: string, percentage: number): string {
  if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) {
    throw new BadRequestException({
      code: 'INVALID_REFUND_PERCENTAGE',
      message: 'refundPercentage must be a whole number between 0 and 100',
    });
  }
  const captured = parseMoney(amount);
  const share = captured
    .times(percentage)
    .dividedBy(100)
    .toDecimalPlaces(PLATFORM_CURRENCY_DECIMALS);

  // Guards against a rounding step ever producing more than was captured.
  return formatMoney(Decimal.min(share, captured) as Decimal);
}

export function addMoney(a: string, b: string): string {
  return formatMoney(parseMoney(a).plus(parseMoney(b)));
}

export function isGreaterThan(a: string, b: string): boolean {
  return parseMoney(a).greaterThan(parseMoney(b));
}

export function isZero(amount: string): boolean {
  return parseMoney(amount).isZero();
}

/**
 * Money is stored as Decimal128 (schema section 1), never as a float. Mongoose
 * returns a Decimal128 object, so a response DTO converts it back to a string
 * here - lean queries skip document transforms, which is why this is a
 * function and not a schema getter.
 */
export function decimal128ToString(
  value: Types.Decimal128 | string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return formatMoney(value.toString());
}

/** Turns a validated money string into the Decimal128 the schema stores. */
export function toDecimal128(amount: string): Types.Decimal128 {
  return Types.Decimal128.fromString(formatMoney(amount));
}
