import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real calendar date, not merely an ISO-shaped string: `new Date()`
 * silently rolls 2027-02-30 into 2 March, which would charge the wrong nights.
 */
export function isDateOnly(value: unknown): boolean {
  if (typeof value !== 'string' || !DATE_ONLY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function IsDateOnly(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isDateOnly',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => isDateOnly(value),
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must be a real calendar date in YYYY-MM-DD format`,
      },
    });
  };
}
