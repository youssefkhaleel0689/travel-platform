import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean, IsInt, Min } from 'class-validator';

/**
 * PAY-02: the acceptance checkbox, plus the version of the terms the user was
 * shown.
 *
 * The version is required so acceptance can only be given for terms that were
 * actually displayed: a client that sends a stale version is told to read the
 * policies again rather than silently agreeing to different ones.
 */
export class AcceptPoliciesDto {
  @ApiProperty({
    example: true,
    description: 'Must be true; this is the acceptance checkbox',
  })
  @IsBoolean()
  @Equals(true, { message: 'accepted must be true' })
  accepted: boolean;

  @ApiProperty({
    example: 1,
    description:
      'policyVersion from GET /api/bookings/{type}/{id}/policies. A different ' +
      'value is rejected with 409 POLICY_VERSION_MISMATCH.',
  })
  @IsInt()
  @Min(0)
  policyVersion: number;
}
