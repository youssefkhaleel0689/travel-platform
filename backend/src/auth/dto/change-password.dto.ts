import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import {
  IsValidPassword,
  PASSWORD_MIN_LENGTH,
} from '../../common/validation/password';

/**
 * ACC-08. The current password proves it is really the account owner; the new
 * one goes through the same shared rules as registration (ACC-01), so the two
 * can never drift apart.
 */
export class ChangePasswordDto {
  @ApiProperty({
    example: 'OldPass123',
    description: 'The password in use now',
  })
  @IsString()
  @IsNotEmpty({ message: 'currentPassword should not be empty' })
  currentPassword: string;

  @ApiProperty({
    example: 'NewPass123',
    minLength: PASSWORD_MIN_LENGTH,
    description:
      'At least 8 characters, with at least one letter and one digit, and at ' +
      'most 72 bytes',
  })
  @IsValidPassword()
  newPassword: string;
}
