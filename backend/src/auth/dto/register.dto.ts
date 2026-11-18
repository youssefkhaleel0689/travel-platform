import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsValidPassword } from '../../common/validation/password';
import { trimLower, trimText } from '../../common/validation/text-transforms';

// Body of POST /auth/register (ACC-01). There is no role field: unknown fields are rejected
// by the global ValidationPipe, and the role is always USER.
export class RegisterDto {
  @ApiProperty({ example: 'Sara Ahmed', maxLength: 100 })
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    example: 'sara@example.com',
    maxLength: 254,
    description: 'Stored trimmed and lower-cased. Must not be registered yet.',
  })
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email: string;

  // No transform: the password is used exactly as sent.
  @ApiProperty({
    example: 'Travel2026',
    format: 'password',
    description:
      'At least 8 characters, with at least one letter and one digit, and at most 72 bytes in UTF-8. Used exactly as sent (not trimmed).',
  })
  @IsValidPassword()
  password: string;

  @ApiProperty({
    example: true,
    type: Boolean,
    description:
      'Consent to the terms and privacy policy (ACC-01). Must be the boolean true.',
  })
  @Equals(true, { message: 'acceptTerms must be true to register' })
  acceptTerms: boolean;
}
