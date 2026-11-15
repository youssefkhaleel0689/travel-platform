import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  buildMessage,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  isMongoId,
  MaxLength,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import { Role } from '../../common/auth/auth.enums';
import { IsValidPassword } from '../../common/validation/password';
import { trimLower, trimText } from '../../common/validation/text-transforms';

/**
 * "Optional" here means "may be left out", not "may be null". A sent null must
 * still fail, which @IsOptional() would skip: `"password": null` is a mistake in
 * the admin's body, not a request to generate one. Same predicate as the
 * airlines DTOs use.
 */
const isSent = (_object: object, value: unknown): boolean =>
  value !== undefined;

/** The only two roles ACC-13 creates. ADMIN is seeded (ACC-18), USER registers (ACC-01). */
export const MODERATOR_ROLES = [
  Role.AIRLINE_MODERATOR,
  Role.HOTEL_MODERATOR,
] as const;

type ModeratorRole = (typeof MODERATOR_ROLES)[number];

/**
 * The provider id that matches the selected role is required, and the other one
 * must be absent: `role: AIRLINE_MODERATOR` takes `airlineId`, `role:
 * HOTEL_MODERATOR` takes `hotelId`.
 *
 * Both halves of that rule live in one validator, and in the DTO rather than in
 * the service, so ValidationPipe turns either failure into the same 400
 * VALIDATION_FAILED body as every other field through
 * validationExceptionFactory. The alternative - requiring the id here and
 * rejecting the mismatched one in the service - needs a second hand-written
 * copy of that body which nothing keeps in step with the factory.
 *
 * @ValidateIf cannot express it: it switches a property's whole decorator list
 * on or off, and these two cases need different checks, not the same check
 * conditionally skipped.
 *
 * When role itself is missing or is not a moderator role, neither id can be
 * judged, so both stay quiet and the body fails on role alone instead of on
 * three fields at once.
 */
function IsProviderIdFor(role: ModeratorRole): PropertyDecorator {
  const selectedRole = (object: unknown): unknown =>
    (object as Partial<CreateModeratorDto> | undefined)?.role;

  const verdict = (value: unknown, object: unknown): boolean => {
    const selected = selectedRole(object);
    if (!MODERATOR_ROLES.includes(selected as ModeratorRole)) {
      return true;
    }
    return selected === role ? isMongoId(value) : value === undefined;
  };

  return ValidateBy({
    name: 'isProviderIdFor',
    validator: {
      validate: (value, args): boolean => verdict(value, args?.object),
      defaultMessage: buildMessage((eachPrefix, args) => {
        const property = args?.property ?? 'provider id';
        return selectedRole(args?.object) === role
          ? `${eachPrefix}${property} must be a mongodb id`
          : `${eachPrefix}${property} is only allowed when role is ${role}`;
      }),
    },
  });
}

/**
 * Body of POST /api/admin/moderators (ACC-13).
 *
 * Unlike RegisterDto there is a role field, because choosing between an
 * airline and a hotel moderator is the point of the endpoint. @IsIn keeps it to
 * the two moderator roles, so this route can never mint an ADMIN.
 *
 * The provider is named by `airlineId` or `hotelId` rather than one generic
 * `providerId`, so the body says which collection the id has to come from. Both
 * properties are in the schema because Swagger UI cannot hide one body property
 * based on another's value; the field descriptions and the validator carry the
 * rule instead. The ports underneath stay generic - see
 * ModeratorAssignmentPort, whose argument is still a providerId - and so does
 * the response, where `account.role` already says which kind of id it is.
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
      'Which kind of provider this moderator manages. It also decides which ' +
      'provider id the body has to carry: airlineId or hotelId.',
  })
  @IsIn(MODERATOR_ROLES, {
    message: `role must be one of: ${MODERATOR_ROLES.join(', ')}`,
  })
  role: ModeratorRole;

  @ApiPropertyOptional({
    example: '6720f1c2a1b2c3d4e5f60718',
    description:
      'The one airline this moderator manages. Required when role is ' +
      'AIRLINE_MODERATOR, and rejected otherwise. It must already exist and ' +
      'must not be deactivated.',
  })
  @IsProviderIdFor(Role.AIRLINE_MODERATOR)
  airlineId?: string;

  @ApiPropertyOptional({
    example: '6720f1c2a1b2c3d4e5f60718',
    description:
      'The one hotel this moderator manages. Required when role is ' +
      'HOTEL_MODERATOR, and rejected otherwise. It must already exist and ' +
      'must not be deactivated.',
  })
  @IsProviderIdFor(Role.HOTEL_MODERATOR)
  hotelId?: string;

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
  @ValidateIf(isSent)
  @IsValidPassword()
  password?: string;
}
