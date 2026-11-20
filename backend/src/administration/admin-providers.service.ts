import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditEntityType } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { AirlinesService } from '../flights/airlines/airlines.service';
import { FlightBookingsService } from '../flights/flight-bookings/flight-bookings.service';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service';
import { HotelsService } from '../hotels/hotels.service';
import {
  NotificationResourceType,
  NotificationType,
} from '../notifications/notification-type.enum';
import type { NotifyInput } from '../notifications/notifications.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AdminProviderStatusDto,
  ProviderStatus,
  ProviderType,
} from './dto/admin-provider.dto';

// A 24-character hex id. Anything else cannot name a provider: 404, never a cast error.
const OBJECT_ID = /^[0-9a-f]{24}$/i;

type Change = 'deactivate' | 'reactivate';

/** A provider after its status changed, whatever its type. */
interface ChangedProvider {
  id: string;
  name: string;
  status: ProviderStatus;
  deactivatedAt: string | null;
}

/** Who to tell: the provider's moderators and the users with upcoming bookings. */
interface AffectedParties {
  moderatorIds: string[];
  bookingUserIds: string[];
}

const LABEL: Record<ProviderType, string> = {
  [ProviderType.HOTEL]: 'Hotel',
  [ProviderType.AIRLINE]: 'Airline',
};

function toProviderStatus(status: string): ProviderStatus {
  return status === ProviderStatus.ACTIVE
    ? ProviderStatus.ACTIVE
    : ProviderStatus.DEACTIVATED;
}

/**
 * The provider half of ACC-15: an admin deactivates or reactivates a hotel or an airline.
 * (The moderator-account half is AdminAccountsService.suspend / reactivate.)
 *
 * The status lives in the owner's collection, so the change is the owner's own
 * deactivate() / reactivate() (HotelsService, AirlinesService): one conditional update,
 * 404 for a missing provider and 409 when it is already in that state. Nothing else is
 * written to a provider or a booking: search, details and holds already skip a
 * DEACTIVATED provider, and CONFIRMED bookings stay valid.
 *
 * After the change: the audit row (GEN-07), then the notifications (GEN-01). Both come
 * after the status change, which is the source of truth, so neither can undo it or turn
 * the answer into an error.
 */
@Injectable()
export class AdminProvidersService {
  private readonly logger = new Logger(AdminProvidersService.name);

  constructor(
    private readonly hotels: HotelsService,
    private readonly airlines: AirlinesService,
    private readonly hotelBookings: HotelBookingsService,
    private readonly flightBookings: FlightBookingsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  deactivate(
    actorId: string,
    type: ProviderType,
    id: string,
  ): Promise<AdminProviderStatusDto> {
    return this.change(actorId, type, id, 'deactivate');
  }

  reactivate(
    actorId: string,
    type: ProviderType,
    id: string,
  ): Promise<AdminProviderStatusDto> {
    return this.change(actorId, type, id, 'reactivate');
  }

  private async change(
    actorId: string,
    type: ProviderType,
    id: string,
    change: Change,
  ): Promise<AdminProviderStatusDto> {
    if (!OBJECT_ID.test(id)) {
      throw this.notFound(type);
    }

    const provider = await this.changeStatus(type, id, change);
    const deactivating = change === 'deactivate';

    await this.audit.record({
      actorId,
      action: deactivating
        ? AuditAction.PROVIDER_DEACTIVATED
        : AuditAction.PROVIDER_REACTIVATED,
      entityType:
        type === ProviderType.HOTEL
          ? AuditEntityType.HOTEL
          : AuditEntityType.AIRLINE,
      entityId: provider.id,
      before: {
        status: deactivating
          ? ProviderStatus.ACTIVE
          : ProviderStatus.DEACTIVATED,
      },
      after: { status: provider.status },
    });

    const notifiedUsers = await this.notifyAffected(type, provider, change);

    const dto = new AdminProviderStatusDto();
    dto.type = type;
    dto.id = provider.id;
    dto.name = provider.name;
    dto.status = provider.status;
    dto.deactivatedAt = provider.deactivatedAt;
    dto.notifiedUsers = notifiedUsers;
    return dto;
  }

  /** The owner's own deactivate() / reactivate(); its 404 and 409 pass through. */
  private async changeStatus(
    type: ProviderType,
    id: string,
    change: Change,
  ): Promise<ChangedProvider> {
    if (type === ProviderType.HOTEL) {
      const hotel =
        change === 'deactivate'
          ? await this.hotels.deactivate(id)
          : await this.hotels.reactivate(id);
      return {
        id: hotel.id,
        name: hotel.name,
        status: toProviderStatus(hotel.status),
        deactivatedAt: hotel.deactivatedAt,
      };
    }
    const airline =
      change === 'deactivate'
        ? await this.airlines.deactivate(id)
        : await this.airlines.reactivate(id);
    return { ...airline, status: toProviderStatus(airline.status) };
  }

  /**
   * Tells the moderators and the users with upcoming CONFIRMED bookings, and returns how
   * many accounts were notified. Never throws: the status already changed, so a failed
   * lookup or notice is logged and the answer is still 200 (with 0).
   */
  private async notifyAffected(
    type: ProviderType,
    provider: ChangedProvider,
    change: Change,
  ): Promise<number> {
    try {
      const { moderatorIds, bookingUserIds } = await this.affectedParties(
        type,
        provider.id,
      );
      const moderators = new Set(moderatorIds);
      // An account that is both gets the moderator's notice only.
      const travellers = [...new Set(bookingUserIds)].filter(
        (userId) => !moderators.has(userId),
      );

      const notices: NotifyInput[] = [
        ...[...moderators].map((userId) =>
          this.notice(type, provider, change, userId, 'moderator'),
        ),
        ...travellers.map((userId) =>
          this.notice(type, provider, change, userId, 'traveller'),
        ),
      ];
      await this.notifications.notifyMany(notices);
      return notices.length;
    } catch (error) {
      this.logger.warn(
        `ACC-15: ${type} ${provider.id} was ${change}d, but notifying the ` +
          `affected accounts failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  private async affectedParties(
    type: ProviderType,
    id: string,
  ): Promise<AffectedParties> {
    if (type === ProviderType.HOTEL) {
      const [moderatorIds, bookingUserIds] = await Promise.all([
        this.hotels.findModeratorIds(id),
        this.hotelBookings.findUserIdsWithUpcomingConfirmedStays(id),
      ]);
      return { moderatorIds, bookingUserIds };
    }
    const [moderatorIds, bookingUserIds] = await Promise.all([
      this.airlines.findModeratorIds(id),
      this.flightBookings.findUserIdsWithUpcomingConfirmedFlights(id),
    ]);
    return { moderatorIds, bookingUserIds };
  }

  private notice(
    type: ProviderType,
    provider: ChangedProvider,
    change: Change,
    userId: string,
    audience: 'moderator' | 'traveller',
  ): NotifyInput {
    const label = LABEL[type];
    const deactivating = change === 'deactivate';
    const what = type === ProviderType.HOTEL ? 'Its rooms' : 'Its flights';

    let message: string;
    if (audience === 'moderator') {
      message = deactivating
        ? `An administrator deactivated ${provider.name}. ${what} are hidden from ` +
          'search and cannot be booked until it is reactivated. Confirmed ' +
          'bookings remain valid.'
        : `An administrator reactivated ${provider.name}. ${what} can be ` +
          'searched and booked again.';
    } else {
      message = deactivating
        ? `${provider.name} has been deactivated by an administrator and takes ` +
          'no new bookings. Your confirmed booking remains valid.'
        : `${provider.name} is active again. Your confirmed booking remains valid.`;
    }

    return {
      userId,
      type: deactivating
        ? NotificationType.PROVIDER_SUSPENDED
        : NotificationType.PROVIDER_REACTIVATED,
      title: `${label} ${deactivating ? 'deactivated' : 'reactivated'}`,
      message,
      resourceType:
        type === ProviderType.HOTEL
          ? NotificationResourceType.HOTEL
          : NotificationResourceType.AIRLINE,
      resourceId: provider.id,
    };
  }

  private notFound(type: ProviderType): NotFoundException {
    return type === ProviderType.HOTEL
      ? new NotFoundException({
          code: 'HOTEL_NOT_FOUND',
          message: 'Hotel not found',
        })
      : new NotFoundException({
          code: 'AIRLINE_NOT_FOUND',
          message: 'Airline not found',
        });
  }
}
