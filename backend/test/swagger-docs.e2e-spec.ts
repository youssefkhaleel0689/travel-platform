// Checks the generated Swagger document of the whole app (GEN-02, Milestone 1 is graded in
// Swagger UI). This guards the whole team: documenting an error with
// `type: ErrorResponseDto` and no example fails this test. Use ApiErrorResponse from
// src/common/swagger/ instead.
import { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  getSchemaPath,
  MediaTypeObject,
  OpenAPIObject,
  OperationObject,
  PathItemObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { Test, TestingModule } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { ErrorResponseDto } from './../src/common/dto/error-response.dto';

// Connecting to Atlas can take longer than Jest's default 5 seconds.
const CONNECT_TIMEOUT_MS = 30_000;

const METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

interface ErrorResponseEntry {
  where: string;
  status: number;
  media: MediaTypeObject;
}

// Every documented response whose schema is ErrorResponseDto, in every operation.
function errorResponses(document: OpenAPIObject): ErrorResponseEntry[] {
  const ref = getSchemaPath(ErrorResponseDto);
  const entries: ErrorResponseEntry[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of METHODS) {
      const operation: OperationObject | undefined = (item as PathItemObject)[
        method
      ];
      for (const [status, response] of Object.entries(
        operation?.responses ?? {},
      )) {
        if (!response || '$ref' in response) {
          continue;
        }
        const media = response.content?.['application/json'];
        if (
          media?.schema &&
          '$ref' in media.schema &&
          media.schema.$ref === ref
        ) {
          entries.push({
            where: `${method.toUpperCase()} ${path} ${status}`,
            status: Number(status),
            media,
          });
        }
      }
    }
  }
  return entries;
}

// The example bodies of one response: the response-level example or every named example.
function exampleBodies(media: MediaTypeObject): unknown[] {
  if (media.examples) {
    return Object.values(media.examples).map((example) =>
      'value' in example ? example.value : undefined,
    );
  }
  return media.example === undefined ? [] : [media.example];
}

function statusCodeOf(body: unknown): unknown {
  return typeof body === 'object' && body !== null && 'statusCode' in body
    ? body.statusCode
    : undefined;
}

describe('Swagger document (e2e)', () => {
  let app: INestApplication<App>;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    // Same configuration as main.ts.
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Travel Platform API')
      .setDescription(
        'REST API for the Travel Planning & Booking Platform. Auth uses an httpOnly cookie.',
      )
      .setVersion('1.0')
      .addCookieAuth('access_token')
      .build();
    document = SwaggerModule.createDocument(app, swaggerConfig);
  }, CONNECT_TIMEOUT_MS);

  // Also closes the MongoDB connection.
  afterAll(async () => {
    await app.close();
  });

  it('finds documented error responses', () => {
    expect(errorResponses(document).length).toBeGreaterThan(0);
  });

  it('gives every error response its own example with the matching statusCode', () => {
    const problems: string[] = [];
    for (const { where, status, media } of errorResponses(document)) {
      const bodies = exampleBodies(media);
      if (bodies.length === 0) {
        problems.push(`${where}: no example (use ApiErrorResponse)`);
      }
      for (const body of bodies) {
        if (statusCodeOf(body) !== status) {
          problems.push(
            `${where}: example statusCode is ${String(statusCodeOf(body))}`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
