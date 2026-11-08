import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../enums/role.enum';
import { UserStatus } from '../enums/user-status.enum';
import { UserDocument } from '../schemas/user.schema';

// The account as the owner sees it. Built by fromDocument, which is the only
// place a user document becomes a response, so no field can leak by accident:
// passwordHash, failed-login counters and lockout times are never copied here.
export class UserProfileDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ example: 'Taher Khalaf' })
  name: string;

  @ApiProperty({ example: 'taher@example.com' })
  email: string;

  @ApiPropertyOptional({
    example: '+201234567890',
    nullable: true,
    description: 'null when the account has not given a phone number',
  })
  phone: string | null;

  @ApiPropertyOptional({
    example: 'EGP',
    nullable: true,
    description:
      'Display currency for itinerary budgets (ACC-09, ITN-18). Booking ' +
      'prices, payments and refunds always use the platform currency (PAY-04).',
  })
  preferredCurrency: string | null;

  @ApiProperty({ enum: Role, example: Role.USER })
  role: Role;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;

  @ApiProperty({
    example: false,
    description:
      'true while the account is on a temporary password set by an admin ' +
      '(ACC-07a); only PATCH /api/auth/change-password works until it is false',
  })
  mustChangePassword: boolean;

  @ApiProperty({
    example: '2026-11-03T10:00:00.000Z',
    description: 'Registration date',
  })
  createdAt: string;

  static fromDocument(user: UserDocument): UserProfileDto {
    const dto = new UserProfileDto();
    dto.id = user._id.toString();
    dto.name = user.name;
    dto.email = user.email;
    dto.phone = user.phone ?? null;
    dto.preferredCurrency = user.preferredCurrency ?? null;
    dto.role = user.role;
    dto.status = user.status;
    dto.mustChangePassword = user.mustChangePassword;
    dto.createdAt = user.createdAt.toISOString();
    return dto;
  }
}
