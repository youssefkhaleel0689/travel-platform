import type { Default__v, Model, QueryFilter, Require_id } from 'mongoose';
import { PageDto, PageMetaDto } from './dto/page.dto';
import { PAGE_SIZE } from './pagination.constants';

// Shape returned by .lean() for a Model<T>: plain object with _id and __v.
export type LeanDoc<T> = Default__v<Require_id<T>>;

// Runs one page of a find query with a fixed page size.
// _id is always appended as the last sort key so documents with equal sort
// values keep a stable order and never repeat or vanish between pages.
// The page and the total count are independent, so both queries run in
// parallel to save a round trip.
export async function paginateQuery<T>(
  model: Model<T>,
  filter: QueryFilter<T>,
  options: { page: number; sort?: Record<string, 1 | -1> },
): Promise<PageDto<LeanDoc<T>>> {
  const { page } = options;
  const sort: Record<string, 1 | -1> = { ...(options.sort ?? { _id: 1 }) };
  if (!('_id' in sort)) {
    sort._id = 1;
  }

  const [items, totalItems] = await Promise.all([
    model
      .find(filter)
      .sort(sort)
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean<LeanDoc<T>[]>()
      .exec(),
    model.countDocuments(filter).exec(),
  ]);

  return new PageDto(items, PageMetaDto.create(page, totalItems));
}
