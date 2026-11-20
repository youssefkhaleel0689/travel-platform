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
      'Same route and cabin, subject to seat availability. A higher fare opens ' +
      'a Stripe PaymentIntent for the difference; a lower fare is refunded and ' +
      'the change is applied immediately.',
  })
  @ApiOkResponse({
    description: 'Either the applied change or a payment intent',
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
  })
  @ApiOkResponse({ description: 'The applied change' })
  apply(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.changes.applyPaid(user, id);
  }
}
