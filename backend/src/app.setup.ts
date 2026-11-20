import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { validationExceptionFactory } from './common/validation/validation-exception.factory';

/**
 * Where the frontend runs in development: Next.js on port 3001, beside the API
 * on 3000. Another origin (a deployed frontend) goes in CORS_ORIGINS.
 */
export const DEFAULT_CORS_ORIGINS: readonly string[] = [
  'http://localhost:3001',
];

/**
 * The browser origins allowed to call the API with the login cookies: the
 * comma-separated CORS_ORIGINS, or DEFAULT_CORS_ORIGINS when it is not set.
 * A list, never "*": a browser refuses credentials for a wildcard origin, and
 * any site could otherwise read the answers to requests made with the user's
 * cookies.
 */
export function corsOrigins(raw = process.env.CORS_ORIGINS): string[] {
  const listed = (raw ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin !== '');
  return listed.length > 0 ? listed : [...DEFAULT_CORS_ORIGINS];
}

// Shared by main.ts and the e2e tests, so tests run against the real configuration.
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');

  // Express adds "X-Powered-By: Express" to every response, which only tells
  // an attacker what to look up. The adapter is Express (platform-express).
  const http = app.getHttpAdapter().getInstance() as {
    disable?: (setting: string) => void;
  };
  http.disable?.('x-powered-by');

  // The Next.js frontend runs on its own origin and logs in with httpOnly
  // cookies (ACC-19), so it calls the API with fetch(..., { credentials:
  // 'include' }). credentials: true lets the browser send and receive those
  // cookies; origin limits that to the frontend. Stripe's webhook and Swagger
  // UI are not affected: CORS only applies to browser requests from another
  // origin.
  app.enableCors({
    origin: corsOrigins(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type'],
  });

  // The guard reads the access token from request.cookies (ACC-19).
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
}
