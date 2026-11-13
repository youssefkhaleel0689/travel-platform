import { ConflictException, Injectable } from '@nestjs/common';
import { UserStatus } from '../../common/auth/auth.enums';
import { BookingsGateway } from '../../common/bookings/bookings.gateway';
import { UserProfile, UsersService } from './users.service';

/**
 * Account lifecycle actions that need more than the users collection (ACC-12).
 *
 * It is separate from UsersService so that service keeps its single job of
 * owning the users collection, and so the dependency on the booking modules
 * lives in one obvious place.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly users: UsersService,
    private readonly bookings: BookingsGateway,
  ) {}

  /**
   * ACC-12: the owner deactivates their own account.
   *
   * Blocked while the account has an upcoming CONFIRMED booking, because a
   * deactivated account cannot log in to manage or cancel it. The check asks
   * the flights and hotels modules through BookingsGateway, so nothing here
   * reaches into a booking collection, and a booking module that is not
   * connected yet simply reports none.
   */
  async deactivateOwnAccount(userId: string): Promise<UserProfile> {
    const current = await this.users.findByIdOrThrow(userId);

    if (current.status === UserStatus.DEACTIVATED) {
      throw new ConflictException({
        code: 'ALREADY_DEACTIVATED',
        message: 'This account is already deactivated',
      });
    }

    if (await this.bookings.hasUpcomingConfirmedBookings(userId)) {
      throw new ConflictException({
        code: 'UPCOMING_BOOKINGS_EXIST',
        message:
          'You still have upcoming confirmed bookings. Cancel them or wait ' +
          'until they are completed before deactivating your account.',
      });
    }

    const deactivated = await this.users.setStatus(
      userId,
      UserStatus.DEACTIVATED,
    );
    // setStatus returns null only when the status already matched, which the
    // check above has ruled out.
    return deactivated ?? current;
  }
}
