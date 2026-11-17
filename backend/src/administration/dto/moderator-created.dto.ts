import { ApiProperty } from '@nestjs/swagger';
import { AdminAccountDto } from './admin-account.dto';
import type { UserProfile } from '../../auth/users/users.service';

/**
 * ACC-13: the response of creating a moderator account.
 *
 * It carries the account itself, the provider it was linked to, and the
 * temporary password. Like ACC-07a, this is the only moment that password
 * exists in readable form: the database holds a bcrypt hash of it and nothing
 * logs it, so the admin has to pass it on now.
 */
export class ModeratorCreatedDto {
  @ApiProperty({ type: AdminAccountDto })
  account: AdminAccountDto;

  @ApiProperty({
    example: '6720f1c2a1b2c3d4e5f60718',
    description: 'The airline or hotel this moderator manages, and only this one',
  })
  providerId: string;

  @ApiProperty({
    example: 'Welcome2026',
    description:
      'Shown once. The moderator must set its own password at first login ' +
      'before it can use anything else.',
  })
  temporaryPassword: string;

  @ApiProperty({
    example:
      'Give this password to the moderator. It cannot be shown again, and it must be changed at first login.',
  })
  message: string;

  static from(
    profile: UserProfile,
    providerId: string,
    temporaryPassword: string,
  ): ModeratorCreatedDto {
    const dto = new ModeratorCreatedDto();
    dto.account = AdminAccountDto.from(profile);
    dto.providerId = providerId;
    dto.temporaryPassword = temporaryPassword;
    dto.message =
      'Give this password to the moderator. It cannot be shown again, and it ' +
      'must be changed at first login.';
    return dto;
  }
}
