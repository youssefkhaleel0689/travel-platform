import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  AuditAction,
  AuditEntityType,
} from '../audit-action.enum';

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema({
  collection: 'auditLogs',
  versionKey: false,
  timestamps: { createdAt: true, updatedAt: false },
})
export class AuditLog {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  actorId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: AUDIT_ACTIONS })
  action: AuditAction;

  @Prop({ type: String, required: true, enum: AUDIT_ENTITY_TYPES })
  entityType: AuditEntityType;

  @Prop({ type: SchemaTypes.ObjectId, required: true })
  entityId: Types.ObjectId;

  @Prop({ type: SchemaTypes.Mixed, default: null })
  before: Record<string, unknown> | null;

  @Prop({ type: SchemaTypes.Mixed, default: null })
  after: Record<string, unknown> | null;

  createdAt: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

function appendOnly(): never {
  throw new Error(
    'auditLogs is append-only: rows cannot be changed or removed',
  );
}

// GEN-07: rows can be added and read, never changed or removed.
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
AuditLogSchema.pre('save', function () {
  if (!this.isNew) {
    appendOnly();
  }
});

AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
AuditLogSchema.index({ actorId: 1, createdAt: -1 });
