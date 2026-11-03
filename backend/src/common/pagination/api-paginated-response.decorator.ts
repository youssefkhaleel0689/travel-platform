import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { PageDto } from './dto/page.dto';

// Swagger cannot read the generic type of PageDto<T> at runtime, so the item
// class is passed in explicitly and merged into the PageDto schema.
// Usage:
//   @Get()
//   @ApiPaginatedResponse(AccountDto)
//   list(@Query() query: PaginationQueryDto) { ... }
export const ApiPaginatedResponse = <TModel extends Type<unknown>>(
  model: TModel,
) =>
  applyDecorators(
    ApiExtraModels(PageDto, model),
    ApiOkResponse({
      description: 'A page of results (page size 10).',
      schema: {
        allOf: [
          { $ref: getSchemaPath(PageDto) },
          {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: { $ref: getSchemaPath(model) },
              },
            },
          },
        ],
      },
    }),
  );
