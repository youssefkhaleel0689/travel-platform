import { Types } from 'mongoose';
import { UsersService } from '../auth/users/users.service';
import { AuditAction, AuditEntityType } from './audit-action.enum';
import { AuditService } from './audit.service';
import { AuditLogSchema } from './schemas/audit-log.schema';

const ADMIN = '6720f1c2a1b2c3d4e5f60701';
const POST = '6720f1c2a1b2c3d4e5f60718';

describe('AuditService (GEN-07)', () => {
  let model: { create: jest.Mock };
  let service: AuditService;

  beforeEach(() => {
    model = { create: jest.fn().mockResolvedValue({}) };
    service = new AuditService(
      model as never,
      { findBriefsByIds: jest.fn() } as unknown as UsersService,
    );
  });

  it('appends one row with ObjectId references', async () => {
    await service.record({
      actorId: ADMIN,
      action: AuditAction.CONTENT_HIDDEN,
      entityType: AuditEntityType.POST,
      entityId: POST,
      before: { moderationState: 'VISIBLE' },
      after: { moderationState: 'HIDDEN' },
    });

    const row = model.create.mock.calls[0][0];
    expect(row.actorId).toBeInstanceOf(Types.ObjectId);
    expect(row.entityId.toHexString()).toBe(POST);
    expect(row.before).toEqual({ moderationState: 'VISIBLE' });
  });

  it('never throws: the admin action has already happened', async () => {
    model.create.mockRejectedValue(new Error('Atlas is down'));
    await expect(
      service.record({
        actorId: ADMIN,
        action: AuditAction.REPORT_DISMISSED,
        entityType: AuditEntityType.REPORT,
        entityId: POST,
      }),
    ).resolves.toBeUndefined();
  });

  it('blocks every update and delete on the model (append-only)', () => {
    // Mongoose keeps the registered middleware on the schema; every write
    // other than an insert must have a hook that throws.
    const hooked = new Set(
      (
        AuditLogSchema as unknown as {
          s: { hooks: { _pres: Map<string, unknown[]> } };
        }
      ).s.hooks._pres.keys(),
    );
    for (const op of [
      'updateOne',
      'updateMany',
      'findOneAndUpdate',
      'replaceOne',
      'deleteOne',
      'deleteMany',
      'findOneAndDelete',
    ]) {
      expect(hooked).toContain(op);
    }
  });
});
