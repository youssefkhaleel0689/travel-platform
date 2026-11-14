import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Role } from '../../common/auth/auth.enums';
import { IsValidPassword } from '../../common/validation/password';
import { trimLower, trimText } from '../../common/validation/text-transforms';

/** The only two roles ACC-13 creates. ADMIN is seeded (ACC-18), USER registers (ACC-01). */
export const MODERATOR_ROLES = [
  Role.AIRLINE_MODERATOR,
  Role.HOTEL_MODERATOR,
] as const;

/**
 * Body of POST /api/admin/moderators (ACC-13).
 *
 * Unlike RegisterDto there is a role field, because choosing between an
 * airline and a hotel moderator is the point of the endpoint. @IsIn keeps it to
 * the two moderator roles, so this route can never mint an ADMIN.
 */
export class CreateModeratorDto {
  @ApiProperty({ example: 'Omar Fathy', maxLength: 100 })
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    example: 'omar@airline.example.com',
    maxLength: 254,
    description: 'Stored trimmed and lower-cased. Must not be registered yet.',
  })
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({
    enum: MODERATOR_ROLES,
    example: Role.AIRLINE_MODERATOR,
    description:
      'Which kind of provider this moderator manages. It also decides what ' +
      'providerId has to be: an airline id or a hotel id.',
  })
  @IsIn(MODERATOR_ROLES, {
    message: `role must be one of: ${MODERATOR_ROLES.join(', ')}`,
  })
  role: (typeof MODERATOR_ROLES)[number];

  @ApiProperty({
    example: '6720f1c2a1b2c3d4e5f60718',
    description:
      'The one airline (role AIRLINE_MODERATOR) or hotel (role ' +
      'HOTEL_MODERATOR) this moderator manages. It must already exist and ' +
      'must not be deactivated.',
  })
  @IsMongoId()
  providerId: string;

  // No transform: a password is used exactly as sent.
  @ApiPropertyOptional({
    example: 'Welcome2026',
    format: 'password',
    description:
      'The temporary password, set by the admin. Omit it and the server ' +
      'generates one. Either way it is returned once in the response and the ' +
      'moderator must replace it before it can use anything else (ACC-07a). ' +
      'Same rules as registration: at least 8 characters, with at least one ' +
      'letter and one digit, and at most 72 bytes in UTF-8.',
  })
  @IsOptional()
  @IsValidPassword()
  password?: string;
}
