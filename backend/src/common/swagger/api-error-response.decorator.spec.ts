import { Controller, Get, INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  getSchemaPath,
  MediaTypeObject,
  OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { ErrorResponseDto } from '../dto/error-response.dto';
import {
  ApiErrorResponse,
  ERROR_EXAMPLE_TIMESTAMP,
} from './api-error-response.decorator';

const EMAIL_ERROR = [{ field: 'email', messages: ['email must be an email'] }];

// A tiny controller: no service, no database. Only the generated document is checked.
@Controller('probe')
class ProbeController {
  @Get('one')
  @ApiErrorResponse({
    status: 404,
    description: 'No such thing',
    examples: [
      {
        code: 'THING_NOT_FOUND',
        message: 'Thing not found',
        path: '/api/probe/one',
      },
    ],
  })
  one(): void {}

  @Get('two')
  @ApiErrorResponse({
    status: 400,
    description: 'Bad body',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: '/api/probe/two',
        errors: EMAIL_ERROR,
      },
      {
        code: 'EMPTY_UPDATE',
        message: 'Send something',
        path: '/api/probe/two',
      },
    ],
  })
  two(): void {}

  @Get('phrases')
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in',
    examples: [{ code: 'UNAUTHORIZED', message: 'Unauthorized', path: '/p' }],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Wrong role',
    examples: [{ code: 'FORBIDDEN', message: 'Forbidden', path: '/p' }],
  })
  @ApiErrorResponse({
    status: 409,
    description: 'Taken',
    examples: [
      { code: 'DUPLICATE_KEY', message: 'x already exists', path: '/p' },
    ],
  })
  phrases(): void {}
}

// The application/json content of one documented response.
function content(
  document: OpenAPIObject,
  path: string,
  status: number,
): MediaTypeObject {
  const response = document.paths[path]?.get?.responses[String(status)];
  if (!response || !('content' in response) || !response.content) {
    throw new Error(`no content for GET ${path} ${status}`);
  }
  return response.content['application/json'];
}

describe('ApiErrorResponse', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps the schema a reference to ErrorResponseDto and registers it', () => {
    expect(content(document, '/probe/one', 404).schema).toEqual({
      $ref: getSchemaPath(ErrorResponseDto),
    });
    expect(document.components?.schemas).toHaveProperty('ErrorResponseDto');
  });

  it('turns one example into a complete response-level example', () => {
    const media = content(document, '/probe/one', 404);
    expect(media.examples).toBeUndefined();
    expect(media.example).toEqual({
      statusCode: 404,
      code: 'THING_NOT_FOUND',
      error: 'Not Found',
      message: 'Thing not found',
      path: '/api/probe/one',
      timestamp: ERROR_EXAMPLE_TIMESTAMP,
    });
  });

  it('turns several examples into named examples keyed by code', () => {
    const media = content(document, '/probe/two', 400);
    expect(media.example).toBeUndefined();
    expect(Object.keys(media.examples ?? {})).toEqual([
      'VALIDATION_FAILED',
      'EMPTY_UPDATE',
    ]);
    expect(media.examples?.VALIDATION_FAILED).toEqual({
      summary: 'Validation failed',
      value: {
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        error: 'Bad Request',
        message: 'Validation failed',
        errors: EMAIL_ERROR,
        path: '/api/probe/two',
        timestamp: ERROR_EXAMPLE_TIMESTAMP,
      },
    });
  });

  it('adds errors only when they are given', () => {
    const media = content(document, '/probe/two', 400);
    const empty = media.examples?.EMPTY_UPDATE;
    expect(
      empty && 'value' in empty ? empty.value : undefined,
    ).not.toHaveProperty('errors');
    expect(content(document, '/probe/one', 404).example).not.toHaveProperty(
      'errors',
    );
  });

  it.each([
    ['/probe/two', 400, 'Bad Request'],
    ['/probe/phrases', 401, 'Unauthorized'],
    ['/probe/phrases', 403, 'Forbidden'],
    ['/probe/one', 404, 'Not Found'],
    ['/probe/phrases', 409, 'Conflict'],
  ])('uses the filter phrase for %s %i', (path, status, phrase) => {
    const media = content(document, path, status);
    const bodies = media.examples
      ? Object.values(media.examples).map((e) => ('value' in e ? e.value : e))
      : [media.example];
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).toMatchObject({ statusCode: status, error: phrase });
    }
  });

  it('refuses two examples with the same code', () => {
    expect(() =>
      ApiErrorResponse({
        status: 403,
        description: 'Wrong role',
        examples: [
          { code: 'FORBIDDEN', message: 'a', path: '/p' },
          { code: 'FORBIDDEN', message: 'b', path: '/p' },
        ],
      }),
    ).toThrow('FORBIDDEN is used twice');
  });
});
