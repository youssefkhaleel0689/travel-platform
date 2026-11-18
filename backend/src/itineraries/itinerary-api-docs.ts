import { applyDecorators } from '@nestjs/common';
import { ApiCookieAuth } from '@nestjs/swagger';
import {
  ApiErrorResponse,
  ApiErrorResponseOptions,
} from '../common/swagger/api-error-response.decorator';
import {
  forbidden,
  unauthenticated,
  validationFailed,
} from '../common/swagger/standard-errors';
import type { FieldErrorDto } from '../common/dto/error-response.dto';

// Swagger error examples shared by the itinerary controllers (GEN-02, ACC-11).
// Example ids, so every documented path is a real-looking one.
export const EXAMPLE_ITINERARY_ID = '6720f1c2a1b2c3d4e5f60718';
export const EXAMPLE_DAY_ID = '6720f1c2a1b2c3d4e5f60719';
export const EXAMPLE_ACTIVITY_ID = '6720f1c2a1b2c3d4e5f60720';
export const EXAMPLE_BUDGET_ID = '6720f1c2a1b2c3d4e5f60730';
export const EXAMPLE_TRANSPORT_ID = '6720f1c2a1b2c3d4e5f60740';

export const ITINERARY_PATH = `/api/itineraries/${EXAMPLE_ITINERARY_ID}`;

/** Cookie auth plus the 401 and 403 every protected itinerary route can give. */
export function ApiItineraryAuth(path: string) {
  return applyDecorators(
    ApiCookieAuth(),
    ApiErrorResponse(unauthenticated(path)),
    ApiErrorResponse(forbidden(path, { role: false, passwordChange: true })),
  );
}

/** 404 where a missing row and another account's row answer the same (ACC-11). */
export function notFoundError(
  path: string,
  ...errors: [
    { code: string; message: string },
    ...{ code: string; message: string }[],
  ]
): ApiErrorResponseOptions {
  return {
    status: 404,
    description:
      'Not found. A malformed id, a missing row and another account’s row all answer the same, so ids cannot be probed (ACC-11)',
    examples: errors.map((e) => ({ ...e, path })) as [
      ApiErrorResponseOptions['examples'][number],
      ...ApiErrorResponseOptions['examples'],
    ],
  };
}

/** 400: one validation example plus the reference-data or rule errors of the route. */
export function badRequestError(
  path: string,
  validation: FieldErrorDto[],
  ...rules: { code: string; message: string }[]
): ApiErrorResponseOptions {
  const base = validationFailed(path, validation);
  return {
    status: 400,
    description:
      'Validation failed (one entry per invalid field), or a value is not in the seeded reference data or breaks a rule',
    examples: [base.examples[0], ...rules.map((r) => ({ ...r, path }))],
  };
}

export const UNKNOWN_CITY = {
  code: 'UNKNOWN_CITY',
  message: 'Unknown city: atlantis',
};
export const UNKNOWN_COUNTRY = {
  code: 'UNKNOWN_COUNTRY',
  message: 'Unknown countries: XX',
};
export const UNSUPPORTED_CURRENCY = {
  code: 'UNSUPPORTED_CURRENCY',
  message: 'Unsupported currency: XYZ',
};

export const ITINERARY_NOT_FOUND_EXAMPLE = {
  code: 'ITINERARY_NOT_FOUND',
  message: 'Itinerary not found',
};
export const DAY_NOT_FOUND_EXAMPLE = {
  code: 'DAY_NOT_FOUND',
  message: 'Day not found',
};

export const EXCHANGE_RATES_UNAVAILABLE: ApiErrorResponseOptions = {
  status: 503,
  description:
    'FXRatesAPI is unreachable and no rates were ever cached (ITN-18); with cached rates the answer is 200 with stale: true',
  examples: [
    {
      code: 'EXCHANGE_RATES_UNAVAILABLE',
      message:
        'Exchange rates are currently unavailable. Please try again later.',
      path: '/api/exchange-rates',
    },
  ],
};

export { ApiErrorResponse };
