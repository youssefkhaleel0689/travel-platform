import { FieldErrorDto } from '../dto/error-response.dto';
import { ApiErrorResponseOptions } from './api-error-response.decorator';

/**
 * The error bodies that repeat across protected endpoints, as
 * ApiErrorResponseOptions ready for @ApiErrorResponse.
 *
 * Each takes the endpoint's own path, because an example is per response and
 * the convention is that the path in it is the real one. Writing them out by
 * hand in every controller would drift; these keep the codes and wording
 * identical everywhere.
 */

/** 401 from the global JwtAuthGuard (ACC-04, ACC-19). */
export function unauthenticated(path: string): ApiErrorResponseOptions {
  return {
    status: 401,
    description:
      'Not logged in, the cookie is missing or invalid, or the account is not ' +
      'active (UNAUTHENTICATED)',
    examples: [
      {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
        path,
      },
    ],
  };
}

/**
 * 403 from the global guards: the role is not allowed (ACC-11) or the account
 * still owes a password change (ACC-07a).
 */
export function forbidden(
  path: string,
  options: { role?: boolean; passwordChange?: boolean } = {
    role: true,
    passwordChange: true,
  },
): ApiErrorResponseOptions {
  const examples: ApiErrorResponseOptions['examples'] = [
    {
      code: 'PASSWORD_CHANGE_REQUIRED',
      message: 'A new password must be set before continuing',
      path,
    },
  ];
  if (options.role !== false) {
    examples.unshift({
      code: 'FORBIDDEN',
      message: 'You do not have permission to do this',
      path,
    });
  }
  if (options.passwordChange === false) {
    examples.pop();
  }
  return {
    status: 403,
    description:
      'The role is not allowed (FORBIDDEN), or a password change is pending ' +
      '(PASSWORD_CHANGE_REQUIRED)',
    examples: examples as ApiErrorResponseOptions['examples'],
  };
}

/** 404 where another account's row is indistinguishable from none (ACC-11). */
export function notFound(
  path: string,
  message: string,
): ApiErrorResponseOptions {
  return {
    status: 404,
    description: `${message}. Another account's row answers the same, so ids cannot be probed`,
    examples: [{ code: 'NOT_FOUND', message, path }],
  };
}

/** 400 from the global validation pipe (GEN-02). */
export function validationFailed(
  path: string,
  errors: FieldErrorDto[],
  description = 'Validation failed, with one entry per invalid field',
): ApiErrorResponseOptions {
  return {
    status: 400,
    description,
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path,
        errors,
      },
    ],
  };
}
