import { ApiProperty } from '@nestjs/swagger';
import { PAGE_SIZE } from '../pagination.constants';

export class PageMetaDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: PAGE_SIZE })
  pageSize: number;

  @ApiProperty({ example: 42 })
  totalItems: number;

  @ApiProperty({ example: 5, description: '0 when there are no items' })
  totalPages: number;

  @ApiProperty({ example: true })
  hasNextPage: boolean;

  @ApiProperty({ example: false })
  hasPreviousPage: boolean;

  static create(page: number, totalItems: number): PageMetaDto {
    const meta = new PageMetaDto();
    const totalPages = Math.ceil(totalItems / PAGE_SIZE);
    meta.page = page;
    meta.pageSize = PAGE_SIZE;
    meta.totalItems = totalItems;
    meta.totalPages = totalPages;
    meta.hasNextPage = page < totalPages;
    meta.hasPreviousPage = page > 1;
    return meta;
  }
}

// The single response shape returned by every paginated endpoint.
export class PageDto<T> {
  // No @ApiProperty here: Swagger cannot describe generics, so a decorator
  // will document the item type per endpoint in a later step.
  items: T[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;

  constructor(items: T[], meta: PageMetaDto) {
    this.items = items;
    this.meta = meta;
  }
}
