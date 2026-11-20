import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ChangeFlightDto } from './dto/change-flight.dto';
import { ChangeFlightService } from './change-flight.service';

@ApiTags('Flight bookings - Change')
@ApiCookieAuth()
@Controller('flight-bookings')
export class ChangeFlightController {
  constructor(private readonly changes: ChangeFlightService) {}

  @Patch(':id/change-flight')
  @ApiOperation({
    summary:
      'Change a confirmed flight to another flight on the same route (FLT-27)',
    description:
      'Same route and cabin, subject to seat availability. A same or lower fare is ' +
      "applied at once, and a lower fare's difference is refunded as a recorded refund " +
      '(GET /api/refunds/:id, PAY-03). A higher fare holds the new seats for 10 minutes ' +
      '(holdExpiresAt) and opens a Stripe PaymentIntent for the difference; the change is ' +
      'applied by POST .../change-flight/apply, or automatically once the hold ends if the ' +
      'difference was paid. An unpaid change is released when the hold ends. ' +
      '409 CHANGE_ALREADY_PENDING while a change is pending; 409 BOOKING_CHANGED when the ' +
      'same change was applied by another request first.',
  })
  @ApiOkResponse({
    description:
      'Either the applied change (with refunded and refundId for a lower fare) or a ' +
      'payment intent with holdExpiresAt',
  })
  request(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChangeFlightDto,
  ) {
    return this.changes.request(user, id, dto);
  }

  @Post(':id/change-flight/apply')
  @ApiOperation({
    summary:
      'Apply a paid flight change after Stripe confirms the fare difference (FLT-27)',
    description:
      'Applies once: a second call gets 409 BOOKING_CHANGED. 409 PAYMENT_NOT_SUCCEEDED ' +
      'while the difference is unpaid. 409 CHANGE_NO_LONGER_POSSIBLE when the booking or ' +
      'the new flight changed in the meantime: the paid difference is then refunded in full.',
  })
  @ApiOkResponse({ description: 'The applied change' })
  apply(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.changes.applyPaid(user, id);
  }
}
