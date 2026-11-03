import { Controller, Get, INestApplication, Query } from '@nestjs/common';
import {
  ApiProperty,
  DocumentBuilder,
  OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from './../src/app.setup';
import { ApiPaginatedResponse } from './../src/common/pagination/api-paginated-response.decorator';
import { PaginationQueryDto } from './../src/common/pagination/dto/pagination-query.dto';
import { paginateArray } from './../src/common/pagination/paginate';

// Test-only DTO and controller: they live here, not under src/, so they never
// appear in the real API or in Swagger. No AppModule, no MongoDB.
class TestItemDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Item 1' })
  name: string;
}

const ITEMS: TestItemDto[] = Array.from({ length: 25 }, (_, i) => ({
  id: i + 1,
  name: `Item ${i + 1}`,
}));

@Controller('test-items')
class PaginationTestController {
  @Get()
  @ApiPaginatedResponse(TestItemDto)
  list(@Query() query: PaginationQueryDto) {
    return paginateArray(ITEMS, query.page);
  }
}

describe('Pagination (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [PaginationTestController],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const timestamp = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/);

  describe('HTTP', () => {
    it('returns the first page when no page is given', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/test-items')
        .expect(200);

      expect(res.body.items).toHaveLength(10);
      expect(res.body.items[0]).toEqual({ id: 1, name: 'Item 1' });
      expect(res.body.meta).toEqual({
        page: 1,
        pageSize: 10,
        totalItems: 25,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: false,
      });
    });

    it('returns the last 5 items on page 3', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/test-items?page=3')
        .expect(200);

      expect(res.body.items).toHaveLength(5);
      expect(res.body.items[0]).toEqual({ id: 21, name: 'Item 21' });
      expect(res.body.meta).toEqual({
        page: 3,
        pageSize: 10,
        totalItems: 25,
        totalPages: 3,
        hasNextPage: false,
        hasPreviousPage: true,
      });
    });

    it('returns empty items beyond the last page without an error', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/test-items?page=4')
        .expect(200);

      expect(res.body).toEqual({
        items: [],
        meta: {
          page: 4,
          pageSize: 10,
          totalItems: 25,
          totalPages: 3,
          hasNextPage: false,
          hasPreviousPage: true,
        },
      });
    });

    it('rejects page=0 with the shared validation error shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/test-items?page=0')
        .expect(400);

      expect(res.body).toEqual({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        error: 'Bad Request',
        message: 'Validation failed',
        errors: [{ field: 'page', messages: ['page must not be less than 1'] }],
        path: '/api/test-items',
        timestamp,
      });
    });

    it.each(['abc', '1.5'])(
      'rejects page=%s with an error on "page"',
      async (page) => {
        const res = await request(app.getHttpServer())
          .get(`/api/test-items?page=${page}`)
          .expect(400);

        expect(res.body).toMatchObject({
          statusCode: 400,
          code: 'VALIDATION_FAILED',
          message: 'Validation failed',
          path: '/api/test-items',
        });
        expect(res.body.errors).toEqual([
          {
            field: 'page',
            messages: expect.arrayContaining([
              'page must be an integer number',
            ]),
          },
        ]);
      },
    );

    it('rejects limit because the client cannot choose the page size', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/test-items?limit=50')
        .expect(400);

      expect(res.body).toEqual({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        error: 'Bad Request',
        message: 'Validation failed',
        errors: [
          { field: 'limit', messages: ['property limit should not exist'] },
        ],
        path: '/api/test-items',
        timestamp,
      });
    });
  });

  describe('Swagger document', () => {
    let document: OpenAPIObject;

    beforeAll(() => {
      document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
    });

    // The global prefix is part of the path in the generated document.
    const getOperation = () => document.paths['/api/test-items'].get;

    it('documents a page query parameter and no limit parameter', () => {
      const names = (getOperation()?.parameters ?? []).map((p) =>
        'name' in p ? p.name : p.$ref,
      );
      expect(names).toContain('page');
      expect(names).not.toContain('limit');
    });

    it('describes the 200 response as PageDto with TestItemDto items', () => {
      const ok = getOperation()?.responses['200'];
      const schema =
        ok && 'content' in ok
          ? ok.content?.['application/json'].schema
          : undefined;

      expect(schema).toEqual({
        allOf: [
          { $ref: '#/components/schemas/PageDto' },
          {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: { $ref: '#/components/schemas/TestItemDto' },
              },
            },
          },
        ],
      });
    });

    it('registers PageDto, PageMetaDto and TestItemDto schemas', () => {
      expect(Object.keys(document.components?.schemas ?? {})).toEqual(
        expect.arrayContaining(['PageDto', 'PageMetaDto', 'TestItemDto']),
      );
    });
  });
});
