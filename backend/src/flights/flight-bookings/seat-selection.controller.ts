import { Body, Controller, Param, Patch } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { SelectSeatsDto } from './dto/seat-selection.dto';
import { SeatSelectionService } from './seat-selection.service';

@ApiTags('Flight bookings - Seats')
@ApiCookieAuth()
@Controller('flight-bookings')
export class SeatSelectionController {
  constructor(private readonly seats: SeatSelectionService) {}

  @Patch(':id/seat')
  @ApiOperation({
    summary: 'Choose seats on one segment of a confirmed booking (FLT-28)',
    description:
      'Seat labels are row + letter A-F (for example 12A). The row must fit ' +
      'the booked cabin and the seat must not be taken by another confirmed ' +
      'booking on the same flight.',
  })
  @ApiOkResponse({ description: 'The seats assigned to the segment' })
  select(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SelectSeatsDto,
  ) {
    return this.seats.select(user, id, dto);
  }
}
