import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean } from 'class-validator';

/**
 * ACC-12: "after confirmation". The frontend shows the dialog (GEN-03), but
 * the backend must not take the word of a DELETE that arrives with no body,
 * so the confirmation is an explicit field the request has to carry.
 */
export class DeactivateAccountDto {
  @ApiProperty({
    example: true,
    description:
      'Must be true. Deactivation hides your posts and public itineraries ' +
      'and you can no longer sign in.',
  })
  @IsBoolean()
  @Equals(true, {
    message: 'confirm must be true to deactivate the account',
  })
  confirm: boolean;
}
