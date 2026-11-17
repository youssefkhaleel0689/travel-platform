import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { configureApp } from './app.setup';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: PAY-01 verifies the Stripe webhook signature against the exact
  // bytes Stripe signed. Parsing and re-serialising the JSON changes them, so
  // the untouched buffer has to be kept. e2e tests that drive the webhook
  // create the app the same way.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  configureApp(app);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Travel Platform API')
    .setDescription(
      'REST API for the Travel Planning & Booking Platform. Auth uses an httpOnly cookie.',
    )
    .setVersion('1.0')
    .addCookieAuth('access_token')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
