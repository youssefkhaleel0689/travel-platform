import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeanDoc } from '../../common/pagination/paginate';
import {
  NotificationResourceType,
  NotificationType,
} from '../notification-type.enum';
import { Notification } from '../schemas/notification.schema';

// paginateQuery returns lean objects with _id and __v, so the mapping to this
// DTO is what keeps those out of the response.
export class NotificationDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ enum: NotificationType, example: NotificationType.BOOKING_CONFIRMED })
  type: NotificationType;

  @ApiProperty({ example: 'Booking confirmed' })
  title: string;

  @ApiProperty({
    example: 'Your hotel reservation NILE-4821 is confirmed.',
  })
  message: string;

  @ApiPropertyOptional({
    enum: NotificationResourceType,
    nullable: true,
    example: NotificationResourceType.HOTEL_BOOKING,
  })
  resourceType: NotificationResourceType | null;

  @ApiPropertyOptional({
    nullable: true,
    example: '6720f1c2a1b2c3d4e5f60720',
    description: 'Id of the resource the notification is about',
  })
  resourceId: string | null;

  @ApiProperty({ example: false })
  read: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example: '2026-11-09T12:30:00.000Z',
    description: 'When the account first read it; null while unread',
  })
  readAt: string | null;

  @ApiProperty({ example: '2026-11-09T12:00:00.000Z' })
  createdAt: string;

  static fromLean(doc: LeanDoc<Notification>): NotificationDto {
    const dto = new NotificationDto();
    dto.id = doc._id.toString();
    dto.type = doc.type;
    dto.title = doc.title;
    dto.message = doc.message;
    dto.resourceType = doc.resourceType ?? null;
    dto.resourceId = doc.resourceId ?? null;
    dto.read = doc.readAt !== null && doc.readAt !== undefined;
    dto.readAt = doc.readAt ? doc.readAt.toISOString() : null;
    dto.createdAt = doc.createdAt.toISOString();
    return dto;
  }
}
