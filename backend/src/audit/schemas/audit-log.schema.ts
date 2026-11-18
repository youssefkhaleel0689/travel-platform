import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  AuditAction,
  AuditEntityType,
} from '../audit-action.enum';

export type AuditLogDocument = HydratedDocument<AuditLog>;

/**
 * One admin action (GEN-07, schema section 2.2: auditLogs, owned by D2).
 *
 * Append-only: rows are inserted and read, never changed or removed. The
 * hooks below make that a property of the model rather than a promise, so
 * even a later bug elsewhere in the code cannot rewrite history through it.
 */
@Schema({
  collection: 'auditLogs',
  versionKey: false,
  timestamps: { createdAt: true, updatedAt: false },
})
export class AuditLog {
  /** The admin who acted. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  actorId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: AUDIT_ACTIONS })
  action: AuditAction;

  @Prop({ type: String, required: true, enum: AUDIT_ENTITY_TYPES })
  entityType: AuditEntityType;

  @Prop({ type: SchemaTypes.ObjectId, required: true })
  entityId: Types.ObjectId;

  /** The relevant fields before the action, e.g. { status: 'ACTIVE' }. */
  @Prop({ type: SchemaTypes.Mixed, default: null })
  before: Record<string, unknown> | null;

  /** The same fields after it, plus context such as the report it resolved. */
  @Prop({ type: SchemaTypes.Mixed, default: null })
  after: Record<string, unknown> | null;

  createdAt: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

function appendOnly(): never {
  throw new Error('auditLogs is append-only: rows cannot be changed or removed');
}

AuditLogSchema.pre(
  [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'replaceOne',
    'findOneAndReplace',
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
  ],
  appendOnly,
);
// A loaded row saved again would be an update too.
AuditLogSchema.pre('save', function () {
  if (!this.isNew) {
    appendOnly();
  }
});

// The admin list: newest first, optionally narrowed by action or by entity.
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
AuditLogSchema.index({ actorId: 1, createdAt: -1 });
