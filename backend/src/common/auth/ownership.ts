import { NotFoundException } from '@nestjs/common';
import type { Model, QueryFilter } from 'mongoose';
import type { AuthenticatedUser } from './authenticated-user';

// A route id is always 24 hex characters (same check as UsersService and SessionsService).
// Types.ObjectId.isValid is not used because it also accepts any 12-character string.
const OBJECT_ID = /^[0-9a-f]{24}$/i;

export interface FindOwnedOptions {
  /** Error code of the 404, e.g. 'ITINERARY_NOT_FOUND'. */
  notFoundCode: string;
  /** Message of the 404, e.g. 'Itinerary not found'. */
  notFoundMessage: string;
  /** The field holding the owner's user id. Default 'userId'. */
  ownerField?: string;
  /** Fields to load, as for Mongoose select(), e.g. 'name status'. Default: all. */
  select?: string;
}

/**
 * The filter condition "owned by this user" (ACC-11): `{ [ownerField]: user.userId }`.
 *
 * Ownership is always checked in the database filter, never by comparing after loading,
 * so a document owned by someone else is simply not found. Spread it into any find or
 * update filter, for example the conditional update after findOwnedOrThrow():
 *
 * ```ts
 * const result = await this.itineraryModel.updateOne(
 *   { _id: id, ...ownerFilter(user), status: 'DRAFT' },
 *   { $set: { name: dto.name } },
 * );
 * ```
 */
export function ownerFilter(
  user: AuthenticatedUser,
  ownerField = 'userId',
): Record<string, string> {
  return { [ownerField]: user.userId };
}

/**
 * Loads one document by id that belongs to `user`, as a lean object (ACC-11).
 *
 * A malformed id, a document that does not exist and a document owned by someone else all
 * give the same 404 `{ code: notFoundCode, message: notFoundMessage }`, so the response does
 * not reveal which ids exist. A malformed id is refused without querying. One query, with
 * the owner condition in the filter. There is no admin bypass: admin views are separate
 * @Roles(Role.ADMIN) endpoints. Nothing is logged.
 *
 * Reading:
 *
 * ```ts
 * const itinerary = await findOwnedOrThrow(this.itineraryModel, id, user, {
 *   notFoundCode: 'ITINERARY_NOT_FOUND',
 *   notFoundMessage: 'Itinerary not found',
 * });
 * ```
 *
 * Writing: first findOwnedOrThrow (404 when missing or not yours), then a conditional
 * update whose filter repeats ownerFilter and the status the change expects, so a
 * concurrent change cannot slip in between; no match means the state changed (409):
 *
 * ```ts
 * await findOwnedOrThrow(this.itineraryModel, id, user, {
 *   notFoundCode: 'ITINERARY_NOT_FOUND',
 *   notFoundMessage: 'Itinerary not found',
 * });
 * const result = await this.itineraryModel
 *   .updateOne(
 *     { _id: id, ...ownerFilter(user), status: 'DRAFT' },
 *     { $set: { status: 'PUBLISHED' } },
 *   )
 *   .exec();
 * if (result.matchedCount === 0) {
 *   throw new ConflictException({
 *     code: 'ITINERARY_NOT_DRAFT',
 *     message: 'Only a draft itinerary can be published',
 *   });
 * }
 * ```
 */
export async function findOwnedOrThrow<T>(
  model: Model<T>,
  id: string,
  user: AuthenticatedUser,
  options: FindOwnedOptions,
): Promise<T> {
  const notFound = () =>
    new NotFoundException({
      code: options.notFoundCode,
      message: options.notFoundMessage,
    });

  if (!OBJECT_ID.test(id)) {
    throw notFound();
  }

  const filter: QueryFilter<T> = {
    _id: id,
    ...ownerFilter(user, options.ownerField),
  };
  let query = model.findOne(filter);
  if (options.select !== undefined) {
    query = query.select(options.select);
  }
  const doc = await query.lean<T>().exec();
  if (!doc) {
    throw notFound();
  }
  return doc;
}
