import { BadRequestException, Injectable } from '@nestjs/common';
import { UsersService } from '../auth/users/users.service';
import { BookingsGateway } from '../common/bookings/bookings.gateway';
import type { AdminBookingsQuery } from '../common/bookings/bookings.gateway';
import { PageDto } from '../common/pagination/dto/page.dto';
import { parseLocalDate } from '../common/time/local-date-time';
import { AdminBookingDto } from './dto/admin-booking.dto';
import { AdminBookingsQueryDto } from './dto/admin-bookings-query.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Turns a calendar day (`2026-11-01`) into the UTC instant it starts at. The
 * DTO has already refused a day that does not exist, so a bad value here is a
 * programming error rather than client input.
 */
function startOfUtcDay(day: string): Date {
  const parts = parseLocalDate(day);
  if (!parts) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: `${day} is not a valid date (YYYY-MM-DD)`,
    });
  }
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

/**
 * ACC-17: the read-only list of every booking, for an admin.
 *
 * It owns no collection. Flight bookings and hotel reservations live in two
 * collections owned by two other modules, so both are read through
 * BookingsGateway, which fans the filters out to the ports those modules
 * provide and merges the answers into one page (GEN-05). The account names and
 * addresses come from UsersService the same way.
 *
 * Nothing here can change a booking: the port offers no write for this list.
 */
@Injectable()
export class AdminBookingsService {
  constructor(
    private readonly bookings: BookingsGateway,
    private readonly users: UsersService,
  ) {}

  async listBookings(
    query: AdminBookingsQueryDto,
  ): Promise<PageDto<AdminBookingDto>> {
    const { page, type, status, from, to, reference } = query;

    // Both ends name a whole day in UTC, so the range runs from the start of
    // `from` to the start of the day after `to`.
    const createdFrom = from ? startOfUtcDay(from) : undefined;
    const createdTo = to
      ? new Date(startOfUtcDay(to).getTime() + DAY_MS)
      : undefined;
    if (
      createdFrom &&
      createdTo &&
      createdTo.getTime() <= createdFrom.getTime()
    ) {
      throw new BadRequestException({
        code: 'INVALID_DATE_RANGE',
        message: 'from must not be later than to',
      });
    }

    const filter: AdminBookingsQuery = {
      bookingType: type,
      status,
      createdFrom,
      createdTo,
      reference,
    };
    const page_ = await this.bookings.listForAdmin(filter, page);

    // One query for the whole page, not one per row; a row whose account has
    // been deleted keeps its user id and shows no name.
    const owners = await this.users.findContactsByIds(
      page_.items.map((row) => row.userId),
    );

    return new PageDto(
      page_.items.map((row) =>
        AdminBookingDto.from(row, owners.get(row.userId)),
      ),
      page_.meta,
    );
  }
}
