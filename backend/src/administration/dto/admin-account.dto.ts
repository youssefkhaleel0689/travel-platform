import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role, UserStatus } from '../../common/auth/auth.enums';
import type { UserProfile } from '../../auth/users/users.service';

/**
 * ACC-14: the row an admin sees.
 *
 * It maps from UserProfile, the one shape UsersService hands out, so a field
 * added there can never reach a client unless it is listed here. The fields are
 * exactly the ones the requirement names, plus the two status dates and the
 * pending-password flag an admin needs to see.
 */
export class AdminAccountDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ example: 'Taher Khalaf' })
  name: string;

  @ApiProperty({ example: 'taher@example.com' })
  email: string;

  @ApiProperty({ enum: Role, example: Role.USER })
  role: Role;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;

  @ApiProperty({
    example: '2026-11-03T10:00:00.000Z',
    description: 'Registration date',
  })
  createdAt: string;

  @ApiProperty({
    example: false,
    description: 'true while the account still owes a password change (ACC-07a)',
  })
  mustChangePassword: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example: null,
    description: 'When an admin suspended the account (ACC-16)',
  })
  suspendedAt: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: null,
    description: 'When the owner deactivated the account (ACC-12)',
  })
  deactivatedAt: string | null;

  static from(profile: UserProfile): AdminAccountDto {
    const dto = new AdminAccountDto();
    dto.id = profile.id;
    dto.name = profile.name;
    dto.email = profile.email;
    dto.role = profile.role;
    dto.status = profile.status;
    dto.createdAt = profile.createdAt.toISOString();
    dto.mustChangePassword = profile.mustChangePassword;
    dto.suspendedAt = profile.suspendedAt?.toISOString() ?? null;
    dto.deactivatedAt = profile.deactivatedAt?.toISOString() ?? null;
    return dto;
  }
}
