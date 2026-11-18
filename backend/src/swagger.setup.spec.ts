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

  // @ApiCookieAuth() refers to 'cookie' and @ApiCookieAuth('access_token') to
  // 'access_token': both keys must describe the same access_token cookie.
  it('declares the access_token cookie under both scheme keys, cookie and access_token', () => {
    const document = buildSwaggerDocument(app);
    const accessTokenCookie = {
      type: 'apiKey',
      in: 'cookie',
      name: 'access_token',
    };
    expect(document.components?.securitySchemes).toEqual({
      cookie: accessTokenCookie,
      access_token: accessTokenCookie,
    });
  });

  it('documents the routes under the global prefix', () => {
    expect(Object.keys(buildSwaggerDocument(app).paths)).toEqual([
      '/api/probe',
    ]);
  });
});
