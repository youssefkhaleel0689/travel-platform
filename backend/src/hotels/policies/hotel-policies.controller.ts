import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { HotelPoliciesService } from "./hotel-policies.service";
import { UpsertHotelPolicyDto } from "./dto/upsert-hotel-policy.dto";
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { Public } from '../../common/auth/public.decorator';
import { Role } from '../../common/auth/auth.enums';
import { ApiErrorResponse } from '../../common/swagger/api-error-response.decorator';

const PATH = '/api/hotels/6af83761fa40574d39eb7dc2/policies';

@ApiTags("Hotel policies (B2)")
@Controller("hotels/:hotelId/policies")
export class HotelPoliciesController {
  constructor(private readonly service: HotelPoliciesService) {}

  @Put()
  @ApiCookieAuth()
  @ApiOkResponse({ description: 'The new policy version' })
  @ApiErrorResponse({ status: 400, description: 'Validation failed (VALIDATION_FAILED)', examples: [{ code: 'VALIDATION_FAILED', message: 'Validation failed', path: PATH, errors: [{ field: 'body', messages: ['invalid value'] }] }] })
  @ApiErrorResponse({ status: 401, description: 'Not logged in (UNAUTHENTICATED)', examples: [{ code: 'UNAUTHENTICATED', message: 'Authentication required', path: PATH }] })
  @ApiErrorResponse({ status: 403, description: 'Wrong role or not assigned to this hotel (FORBIDDEN)', examples: [{ code: 'FORBIDDEN', message: 'You do not have permission to do this', path: PATH }] })
  @ApiErrorResponse({ status: 404, description: 'Hotel not found (HOTEL_NOT_FOUND)', examples: [{ code: 'HOTEL_NOT_FOUND', message: 'Hotel not found', path: PATH }] })
  @ApiOperation({
    summary: "HTL-09/10 Manage hotel policies (HOTEL_MODERATOR)",
    description:
      "Access: HOTEL_MODERATOR only — login required. Creates or replaces the hotel check-in/check-out times and cancellation refund tiers. The policy version increments when updated.",
  })
  @Roles(Role.HOTEL_MODERATOR)
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param("hotelId") hotelId: string,
    @Body() dto: UpsertHotelPolicyDto,
  ) {
    return this.service.upsert(user, hotelId, dto);
  }

  @Get()
  @Public()
  @ApiOkResponse({ description: 'Current policy or defaults when none configured' })
  @ApiErrorResponse({ status: 404, description: 'Hotel not found (HOTEL_NOT_FOUND)', examples: [{ code: 'HOTEL_NOT_FOUND', message: 'Hotel not found', path: PATH }] })
  @ApiOperation({
    summary: "Read hotel policies (PUBLIC)",
    description:
      "Access: PUBLIC — no login required. Returns the current check-in/check-out times, cancellation tiers and policy version for the specified hotel.",
  })
  find(@Param("hotelId") hotelId: string) {
    return this.service.findByHotel(hotelId);
  }
}
