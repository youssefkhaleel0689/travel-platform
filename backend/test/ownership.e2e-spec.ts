// ACC-11 ownership helper against the real database: findOwnedOrThrow returns a user's own
// document and gives the same 404 for someone else's, a missing and a malformed id. The
// test uses only a temporary collection, e2e_ownership_probe, through the app's own
// connection, and drops it in afterAll; no other collection is touched.
import { HttpException, INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Connection, Model, Schema, Types } from 'mongoose';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { Role } from './../src/common/auth/auth.enums';
import type { AuthenticatedUser } from './../src/common/auth/authenticated-user';
import { findOwnedOrThrow } from './../src/common/auth/ownership';

// Connecting to Atlas can take longer than Jest's default 5 seconds.
const CONNECT_TIMEOUT_MS = 30_000;

const COLLECTION = 'e2e_ownership_probe';
const MODEL_NAME = 'E2eOwnershipProbe';

interface Probe {
  userId: Types.ObjectId;
  name: string;
}

// Test-only schema, never registered in the app's modules.
const ProbeSchema = new Schema<Probe>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
  },
  { collection: COLLECTION, versionKey: false },
);

const OPTIONS = {
  notFoundCode: 'PROBE_NOT_FOUND',
  notFoundMessage: 'Probe not found',
};

function userWithId(userId: string): AuthenticatedUser {
  return {
    userId,
    role: Role.USER,
    sessionId: new Types.ObjectId().toString(),
  };
}

// The status and body of the HttpException a call rejects with.
async function failure(
  promise: Promise<unknown>,
): Promise<{ status: number; body: unknown }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), body: error.getResponse() };
    }
    throw error;
  }
  throw new Error('expected the call to fail');
}

describe('findOwnedOrThrow (e2e, ACC-11)', () => {
  let app: INestApplication;
  let connection: Connection;
  let probeModel: Model<Probe>;

  const userA = userWithId(new Types.ObjectId().toString());
  const userB = userWithId(new Types.ObjectId().toString());
  let docId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    connection = app.get<Connection>(getConnectionToken());
    probeModel = connection.model<Probe>(MODEL_NAME, ProbeSchema);
    const created = await probeModel.create({
      userId: new Types.ObjectId(userA.userId),
      name: 'Owned by A',
    });
    docId = created._id.toString();
  }, CONNECT_TIMEOUT_MS);

  // Drops only the probe collection, then closes the MongoDB connection.
  afterAll(async () => {
    await probeModel.collection.drop();
    connection.deleteModel(MODEL_NAME);
    await app.close();
  }, CONNECT_TIMEOUT_MS);

  it('returns the document to its owner', async () => {
    const doc = await findOwnedOrThrow(probeModel, docId, userA, OPTIONS);
    expect(doc.name).toBe('Owned by A');
    expect(doc.userId.toString()).toBe(userA.userId);
  });

  it("gives another user 404 with the given code, not the owner's document", async () => {
    const { status, body } = await failure(
      findOwnedOrThrow(probeModel, docId, userB, OPTIONS),
    );
    expect(status).toBe(404);
    expect(body).toEqual({
      code: 'PROBE_NOT_FOUND',
      message: 'Probe not found',
    });
  });

  it('gives a missing id the identical 404 body as a document owned by someone else', async () => {
    const notYours = await failure(
      findOwnedOrThrow(probeModel, docId, userB, OPTIONS),
    );
    const missing = await failure(
      findOwnedOrThrow(
        probeModel,
        new Types.ObjectId().toString(),
        userA,
        OPTIONS,
      ),
    );
    expect(missing.status).toBe(notYours.status);
    expect(missing.body).toEqual(notYours.body);
  });

  it('gives a malformed id the same 404, without a database error', async () => {
    const { status, body } = await failure(
      findOwnedOrThrow(probeModel, 'not-an-id', userA, OPTIONS),
    );
    expect(status).toBe(404);
    expect(body).toEqual({
      code: 'PROBE_NOT_FOUND',
      message: 'Probe not found',
    });
  });
});
