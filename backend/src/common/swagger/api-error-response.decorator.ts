import { STATUS_CODES } from 'node:http';
import { ApiResponse, ApiResponseExamples } from '@nestjs/swagger';
import { ErrorResponseDto, FieldErrorDto } from '../dto/error-response.dto';

// Fixed so the generated document does not change from one run to the next.
export const ERROR_EXAMPLE_TIMESTAMP = '2026-11-12T10:00:00.000Z';

export interface ApiErrorExample {
  code: string;
  message: string;
  /** The endpoint's real path, with an example id where it has one. */
  path: string;
  errors?: FieldErrorDto[];
}

export interface ApiErrorResponseOptions {
  status: number;
  description: string;
  /** At least one. Several are shown as a dropdown named by `code`, so codes must differ. */
  examples: [ApiErrorExample, ...ApiErrorExample[]];
}

/** A complete error body, built the same way as AllExceptionsFilter builds it. */
export function errorExample(
  status: number,
  example: ApiErrorExample,
): ErrorResponseDto {
  return {
    statusCode: status,
    code: example.code,
    // Same source as the filter, so the reason phrase always matches.
    error: STATUS_CODES[status] ?? 'Error',
    message: example.message,
    ...(example.errors && { errors: example.errors }),
    path: example.path,
    timestamp: ERROR_EXAMPLE_TIMESTAMP,
  };
}

/**
 * Documents one error status of an endpoint with real example bodies (GEN-02).
 *
 * An example on a DTO is shared by every response that uses the DTO, so per-status
 * examples must be attached to each response; that is what this decorator does. The
 * schema stays a reference to ErrorResponseDto (`type` also registers the model).
 */
export function ApiErrorResponse(
  options: ApiErrorResponseOptions,
): MethodDecorator & ClassDecorator {
  const { status, description, examples } = options;
  if (examples.length === 0) {
    throw new Error(`ApiErrorResponse(${status}) needs at least one example`);
  }
  const bodies = examples.map((example) => errorExample(status, example));

  if (bodies.length === 1) {
    return ApiResponse({
      status,
      description,
      type: ErrorResponseDto,
      example: bodies[0],
    });
  }

  const named: Record<string, ApiResponseExamples> = {};
  for (const body of bodies) {
    if (body.code in named) {
      throw new Error(
        `ApiErrorResponse(${status}): examples are named by code, and ${body.code} is used twice`,
      );
    }
    named[body.code] = { summary: body.message, value: body };
  }
  return ApiResponse({
    status,
    description,
    type: ErrorResponseDto,
    examples: named,
  });
}
