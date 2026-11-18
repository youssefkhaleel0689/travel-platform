import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { jsonTransform } from '../../common/mongo';

export type RoomDocument = HydratedDocument<Room>;

@Schema({ timestamps: true, toJSON: { transform: jsonTransform, versionKey: false } })
export class Room {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Hotel', required: true })
  hotelId!: mongoose.Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  roomNumber!: string;

  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, required: true, trim: true })
  type!: string;

  @Prop({ type: Number, required: true, min: 1, validate: Number.isInteger })
  beds!: number;

  @Prop({ type: Number, required: true, min: 1, validate: Number.isInteger })
  maxOccupancy!: number;

  // Money is Decimal128; the API sends/receives decimal strings.
  @Prop({ type: mongoose.Schema.Types.Decimal128, required: true })
  pricePerNight!: mongoose.Types.Decimal128;

  @Prop({ type: Boolean, default: true, required: true })
  isActive!: boolean;

  // Concurrency token: every transaction that books/blocks this room increments it, so two
  // concurrent transactions on the same room always conflict and one is retried (see InventoryService.lockRooms).
  @Prop({ type: Number, default: 0, select: false })
  lockVersion?: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const RoomSchema = SchemaFactory.createForClass(Room);

RoomSchema.index({ hotelId: 1, roomNumber: 1 }, { unique: true });
RoomSchema.index({ hotelId: 1, name: 1 }, { unique: true });
RoomSchema.index({ hotelId: 1, isActive: 1 });
