import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { User } from '../../auth/schemas/user.schema';
import {
  NOTIFICATION_RESOURCE_TYPES,
  NOTIFICATION_TYPES,
  NotificationResourceType,
  NotificationType,
} from '../notification-type.enum';

export type NotificationDocument = HydratedDocument<Notification>;

// One in-app notification for one account (GEN-01). Rows are only ever created
// and marked as read: nothing edits the title or the message afterwards, so
// what the account saw stays what it saw.
@Schema({ collection: 'notifications', timestamps: true })
export class Notification {
  // SchemaTypes.ObjectId, not Types.ObjectId. Through Nest's @Prop the second
  // one compiles to a Mixed path, which casts nothing: a string id stays a
  // string on write and a string query never matches an ObjectId row. This
  // collection is right either way, because the service wraps every id in
  // new Types.ObjectId(), but a Mixed path would silently break anything that
  // passes the plain string from the token - ownerFilter and findOwnedOrThrow
  // (ACC-11) do exactly that.
  @Prop({ type: SchemaTypes.ObjectId, ref: User.name, required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: NOTIFICATION_TYPES })
  type: NotificationType;

  @Prop({ type: String, required: true, trim: true, maxlength: 120 })
  title: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 500 })
  message: string;

  // What the notification is about, so the frontend can link to it. Both are
  // null for an account-level notice that points at nothing in particular.
  @Prop({ type: String, default: null, enum: NOTIFICATION_RESOURCE_TYPES })
  resourceType: NotificationResourceType | null;

  // A string, not an ObjectId: some resources are reference data with string
  // ids (an airport, a city), so one field has to hold both kinds.
  @Prop({ type: String, default: null })
  resourceId: string | null;

  /** null while unread. The timestamp doubles as the read flag. */
  @Prop({ type: Date, default: null })
  readAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// The list endpoint reads one account's notifications newest first.
NotificationSchema.index({ userId: 1, createdAt: -1 });
// The unread count and the unread-only list filter on readAt as well.
NotificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
