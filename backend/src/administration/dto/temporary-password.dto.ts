import { ApiProperty } from '@nestjs/swagger';

/**
 * ACC-07a: the response of an admin password reset.
 *
 * This is the only moment the temporary password exists in readable form: the
 * database holds a bcrypt hash of it and nothing logs it. The admin has to
 * pass it on now, because it cannot be read again.
 */
export class TemporaryPasswordDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  userId: string;

  @ApiProperty({ example: 'taher@example.com' })
  email: string;

  @ApiProperty({
    example: 'Tmp3f9a2c74e9',
    description:
      'Shown once. The account must set its own password at next login ' +
      'before it can use anything else.',
  })
  temporaryPassword: string;

  @ApiProperty({
    example:
      'Give this password to the account owner. It cannot be shown again.',
  })
  message: string;
}
