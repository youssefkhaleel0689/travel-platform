import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { configureApp } from './app.setup';
import { AppModule } from './app.module';
import { buildSwaggerDocument } from './swagger.setup';

async function bootstrap() {
  // rawBody: PAY-01 verifies the Stripe webhook signature against the exact
  // bytes Stripe signed. Parsing and re-serialising the JSON changes them, so
  // the untouched buffer has to be kept. e2e tests that drive the webhook
  // create the app the same way.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  configureApp(app);

  SwaggerModule.setup('api/docs', app, buildSwaggerDocument(app));

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
