import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CURRENCY_CODE } from '../../common/reference-data/reference-data.patterns';

/** E.164-style: an optional +, then 7 to 15 digits. Spaces are trimmed away. */
const PHONE_PATTERN = /^\+?\d{7,15}$/;

/**
 * ACC-09: name, phone and preferred currency are the only editable fields.
 * The email identifies the account and the role and status are an admin's to
 * change (ACC-15, ACC-16), so neither is accepted here - and because the
 * global pipe runs with forbidNonWhitelisted, sending `role` is a 400 rather
 * than a silently ignored field.
 *
 * phone and preferredCurrency accept null, which clears them. A field that is
 * left out is not touched.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: 'Taher Khalaf',
    minLength: 1,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1, { message: 'name should not be empty' })
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: '+201234567890',
    nullable: true,
    description: 'Optional + followed by 7 to 15 digits, or null to clear it',
  })
  @IsOptional()
  // Skips the format check for null so the field can be cleared, while a
  // wrong string is still rejected.
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value,
  )
  @Matches(PHONE_PATTERN, {
    message: 'phone must be an optional + followed by 7 to 15 digits',
  })
  phone?: string | null;

  @ApiPropertyOptional({
    example: 'EGP',
    nullable: true,
    description:
      'One of the seeded currencies (GET /api/currencies), or null to clear it',
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(CURRENCY_CODE, {
    message: 'preferredCurrency must be a three-letter currency code',
  })
  preferredCurrency?: string | null;
}
