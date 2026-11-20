import { NotFoundException } from '@nestjs/common';
import { model, Query, Types } from 'mongoose';
import { Role } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { findOwnedOrThrow, ownerFilter } from '../../common/auth/ownership';
import { Session, SessionSchema } from './session.schema';

// ACC-11 on a real app schema, without a database: the owner id comes from the token as a
// string, and ownerFilter / findOwnedOrThrow rely on the schema to cast it. On a Mixed
// path (what `type: Types.ObjectId` compiles to through @Prop) it would stay a string and
// never match an ObjectId row. Query#cast() runs the same casting Mongoose runs before
// sending a query, so these tests fail on a Mixed userId.
// Typed as Model<Session>, the type findOwnedOrThrow takes; inferring it from the
// schema would add the `id` virtual to the type and not match.
const SessionModel = model<Session>(
  `${Session.name}OwnershipProbe`,
  SessionSchema,
);

const OWNER_ID = new Types.ObjectId();
const SESSION_ID = new Types.ObjectId();
const USER: AuthenticatedUser = {
  userId: OWNER_ID.toString(),
  role: Role.USER,
  sessionId: new Types.ObjectId().toString(),
};

// The filter of a query after Mongoose's casting.
function castFilter(query: Query<unknown, unknown>): Record<string, unknown> {
  query.cast();
  return query.getFilter();
}

describe('ownership helpers on the real Session schema (ACC-11)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('ownerFilter: the string user id from the token is cast to an ObjectId', () => {
    const query = SessionModel.findOne({
      _id: SESSION_ID.toString(),
      ...ownerFilter(USER),
    });
    const filter = castFilter(query);

    expect(filter.userId).toBeInstanceOf(Types.ObjectId);
    expect(OWNER_ID.equals(filter.userId as Types.ObjectId)).toBe(true);
    expect(filter._id).toBeInstanceOf(Types.ObjectId);
  });

  it('findOwnedOrThrow: the query it sends carries the owner as an ObjectId', async () => {
    const sent: Query<unknown, unknown>[] = [];
    jest.spyOn(Query.prototype, 'exec').mockImplementation(function (
      this: Query<unknown, unknown>,
    ) {
      sent.push(this);
      return Promise.resolve(null);
    });

    await expect(
      findOwnedOrThrow(SessionModel, SESSION_ID.toString(), USER, {
        notFoundCode: 'SESSION_NOT_FOUND',
        notFoundMessage: 'Session not found',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(sent).toHaveLength(1);
    const filter = castFilter(sent[0]);
    expect(filter.userId).toBeInstanceOf(Types.ObjectId);
    expect(OWNER_ID.equals(filter.userId as Types.ObjectId)).toBe(true);
    expect(filter._id).toBeInstanceOf(Types.ObjectId);
  });
});
