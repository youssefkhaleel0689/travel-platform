import { BadRequestException } from '@nestjs/common';
import { UsersService } from '../auth/users/users.service';
import type { UserContact } from '../auth/users/users.service';
import { BookingsGateway } from '../common/bookings/bookings.gateway';
import {
  BookingStatus,
  BookingType,
  ProviderType,
} from '../common/bookings/booking-status';
import type { AdminBookingRow } from '../common/bookings/bookings.port';
import { PageDto, PageMetaDto } from '../common/pagination/dto/page.dto';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminBookingsQueryDto } from './dto/admin-bookings-query.dto';

describe('AdminBookingsService (ACC-17)', () => {
  const USER_ID = '6720f1c2a1b2c3d4e5f60001';
  const AIRLINE_ID = '6720f1c2a1b2c3d4e5f60002';
  const BOOKING_ID = '6720f1c2a1b2c3d4e5f60003';

  let bookings: jest.Mocked<Pick<BookingsGateway, 'listForAdmin'>>;
  let users: jest.Mocked<Pick<UsersService, 'findContactsByIds'>>;
  let service: AdminBookingsService;

  function row(overrides: Partial<AdminBookingRow> = {}): AdminBookingRow {
    return {
      bookingId: BOOKING_ID,
      bookingType: BookingType.FLIGHT,
      bookingReference: 'K7M2QX',
      userId: USER_ID,
      providerType: ProviderType.AIRLINE,
      providerId: AIRLINE_ID,
      providerName: 'KD Airways',
      startsAt: new Date('2026-12-20T06:30:00.000Z'),
      endsAt: new Date('2026-12-20T10:30:00.000Z'),
      totalAmount: '420.00',
      currency: 'USD',
      status: BookingStatus.CONFIRMED,
      createdAt: new Date('2026-11-19T08:00:00.000Z'),
      ...overrides,
    };
  }

  function query(
    overrides: Partial<AdminBookingsQueryDto> = {},
  ): AdminBookingsQueryDto {
    return Object.assign(new AdminBookingsQueryDto(), {
      page: 1,
      ...overrides,
    });
  }

  function contact(overrides: Partial<UserContact> = {}): UserContact {
    return {
      id: USER_ID,
      name: 'Taher Khalaf',
      email: 'taher@example.com',
      ...overrides,
    };
  }

  beforeEach(() => {
    bookings = {
      listForAdmin: jest
        .fn()
        .mockResolvedValue(new PageDto([], PageMetaDto.create(1, 0))),
    };
    users = {
      findContactsByIds: jest.fn().mockResolvedValue(new Map()),
    };
    service = new AdminBookingsService(
      bookings as unknown as BookingsGateway,
      users as unknown as UsersService,
    );
  });

  it('asks the gateway for the page, with no filter when none was given', async () => {
    await service.listBookings(query({ page: 2 }));

    expect(bookings.listForAdmin).toHaveBeenCalledWith(
      {
        bookingType: undefined,
        status: undefined,
        createdFrom: undefined,
        createdTo: undefined,
        reference: undefined,
      },
      2,
    );
  });

  it('passes the type, the status and the reference straight through', async () => {
    await service.listBookings(
      query({
        type: BookingType.HOTEL,
        status: BookingStatus.CANCELLED,
        reference: 'K7M2QX',
      }),
    );

    expect(bookings.listForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingType: BookingType.HOTEL,
        status: BookingStatus.CANCELLED,
        reference: 'K7M2QX',
      }),
      1,
    );
  });

  // Both ends name a whole UTC day, so `to` becomes the start of the next one
  // and a booking made at 23:59 on the last day is still in the range.
  it('turns the day range into a half-open range of instants', async () => {
    await service.listBookings(query({ from: '2026-11-01', to: '2026-11-30' }));

    expect(bookings.listForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        createdFrom: new Date('2026-11-01T00:00:00.000Z'),
        createdTo: new Date('2026-12-01T00:00:00.000Z'),
      }),
      1,
    );
  });

  it('accepts one day as both ends of the range', async () => {
    await service.listBookings(query({ from: '2026-11-19', to: '2026-11-19' }));

    expect(bookings.listForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        createdFrom: new Date('2026-11-19T00:00:00.000Z'),
        createdTo: new Date('2026-11-20T00:00:00.000Z'),
      }),
      1,
    );
  });

  it('refuses a range that ends before it starts', async () => {
    await expect(
      service.listBookings(query({ from: '2026-11-30', to: '2026-11-01' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bookings.listForAdmin).not.toHaveBeenCalled();
  });

  it('maps a row to the documented shape, with the owner resolved', async () => {
    bookings.listForAdmin.mockResolvedValue(
      new PageDto([row()], PageMetaDto.create(1, 1)),
    );
    users.findContactsByIds.mockResolvedValue(new Map([[USER_ID, contact()]]));

    const page = await service.listBookings(query());

    expect(users.findContactsByIds).toHaveBeenCalledWith([USER_ID]);
    expect(page.items).toEqual([
      {
        id: BOOKING_ID,
        type: BookingType.FLIGHT,
        reference: 'K7M2QX',
        user: {
          id: USER_ID,
          name: 'Taher Khalaf',
          email: 'taher@example.com',
        },
        provider: {
          type: ProviderType.AIRLINE,
          id: AIRLINE_ID,
          name: 'KD Airways',
        },
        startsAt: '2026-12-20T06:30:00.000Z',
        endsAt: '2026-12-20T10:30:00.000Z',
        amount: '420.00',
        currency: 'USD',
        status: BookingStatus.CONFIRMED,
        bookedAt: '2026-11-19T08:00:00.000Z',
      },
    ]);
    expect(page.meta.totalItems).toBe(1);
  });

  // A booking outlives the account that made it: the row still has to list,
  // with the user id it carries.
  it('keeps a row whose account has gone, without a name or an address', async () => {
    bookings.listForAdmin.mockResolvedValue(
      new PageDto([row()], PageMetaDto.create(1, 1)),
    );

    const page = await service.listBookings(query());

    expect(page.items[0].user).toEqual({
      id: USER_ID,
      name: null,
      email: null,
    });
  });

  it('resolves the accounts of a page in one query', async () => {
    const other = '6720f1c2a1b2c3d4e5f60009';
    bookings.listForAdmin.mockResolvedValue(
      new PageDto(
        [row(), row({ bookingId: 'b'.repeat(24) }), row({ userId: other })],
        PageMetaDto.create(1, 3),
      ),
    );

    await service.listBookings(query());

    expect(users.findContactsByIds).toHaveBeenCalledTimes(1);
    expect(users.findContactsByIds).toHaveBeenCalledWith([
      USER_ID,
      USER_ID,
      other,
    ]);
  });

  // Money is Decimal128 in the database and a string in the response; the port
  // hands over the string and nothing here turns it into a number.
  it('leaves the amount a string', async () => {
    bookings.listForAdmin.mockResolvedValue(
      new PageDto([row({ totalAmount: '1999.00' })], PageMetaDto.create(1, 1)),
    );

    const page = await service.listBookings(query());

    expect(page.items[0].amount).toBe('1999.00');
  });

  it('shows an unpaid booking with no reference', async () => {
    bookings.listForAdmin.mockResolvedValue(
      new PageDto(
        [
          row({
            bookingReference: null,
            status: BookingStatus.PENDING_PAYMENT,
          }),
        ],
        PageMetaDto.create(1, 1),
      ),
    );

    const page = await service.listBookings(query());

    expect(page.items[0]).toMatchObject({
      reference: null,
      status: BookingStatus.PENDING_PAYMENT,
    });
  });

  it('shows a provider whose row has gone without a name', async () => {
    bookings.listForAdmin.mockResolvedValue(
      new PageDto([row({ providerName: null })], PageMetaDto.create(1, 1)),
    );

    const page = await service.listBookings(query());

    expect(page.items[0].provider).toEqual({
      type: ProviderType.AIRLINE,
      id: AIRLINE_ID,
      name: null,
    });
  });
});
