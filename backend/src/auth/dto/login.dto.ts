import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { trimLower } from '../../common/validation/text-transforms';

// Body of POST /auth/login (ACC-04).
export class LoginDto {
  @ApiProperty({
    example: 'sara@example.com',
    maxLength: 254,
    description: 'Trimmed and lower-cased, like at registration.',
  })
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email: string;

  // Not the password rules (@IsValidPassword): login must not reveal or enforce them, and
  // old passwords must keep working if the rules change. No transform: used exactly as sent.
  @ApiProperty({ example: 'Travel2026', format: 'password' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
