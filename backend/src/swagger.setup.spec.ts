import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { buildSwaggerDocument } from './swagger.setup';

// A tiny app with one route, so no database or AppModule is needed.
@Controller('probe')
class ProbeController {
  @Get()
  get(this: void): string {
    return 'ok';
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('buildSwaggerDocument', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProbeModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets the title, description and version shown in Swagger UI', () => {
    const { info } = buildSwaggerDocument(app);
    expect(info).toMatchObject({
      title: 'Travel Platform API',
      description:
        'REST API for the Travel Planning & Booking Platform. Auth uses an httpOnly cookie.',
      version: '1.0',
    });
  });

  // addCookieAuth('access_token') sets the cookie name; the scheme itself is registered
  // under @nestjs/swagger's default security name, 'cookie'.
  it('declares the access_token cookie security scheme (under the name "cookie")', () => {
    const document = buildSwaggerDocument(app);
    expect(document.components?.securitySchemes).toEqual({
      cookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'access_token',
      },
    });
  });

  it('documents the routes under the global prefix', () => {
    expect(Object.keys(buildSwaggerDocument(app).paths)).toEqual([
      '/api/probe',
    ]);
  });
});
