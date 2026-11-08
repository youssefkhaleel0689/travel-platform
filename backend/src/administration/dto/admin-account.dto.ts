import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Types } from 'mongoose';
import { Role } from '../../auth/enums/role.enum';
import { UserStatus } from '../../auth/enums/user-status.enum';
import { User } from '../../auth/schemas/user.schema';

/**
 * The fields this DTO reads. Both a hydrated document and the lean object that
 * paginateQuery returns satisfy it, so one mapping serves the list and the
 * single-account responses.
 */
export type AdminAccountSource = Pick<
  User,
  | 'name'
  | 'email'
  | 'role'
  | 'status'
  | 'createdAt'
  | 'mustChangePassword'
  | 'suspendedAt'
  | 'deactivatedAt'
> & { _id: Types.ObjectId };

// ACC-14: the row an admin sees. The fields are exactly the ones the
// requirement lists, plus the pending-password flag so an admin can see that a
// reset has not been used yet. No credential or lockout field is copied.
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

  static from(user: AdminAccountSource): AdminAccountDto {
    const dto = new AdminAccountDto();
    dto.id = user._id.toString();
    dto.name = user.name;
    dto.email = user.email;
    dto.role = user.role;
    dto.status = user.status;
    dto.createdAt = user.createdAt.toISOString();
    dto.mustChangePassword = user.mustChangePassword;
    dto.suspendedAt = user.suspendedAt ? user.suspendedAt.toISOString() : null;
    dto.deactivatedAt = user.deactivatedAt
      ? user.deactivatedAt.toISOString()
      : null;
    return dto;
  }
}
