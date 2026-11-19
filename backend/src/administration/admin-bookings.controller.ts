import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';
import { forbidden, unauthenticated } from '../common/swagger/standard-errors';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator';
import { PageDto } from '../common/pagination/dto/page.dto';
import { Roles } from '../common/auth/roles.decorator';
import { Role } from '../common/auth/auth.enums';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminBookingDto } from './dto/admin-booking.dto';
import { AdminBookingsQueryDto } from './dto/admin-bookings-query.dto';

/**
 * ACC-17: the admin's read-only view of every booking on the platform.
 *
 * It is a separate admin endpoint rather than a bypass inside the traveller's
 * own list (ACC-11): the owner-only rule on /api/flight-bookings and
 * /api/hotel-bookings stays absolute, and the one place an admin sees other
 * people's bookings is this route, behind @Roles(Role.ADMIN).
 *
 * There is no POST, PATCH or DELETE here on purpose. A booking is cancelled
 * through the module that owns it, which has the inventory and the refund
 * rules; this list only reads.
 */
@ApiTags('Administration')
@ApiCookieAuth()
@ApiErrorResponse(unauthenticated('/api/admin/bookings'))
@ApiErrorResponse(forbidden('/api/admin/bookings'))
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminBookingsController {
  constructor(private readonly adminBookings: AdminBookingsService) {}

  @Get('bookings')
  @ApiOperation({
    summary: 'List every flight and hotel booking (ACC-17)',
    description:
      'Pages of 10, newest booking first (GEN-05). Flight bookings and hotel ' +
      'reservations live in two collections owned by two modules; both are ' +
      'read through the shared BookingsPort and merged into one page. A ' +
      'booking type appears here once the module that owns it implements the ' +
      'optional listForAdmin on that port; until then its bookings are simply ' +
      'absent and this route still answers a page, never a 501. type, ' +
      'status, the from/to day range (the day each booking was made, in UTC) ' +
      'and the exact booking reference narrow the list. Read-only: a booking ' +
      'is cancelled through the module that owns it.',
  })
  @ApiPaginatedResponse(AdminBookingDto)
  @ApiErrorResponse({
    status: 400,
    description:
      'Bad page, unknown type or status, a day that is not YYYY-MM-DD, a bad ' +
      'reference, or an unknown query parameter',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: '/api/admin/bookings',
      },
      {
        code: 'INVALID_DATE_RANGE',
        message: 'from must not be later than to',
        path: '/api/admin/bookings',
      },
    ],
  })
  listBookings(
    @Query() query: AdminBookingsQueryDto,
  ): Promise<PageDto<AdminBookingDto>> {
    return this.adminBookings.listBookings(query);
  }
}
