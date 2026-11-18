import {
  ValidateBy,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { PassengerType, TripType } from '../../schemas/flight-booking.schema';

// Rules of FlightBookingRequestDto that look at more than one value. Each one stays silent
// while the values it reads are themselves invalid, so a client gets one clear error per
// mistake instead of two.

const PASSENGER_TYPES: readonly unknown[] = Object.values(PassengerType);

// How many passengers of each type the list holds, or null when the list is not usable
// yet (not a list, or a passenger without a valid type): the field that is wrong reports
// itself, and counting around it would only add a misleading second error.
function countTypes(value: unknown): Record<PassengerType, number> | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const counts = {
    [PassengerType.ADULT]: 0,
    [PassengerType.CHILD]: 0,
    [PassengerType.INFANT]: 0,
  };
  for (const passenger of value as unknown[]) {
    const type = (passenger as { passengerType?: unknown } | null)
      ?.passengerType;
    if (!PASSENGER_TYPES.includes(type)) {
      return null;
    }
    counts[type as PassengerType] += 1;
  }
  return counts;
}

/** FLT-12: every booking needs at least one adult. */
export function HasAnAdult(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'hasAnAdult',
      validator: {
        validate: (value) => {
          const counts = countTypes(value);
          // An empty list is reported by ArrayMinSize.
          if (!counts || (value as unknown[]).length === 0) {
            return true;
          }
          return counts[PassengerType.ADULT] >= 1;
        },
        defaultMessage: (args) =>
          `${args!.property} must include at least one adult`,
      },
    },
    options,
  );
}

/** FLT-12: an infant sits on an adult's lap, so there are no more infants than adults. */
export function HasNoMoreInfantsThanAdults(
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'hasNoMoreInfantsThanAdults',
      validator: {
        validate: (value) => {
          const counts = countTypes(value);
          // No adult at all: HasAnAdult already reports it.
          if (!counts || counts[PassengerType.ADULT] === 0) {
            return true;
          }
          return counts[PassengerType.INFANT] <= counts[PassengerType.ADULT];
        },
        defaultMessage: (args) =>
          `${args!.property} must not have more infants than adults`,
      },
    },
    options,
  );
}

/** Adults and children take a seat each; infants do not (FLT-12). */
export function HasSeatedAtMost(
  max: number,
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'hasSeatedAtMost',
      constraints: [max],
      validator: {
        validate: (value) => {
          const counts = countTypes(value);
          return (
            !counts ||
            counts[PassengerType.ADULT] + counts[PassengerType.CHILD] <= max
          );
        },
        defaultMessage: (args) =>
          `${args!.property} must have at most ${max} adults and children`,
      },
    },
    options,
  );
}

/** The return flight: required for a ROUND_TRIP, not allowed for a ONE_WAY trip. */
export function IsValidInbound(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isValidInbound',
      validator: {
        validate: (value, args: ValidationArguments | undefined) => {
          const tripType = (args!.object as { tripType?: unknown }).tripType;
          if (tripType === TripType.ROUND_TRIP) {
            return value !== undefined && value !== null;
          }
          if (tripType === TripType.ONE_WAY) {
            return value === undefined;
          }
          // An invalid tripType reports its own error.
          return true;
        },
        defaultMessage: (args) =>
          (args!.object as { tripType?: unknown }).tripType ===
          TripType.ROUND_TRIP
            ? `${args!.property} is required for a ROUND_TRIP`
            : `${args!.property} is only allowed for a ROUND_TRIP`,
      },
    },
    options,
  );
}
