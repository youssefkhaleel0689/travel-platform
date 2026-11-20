import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/**
 * The OpenAPI document of the whole app, built from the Swagger decorators. The single
 * source for Swagger UI (main.ts, /api/docs), the exported docs/api/openapi.yaml
 * (`npm run openapi`) and the swagger-docs e2e test, so all three always agree.
 *
 * Call it after configureApp(app): the /api prefix must already be set.
 */
export function buildSwaggerDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Travel Platform API')
    .setDescription(
      'REST API for the Travel Planning & Booking Platform. Auth uses an httpOnly cookie.',
    )
    .setVersion('1.0')
    // addCookieAuth's third argument is the scheme's key; the first is only the cookie
    // name. The first call registers the access_token cookie under the default key
    // 'cookie' (what @ApiCookieAuth() refers to); the second registers the same cookie
    // under 'access_token' (what @ApiCookieAuth('access_token') refers to). Both keys are
    // used by endpoints, so both must exist or the spec has dangling references.
    .addCookieAuth('access_token')
    .addCookieAuth(
      'access_token',
      { type: 'apiKey', in: 'cookie' },
      'access_token',
    )
    .build();
  return SwaggerModule.createDocument(app, config);
}
