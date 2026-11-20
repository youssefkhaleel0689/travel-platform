import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditEntityType } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { AirlinesService } from '../flights/airlines/airlines.service';
import { FlightBookingsService } from '../flights/flight-bookings/flight-bookings.service';
import { AirlineStatus } from '../flights/schemas/airline.schema';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service';
import { HotelsService } from '../hotels/hotels.service';
import { HotelStatus } from '../hotels/schemas/hotel.schema';
import {
  NotificationResourceType,
  NotificationType,
} from '../notifications/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { AdminProvidersService } from './admin-providers.service';
import { ProviderStatus, ProviderType } from './dto/admin-provider.dto';

describe('AdminProvidersService (ACC-15)', () => {
  const ADMIN_ID = '6720f1c2a1b2c3d4e5f60001';
  const HOTEL_ID = '6720f1c2a1b2c3d4e5f60788';
  const AIRLINE_ID = '6720f1c2a1b2c3d4e5f60777';
  const MODERATOR_ID = '6720f1c2a1b2c3d4e5f60101';
  const TRAVELLER_ID = '6720f1c2a1b2c3d4e5f60202';
  const DEACTIVATED_AT = '2026-11-19T10:00:00.000Z';

  let hotels: jest.Mocked<
    Pick<HotelsService, 'deactivate' | 'reactivate' | 'findModeratorIds'>
  >;
  let airlines: jest.Mocked<
    Pick<AirlinesService, 'deactivate' | 'reactivate' | 'findModeratorIds'>
  >;
  let hotelBookings: jest.Mocked<
    Pick<HotelBookingsService, 'findUserIdsWithUpcomingConfirmedStays'>
  >;
  let flightBookings: jest.Mocked<
    Pick<FlightBookingsService, 'findUserIdsWithUpcomingConfirmedFlights'>
  >;
  let audit: jest.Mocked<Pick<AuditService, 'record'>>;
  let notifications: jest.Mocked<Pick<NotificationsService, 'notifyMany'>>;
  let service: AdminProvidersService;
  let warn: jest.SpyInstance;

  function hotel(status: HotelStatus, deactivatedAt: string | null) {
    return {
      id: HOTEL_ID,
      name: 'Nile View Hotel',
      address: '1 Corniche',
      cityId: 'cairo',
      countryId: 'EG',
      description: '',
      starClass: 4,
      status,
      deactivatedAt,
      ratingAverage: null,
      ratingCount: 0,
      amenities: [],
      photos: [],
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    };
  }

  function airline(status: AirlineStatus, deactivatedAt: string | null) {
    return { id: AIRLINE_ID, name: 'EgyptAir', status, deactivatedAt };
  }

  beforeEach(() => {
    hotels = {
      deactivate: jest
        .fn()
        .mockResolvedValue(hotel(HotelStatus.DEACTIVATED, DEACTIVATED_AT)),
      reactivate: jest.fn().mockResolvedValue(hotel(HotelStatus.ACTIVE, null)),
      findModeratorIds: jest.fn().mockResolvedValue([MODERATOR_ID]),
    };
    airlines = {
      deactivate: jest
        .fn()
        .mockResolvedValue(airline(AirlineStatus.DEACTIVATED, DEACTIVATED_AT)),
      reactivate: jest
        .fn()
        .mockResolvedValue(airline(AirlineStatus.ACTIVE, null)),
      findModeratorIds: jest.fn().mockResolvedValue([MODERATOR_ID]),
    };
    hotelBookings = {
      findUserIdsWithUpcomingConfirmedStays: jest
        .fn()
        .mockResolvedValue([TRAVELLER_ID]),
    };
    flightBookings = {
      findUserIdsWithUpcomingConfirmedFlights: jest
        .fn()
        .mockResolvedValue([TRAVELLER_ID]),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    notifications = { notifyMany: jest.fn().mockResolvedValue(undefined) };

    service = new AdminProvidersService(
      hotels as unknown as HotelsService,
      airlines as unknown as AirlinesService,
      hotelBookings as unknown as HotelBookingsService,
      flightBookings as unknown as FlightBookingsService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
    );
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('deactivate a hotel', () => {
    it('uses HotelsService.deactivate and answers the documented shape', async () => {
      const result = await service.deactivate(
        ADMIN_ID,
        ProviderType.HOTEL,
        HOTEL_ID,
      );

      expect(hotels.deactivate).toHaveBeenCalledWith(HOTEL_ID);
      expect(airlines.deactivate).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: ProviderType.HOTEL,
        id: HOTEL_ID,
        name: 'Nile View Hotel',
        status: ProviderStatus.DEACTIVATED,
        deactivatedAt: DEACTIVATED_AT,
        notifiedUsers: 2,
      });
    });

    it('records the audit entry with the admin, the hotel and the status change', async () => {
      await service.deactivate(ADMIN_ID, ProviderType.HOTEL, HOTEL_ID);

      expect(audit.record).toHaveBeenCalledWith({
        actorId: ADMIN_ID,
        action: AuditAction.PROVIDER_DEACTIVATED,
        entityType: AuditEntityType.HOTEL,
        entityId: HOTEL_ID,
        before: { status: 'ACTIVE' },
        after: { status: 'DEACTIVATED' },
      });
    });

    it('notifies the moderators and the users with upcoming stays, telling users their booking stays valid', async () => {
      await service.deactivate(ADMIN_ID, ProviderType.HOTEL, HOTEL_ID);

      expect(hotels.findModeratorIds).toHaveBeenCalledWith(HOTEL_ID);
      expect(
        hotelBookings.findUserIdsWithUpcomingConfirmedStays,
      ).toHaveBeenCalledWith(HOTEL_ID);
      expect(notifications.notifyMany).toHaveBeenCalledTimes(1);
      const [notices] = notifications.notifyMany.mock.calls[0];
      expect(notices).toEqual([
        {
          userId: MODERATOR_ID,
          type: NotificationType.PROVIDER_SUSPENDED,
          title: 'Hotel deactivated',
          message: expect.stringContaining('Nile View Hotel'),
          resourceType: NotificationResourceType.HOTEL,
          resourceId: HOTEL_ID,
        },
        {
          userId: TRAVELLER_ID,
          type: NotificationType.PROVIDER_SUSPENDED,
          title: 'Hotel deactivated',
          message: expect.stringContaining(
            'Your confirmed booking remains valid.',
          ),
          resourceType: NotificationResourceType.HOTEL,
          resourceId: HOTEL_ID,
        },
      ]);
    });

    it('changes the status before the audit entry and the notifications', async () => {
      await service.deactivate(ADMIN_ID, ProviderType.HOTEL, HOTEL_ID);

      const [changed] = hotels.deactivate.mock.invocationCallOrder;
      const [audited] = audit.record.mock.invocationCallOrder;
      const [notified] = notifications.notifyMany.mock.invocationCallOrder;
      expect(changed).toBeLessThan(audited);
      expect(audited).toBeLessThan(notified);
    });

    it('notifies an account that is both moderator and traveller once', async () => {
      hotelBookings.findUserIdsWithUpcomingConfirmedStays.mockResolvedValue([
        MODERATOR_ID,
        TRAVELLER_ID,
        TRAVELLER_ID,
      ]);

      const result = await service.deactivate(
        ADMIN_ID,
        ProviderType.HOTEL,
        HOTEL_ID,
      );

      const [notices] = notifications.notifyMany.mock.calls[0];
      expect(notices.map((notice) => notice.userId)).toEqual([
        MODERATOR_ID,
        TRAVELLER_ID,
      ]);
      expect(result.notifiedUsers).toBe(2);
    });
  });

  describe('deactivate an airline', () => {
    it('uses AirlinesService and the flight bookings, and audits an AIRLINE', async () => {
      const result = await service.deactivate(
        ADMIN_ID,
        ProviderType.AIRLINE,
        AIRLINE_ID,
      );

      expect(airlines.deactivate).toHaveBeenCalledWith(AIRLINE_ID);
      expect(hotels.deactivate).not.toHaveBeenCalled();
      expect(airlines.findModeratorIds).toHaveBeenCalledWith(AIRLINE_ID);
      expect(
        flightBookings.findUserIdsWithUpcomingConfirmedFlights,
      ).toHaveBeenCalledWith(AIRLINE_ID);
      expect(audit.record).toHaveBeenCalledWith({
        actorId: ADMIN_ID,
        action: AuditAction.PROVIDER_DEACTIVATED,
        entityType: AuditEntityType.AIRLINE,
        entityId: AIRLINE_ID,
        before: { status: 'ACTIVE' },
        after: { status: 'DEACTIVATED' },
      });
      const [notices] = notifications.notifyMany.mock.calls[0];
      expect(notices).toHaveLength(2);
      expect(
        notices.every(
          (notice) =>
            notice.type === NotificationType.PROVIDER_SUSPENDED &&
            notice.resourceType === NotificationResourceType.AIRLINE &&
            notice.title === 'Airline deactivated',
        ),
      ).toBe(true);
      expect(result).toEqual({
        type: ProviderType.AIRLINE,
        id: AIRLINE_ID,
        name: 'EgyptAir',
        status: ProviderStatus.DEACTIVATED,
        deactivatedAt: DEACTIVATED_AT,
        notifiedUsers: 2,
      });
    });

    it('lets a 409 from the owner through, with no audit entry and no notification', async () => {
      const conflict = new ConflictException({
        code: 'AIRLINE_ALREADY_DEACTIVATED',
        message: 'Airline is already deactivated',
      });
      airlines.deactivate.mockRejectedValue(conflict);

      await expect(
        service.deactivate(ADMIN_ID, ProviderType.AIRLINE, AIRLINE_ID),
      ).rejects.toBe(conflict);
      expect(audit.record).not.toHaveBeenCalled();
      expect(notifications.notifyMany).not.toHaveBeenCalled();
    });

    it('lets a 404 from the owner through for a missing airline', async () => {
      const missing = new NotFoundException({
        code: 'AIRLINE_NOT_FOUND',
        message: 'Airline not found',
      });
      airlines.deactivate.mockRejectedValue(missing);

      await expect(
        service.deactivate(ADMIN_ID, ProviderType.AIRLINE, AIRLINE_ID),
      ).rejects.toBe(missing);
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('a malformed id', () => {
    it.each([
      [ProviderType.HOTEL, 'HOTEL_NOT_FOUND', 'Hotel not found'],
      [ProviderType.AIRLINE, 'AIRLINE_NOT_FOUND', 'Airline not found'],
    ])(
      'answers 404 for a %s without calling its owner',
      async (type, code, message) => {
        const error: unknown = await service
          .deactivate(ADMIN_ID, type, 'not-an-id')
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).getResponse()).toEqual({
          code,
          message,
        });
        expect(hotels.deactivate).not.toHaveBeenCalled();
        expect(airlines.deactivate).not.toHaveBeenCalled();
        expect(audit.record).not.toHaveBeenCalled();
      },
    );
  });

  describe('reactivate', () => {
    it('reactivates a hotel, audits PROVIDER_REACTIVATED and sends PROVIDER_REACTIVATED notices', async () => {
      const result = await service.reactivate(
        ADMIN_ID,
        ProviderType.HOTEL,
        HOTEL_ID,
      );

      expect(hotels.reactivate).toHaveBeenCalledWith(HOTEL_ID);
      expect(audit.record).toHaveBeenCalledWith({
        actorId: ADMIN_ID,
        action: AuditAction.PROVIDER_REACTIVATED,
        entityType: AuditEntityType.HOTEL,
        entityId: HOTEL_ID,
        before: { status: 'DEACTIVATED' },
        after: { status: 'ACTIVE' },
      });
      const [notices] = notifications.notifyMany.mock.calls[0];
      expect(notices.map((notice) => notice.type)).toEqual([
        NotificationType.PROVIDER_REACTIVATED,
        NotificationType.PROVIDER_REACTIVATED,
      ]);
      expect(notices[1].message).toContain(
        'Your confirmed booking remains valid.',
      );
      expect(result.status).toBe(ProviderStatus.ACTIVE);
      expect(result.deactivatedAt).toBeNull();
    });

    it('reactivates an airline through AirlinesService.reactivate', async () => {
      const result = await service.reactivate(
        ADMIN_ID,
        ProviderType.AIRLINE,
        AIRLINE_ID,
      );

      expect(airlines.reactivate).toHaveBeenCalledWith(AIRLINE_ID);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.PROVIDER_REACTIVATED,
          entityType: AuditEntityType.AIRLINE,
        }),
      );
      expect(result.status).toBe(ProviderStatus.ACTIVE);
    });

    it('lets a 409 already-active through', async () => {
      const conflict = new ConflictException({
        code: 'HOTEL_ALREADY_ACTIVE',
        message: 'Hotel is already active',
      });
      hotels.reactivate.mockRejectedValue(conflict);

      await expect(
        service.reactivate(ADMIN_ID, ProviderType.HOTEL, HOTEL_ID),
      ).rejects.toBe(conflict);
      expect(notifications.notifyMany).not.toHaveBeenCalled();
    });
  });

  describe('when notifying fails', () => {
    it('still answers with the changed provider when notifyMany rejects, and logs a warning', async () => {
      notifications.notifyMany.mockRejectedValue(new Error('insert failed'));

      const result = await service.deactivate(
        ADMIN_ID,
        ProviderType.HOTEL,
        HOTEL_ID,
      );

      expect(result.status).toBe(ProviderStatus.DEACTIVATED);
      expect(result.notifiedUsers).toBe(0);
      expect(audit.record).toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('insert failed'),
      );
    });

    it('still answers when looking up the users to notify fails', async () => {
      flightBookings.findUserIdsWithUpcomingConfirmedFlights.mockRejectedValue(
        new Error('lookup failed'),
      );

      const result = await service.deactivate(
        ADMIN_ID,
        ProviderType.AIRLINE,
        AIRLINE_ID,
      );

      expect(result.status).toBe(ProviderStatus.DEACTIVATED);
      expect(result.notifiedUsers).toBe(0);
      expect(notifications.notifyMany).not.toHaveBeenCalled();
    });
  });

  it('notifies nobody and reports 0 when there are no moderators or bookings', async () => {
    hotels.findModeratorIds.mockResolvedValue([]);
    hotelBookings.findUserIdsWithUpcomingConfirmedStays.mockResolvedValue([]);

    const result = await service.deactivate(
      ADMIN_ID,
      ProviderType.HOTEL,
      HOTEL_ID,
    );

    expect(result.notifiedUsers).toBe(0);
    expect(notifications.notifyMany).toHaveBeenCalledWith([]);
  });
});
