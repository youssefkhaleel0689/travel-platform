import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { validationExceptionFactory } from './common/validation/validation-exception.factory';

// Shared by main.ts and the e2e tests, so tests run against the real configuration.
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');

  // ACC-19: the access and refresh tokens arrive as httpOnly cookies, so the
  // guards need the cookies parsed before any route runs.
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
