import { BadRequestException, ValidationError } from '@nestjs/common';
import { FieldErrorDto } from '../dto/error-response.dto';

// Turns class-validator's nested error tree into a flat list with dotted paths,
// e.g. passengers[0].name becomes { field: 'passengers.0.name', messages: [...] }.
export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): FieldErrorDto[] {
  return errors.flatMap((error) => {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const own = error.constraints
      ? [{ field, messages: Object.values(error.constraints) }]
      : [];
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}

export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  return new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'Validation failed',
    errors: flattenValidationErrors(errors),
  });
}
