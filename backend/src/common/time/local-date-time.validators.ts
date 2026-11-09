import { buildMessage, ValidateBy, ValidationOptions } from 'class-validator';
import { parseLocalDate, parseLocalDateTime } from './local-date-time';

// DTO decorators for airport-local input (GEN-06). They reuse the strict parser, so
// a bad value becomes a field-level error in the GEN-02 format like any other rule.

export const IS_LOCAL_DATE = 'isLocalDate';
export const IS_LOCAL_DATE_TIME = 'isLocalDateTime';

export function isLocalDate(value: unknown): boolean {
  return parseLocalDate(value) !== null;
}

export function isLocalDateTime(value: unknown): boolean {
  return parseLocalDateTime(value) !== null;
}

/** The value must be a date that exists, written as YYYY-MM-DD. */
export function IsLocalDate(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: IS_LOCAL_DATE,
      validator: {
        validate: (value): boolean => isLocalDate(value),
        defaultMessage: buildMessage(
          (eachPrefix) =>
            `${eachPrefix}$property must be a valid local date (YYYY-MM-DD)`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}

/** The value must be a date and time that exist, written as YYYY-MM-DDTHH:mm. */
export function IsLocalDateTime(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: IS_LOCAL_DATE_TIME,
      validator: {
        validate: (value): boolean => isLocalDateTime(value),
        defaultMessage: buildMessage(
          (eachPrefix) =>
            `${eachPrefix}$property must be a valid local date and time (YYYY-MM-DDTHH:mm)`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}
