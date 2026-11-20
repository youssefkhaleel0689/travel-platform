import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

/** ACC-15: the two kinds of provider an admin can deactivate, as they appear in the path. */
export enum ProviderType {
  HOTEL = 'hotel',
  AIRLINE = 'airline',
}

export const PROVIDER_TYPES = Object.values(ProviderType);

/** Both providers use the same two values (HotelStatus and AirlineStatus). */
export enum ProviderStatus {
  ACTIVE = 'ACTIVE',
  DEACTIVATED = 'DEACTIVATED',
}

/**
 * Path of PATCH /api/admin/providers/:type/:id/... . `type` is checked here, so an
 * unknown one is a field-level 400. `id` is only a string: a malformed id answers the
 * same 404 as a missing provider (ACC-11), which the service decides.
 */
export class AdminProviderParamsDto {
  @ApiProperty({ enum: ProviderType, example: ProviderType.HOTEL })
  @IsIn(PROVIDER_TYPES, { message: 'type must be hotel or airline' })
  type: ProviderType;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60788' })
  @IsString()
  id: string;
}

/** ACC-15: the provider after the change, and how many accounts were told about it. */
export class AdminProviderStatusDto {
  @ApiProperty({ enum: ProviderType, example: ProviderType.HOTEL })
  type: ProviderType;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60788' })
  id: string;

  @ApiProperty({ example: 'Nile View Hotel' })
  name: string;

  @ApiProperty({ enum: ProviderStatus, example: ProviderStatus.DEACTIVATED })
  status: ProviderStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-11-19T10:00:00.000Z',
    description: 'When it was deactivated; null while it is active',
  })
  deactivatedAt: string | null;

  @ApiProperty({
    example: 3,
    description:
      "Accounts sent an in-app notification: the provider's moderators and the " +
      'users with an upcoming CONFIRMED booking with it. 0 if notifying failed; ' +
      'the status change stands either way.',
  })
  notifiedUsers: number;
}
