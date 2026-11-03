import { PageMetaDto } from './page.dto';

describe('PageMetaDto.create', () => {
  it('returns 0 pages and no navigation when there are no items', () => {
    const meta = PageMetaDto.create(1, 0);
    expect(meta.totalPages).toBe(0);
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPreviousPage).toBe(false);
  });

  it('returns 1 page for exactly 10 items', () => {
    expect(PageMetaDto.create(1, 10).totalPages).toBe(1);
  });

  it('returns 2 pages for 11 items, page 1 has next but no previous', () => {
    const meta = PageMetaDto.create(1, 11);
    expect(meta.totalPages).toBe(2);
    expect(meta.hasNextPage).toBe(true);
    expect(meta.hasPreviousPage).toBe(false);
  });

  it('has no next page on the last page (25 items, page 3)', () => {
    const meta = PageMetaDto.create(3, 25);
    expect(meta.totalPages).toBe(3);
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPreviousPage).toBe(true);
  });

  it('has no next page but a previous page beyond the last page', () => {
    const meta = PageMetaDto.create(9, 25);
    expect(meta.page).toBe(9);
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPreviousPage).toBe(true);
  });

  it('always uses a page size of 10', () => {
    expect(PageMetaDto.create(1, 0).pageSize).toBe(10);
    expect(PageMetaDto.create(5, 1000).pageSize).toBe(10);
  });
});
