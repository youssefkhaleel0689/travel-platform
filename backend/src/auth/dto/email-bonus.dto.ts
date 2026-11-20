import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches } from 'class-validator';
import { IsValidPassword } from '../../common/validation/password';

const TOKEN = /^[a-f0-9]{64}$/i;

export class ForgotPasswordDto {
  @ApiProperty({ example: 'traveller@example.com' })
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: '<the 64-hex token from the email link>' })
  @IsString()
  @Matches(TOKEN, { message: 'token must be a 64-character hex string' })
  token!: string;

  @ApiProperty({ example: 'NewPass123' })
  @IsValidPassword()
  newPassword!: string;
}

export class VerifyEmailQueryDto {
  @ApiProperty({ example: '<the 64-hex token from the email link>' })
  @IsString()
  @Matches(TOKEN, { message: 'token must be a 64-character hex string' })
  token!: string;
}
