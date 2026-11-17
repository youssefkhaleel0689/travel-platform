import { ApiProperty } from '@nestjs/swagger';
import { Role, UserStatus } from '../../common/auth/auth.enums';
import type { UserProfile } from '../users/users.service';

// Response shape of a user (ACC-01). Never contains passwordHash or the lockout fields.
export class UserResponseDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ example: 'Sara Ahmed' })
  name: string;

  @ApiProperty({ example: 'sara@example.com' })
  email: string;

  @ApiProperty({ example: null, nullable: true, type: String })
  phone: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'Currency code from the currencies reference data.',
  })
  preferredCurrency: string | null;

  @ApiProperty({ enum: Role, example: Role.USER })
  role: Role;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;

  @ApiProperty({ example: false })
  mustChangePassword: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-12T10:00:00.000Z',
    description: 'Registration date (ACC-14).',
  })
  createdAt: Date;

  // Explicit mapping so a field added to UserProfile never leaks by accident.
  static from(profile: UserProfile): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = profile.id;
    dto.name = profile.name;
    dto.email = profile.email;
    dto.phone = profile.phone;
    dto.preferredCurrency = profile.preferredCurrency;
    dto.role = profile.role;
    dto.status = profile.status;
    dto.mustChangePassword = profile.mustChangePassword;
    dto.createdAt = profile.createdAt;
    return dto;
  }
}
