import { BadRequestException } from '@nestjs/common';

/**
 * GEN-02: a business-rule rejection is still a field error, so the frontend
 * can render it in the same per-field shape as class-validator failures.
 */
export function fieldBadRequest(
  field: string,
  message: string,
): BadRequestException {
  return new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'Validation failed',
    errors: [{ field, messages: [message] }],
  });
}
