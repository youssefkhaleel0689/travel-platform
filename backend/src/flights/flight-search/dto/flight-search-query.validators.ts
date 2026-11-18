import {
  ValidateBy,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { parseLocalDate } from '../../../common/time/local-date-time';
import { MONEY_AMOUNT, TripType } from '../flight-search.constants';

// Cross-field rules of FlightSearchQueryDto. Each one reads the other field from
// args.object and stays silent while that field is itself invalid, so a client gets one
// clear error per mistake instead of two.

function other(args: ValidationArguments, property: string): unknown {
  return (args.object as Record<string, unknown>)[property];
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** The value must differ from another property, e.g. arrival vs departure airport. */
export function IsDifferentFrom(
  property: string,
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isDifferentFrom',
      constraints: [property],
      validator: {
        validate: (value, args) => value !== other(args!, property),
        defaultMessage: (args) =>
          `${args!.property} must differ from ${property}`,
      },
    },
    options,
  );
}

/** A count that may not exceed another count, e.g. infants per adult (FLT-12). */
export function IsAtMostCount(
  property: string,
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isAtMostCount',
      constraints: [property],
      validator: {
        validate: (value, args) => {
          const limit = other(args!, property);
          return !isCount(value) || !isCount(limit) || value <= limit;
        },
        defaultMessage: (args) =>
          `${args!.property} must not be more than ${property}`,
      },
    },
    options,
  );
}

/** This count plus another count may not exceed `max`, e.g. adults + children. */
export function IsSumWithin(
  property: string,
  max: number,
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isSumWithin',
      constraints: [property, max],
      validator: {
        validate: (value, args) => {
          const added = other(args!, property);
          // Over the limit on its own: that field reports its own error.
          if (!isCount(value) || !isCount(added) || added > max) {
            return true;
          }
          return value + added <= max;
        },
        defaultMessage: (args) =>
          `${property} + ${args!.property} must be at most ${max}`,
      },
    },
    options,
  );
}

// Exact comparison of two amounts such as "100" and "99.99" in whole cents (BigInt),
// so no floating-point number is involved. Both have already matched MONEY_AMOUNT.
function toCents(amount: string): bigint {
  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

/** A money amount that may not be below another one, e.g. maxPrice vs minPrice (FLT-15). */
export function IsAmountNotBelow(
  property: string,
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isAmountNotBelow',
      constraints: [property],
      validator: {
        validate: (value, args) => {
          const lower = other(args!, property);
          if (
            typeof value !== 'string' ||
            typeof lower !== 'string' ||
            !MONEY_AMOUNT.test(value) ||
            !MONEY_AMOUNT.test(lower)
          ) {
            return true;
          }
          return toCents(value) >= toCents(lower);
        },
        defaultMessage: (args) =>
          `${args!.property} must not be less than ${property}`,
      },
    },
    options,
  );
}

// The return date and the trip type in one rule (FLT-12). Four outcomes, each with its own
// message: not allowed one way, required for a round trip, a real date, not before departure.
function returnDateProblem(
  value: unknown,
  args: ValidationArguments,
): string | null {
  const roundTrip = other(args, 'tripType') === TripType.ROUND_TRIP;
  if (!roundTrip) {
    return value === undefined
      ? null
      : 'returnDate is only allowed for a ROUND_TRIP';
  }
  if (value === undefined) {
    return 'returnDate is required for a ROUND_TRIP';
  }
  if (parseLocalDate(value) === null) {
    return 'returnDate must be a valid local date (YYYY-MM-DD)';
  }
  const departure = other(args, 'departureDate');
  // YYYY-MM-DD strings sort like the dates they name.
  if (
    parseLocalDate(departure) !== null &&
    (value as string) < (departure as string)
  ) {
    return 'returnDate must not be before departureDate';
  }
  return null;
}

/** Use on returnDate, without @IsOptional(): it handles a missing value itself. */
export function IsValidReturnDate(
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isValidReturnDate',
      validator: {
        validate: (value, args) => returnDateProblem(value, args!) === null,
        defaultMessage: (args) => returnDateProblem(args!.value, args!) ?? '',
      },
    },
    options,
  );
}
