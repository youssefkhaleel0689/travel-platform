// Checks the generated Swagger document of the whole app (GEN-02, Milestone 1 is graded in
// Swagger UI). This guards the whole team: documenting an error with
// `type: ErrorResponseDto` and no example fails this test. Use ApiErrorResponse from
// src/common/swagger/ instead.
import { INestApplication } from '@nestjs/common';
import {
  getSchemaPath,
  MediaTypeObject,
  OpenAPIObject,
  OperationObject,
  PathItemObject,
} from '@nestjs/swagger';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { buildSwaggerDocument } from './../src/swagger.setup';
import { ErrorResponseDto } from './../src/common/dto/error-response.dto';

// Connecting to Atlas can take longer than Jest's default 5 seconds.
// Registering and logging accounts in over HTTP happens in beforeAll now, on
// top of connecting to Atlas and building indexes, so this is generous.
const CONNECT_TIMEOUT_MS = 120_000;

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

// Every security scheme key used by an operation, or by the whole document (top-level
// security), as "<where>: <key>" pairs.
function securityReferences(
  document: OpenAPIObject,
): { where: string; key: string }[] {
  const references: { where: string; key: string }[] = [];
  for (const requirement of document.security ?? []) {
    for (const key of Object.keys(requirement)) {
      references.push({ where: 'top-level security', key });
    }
  }
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of METHODS) {
      const operation: OperationObject | undefined = (item as PathItemObject)[
        method
      ];
      for (const requirement of operation?.security ?? []) {
        for (const key of Object.keys(requirement)) {
          references.push({ where: `${method.toUpperCase()} ${path}`, key });
        }
      }
    }
  }
  return references;
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

    // Compiling each Mongoose model starts Model.init() in the background (create the
    // collection, then build its indexes), which opens pooled connections to Atlas. This
    // suite never queries the database, so without waiting it would close the app while
    // those connections are still authenticating, and the driver would load code after
    // Jest has torn the environment down. init() returns the same in-flight promise.
    const connection = app.get<Connection>(getConnectionToken());
    await Promise.all(
      Object.values(connection.models).map((model) => model.init()),
    );

    // The same document main.ts serves at /api/docs and npm run openapi exports.
    document = buildSwaggerDocument(app);
  }, CONNECT_TIMEOUT_MS);

  // Also closes the MongoDB connection. Awaited, with the same timeout as the connect, so
  // the suite ends only after the connection is fully closed.
  afterAll(async () => {
    await app.close();
  }, CONNECT_TIMEOUT_MS);

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

  it('defines every security scheme an operation refers to', () => {
    const defined = Object.keys(document.components?.securitySchemes ?? {});
    const references = securityReferences(document);
    expect(references.length).toBeGreaterThan(0);

    const problems = references
      .filter(({ key }) => !defined.includes(key))
      .map(
        ({ where, key }) =>
          `${where}: security scheme '${key}' is not defined (see buildSwaggerDocument)`,
      );
    expect(problems).toEqual([]);
  });
});
