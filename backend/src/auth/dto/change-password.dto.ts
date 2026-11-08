import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_RULE_MESSAGE,
} from '../auth.constants';

// ACC-08: the current password proves it is really the account owner, the new
// one must satisfy the same rules as at registration (ACC-01).
export class ChangePasswordDto {
  @ApiProperty({ example: 'OldPass123', description: 'The password in use now' })
  @IsString()
  @IsNotEmpty({ message: 'currentPassword should not be empty' })
  currentPassword: string;

  @ApiProperty({
    example: 'NewPass123',
    minLength: PASSWORD_MIN_LENGTH,
    description: PASSWORD_RULE_MESSAGE,
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_RULE_MESSAGE })
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE })
  newPassword: string;
}
