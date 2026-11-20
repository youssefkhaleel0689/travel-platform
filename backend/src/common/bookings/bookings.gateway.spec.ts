import { NotFoundException, NotImplementedException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingsGateway } from './bookings.gateway';
import {
  BookingsPort,
  HoldReleaseReason,
} from './bookings.port';
import { BookingStatus, BookingType, ProviderType } from './booking-status';

describe('BookingsGateway (GEN-11)', () => {
  const BOOKING_ID = new Types.ObjectId().toString();

  // A plain record of jest mocks rather than jest.Mocked<BookingsPort>:
  // reading an interface method off a typed mock trips the unbound-method lint
  // rule on every assertion, and the cast at the call site costs nothing.
  interface PortStub {
    findPayable: jest.Mock;
    findPolicies: jest.Mock;
    confirmAfterPayment: jest.Mock;
    releaseHold: jest.Mock;
    hasUpcomingConfirmedBookings: jest.Mock;
    listForAdmin: jest.Mock;
  }

  const asPort = (stub: PortStub): BookingsPort =>
    stub as unknown as BookingsPort;

  function portStub(): PortStub {
    return {
      findPayable: jest.fn().mockResolvedValue({
        bookingId: BOOKING_ID,
        bookingType: BookingType.HOTEL,
        userId: new Types.ObjectId().toString(),
        status: BookingStatus.PENDING_PAYMENT,
        totalAmount: '199.99',
        currency: 'USD',
        holdExpiresAt: new Date(),
        bookingReference: null,
        providerType: ProviderType.HOTEL,
        providerId: new Types.ObjectId().toString(),
      }),
      findPolicies: jest.fn().mockResolvedValue({
        bookingId: BOOKING_ID,
        bookingType: BookingType.HOTEL,
        providerType: ProviderType.HOTEL,
        providerId: new Types.ObjectId().toString(),
        policyVersion: 2,
        policySnapshot: { checkInTime: '14:00' },
      }),
      confirmAfterPayment: jest.fn().mockResolvedValue({
        bookingId: BOOKING_ID,
        status: BookingStatus.CONFIRMED,
        bookingReference: 'NILE-4821',
      }),
      releaseHold: jest.fn().mockResolvedValue(undefined),
      hasUpcomingConfirmedBookings: jest.fn().mockResolvedValue(false),
      listForAdmin: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    };
  }

  describe('with no booking module wired in', () => {
    const gateway = new BookingsGateway();

    // ACC-12 must not become impossible because a module is still being built.
    it('reports no upcoming bookings when nothing is wired in', async () => {
      await expect(
        gateway.hasUpcomingConfirmedBookings('6720f1c2a1b2c3d4e5f60001'),
      ).resolves.toBe(false);
    });

    it('reports both types as unsupported', () => {
      expect(gateway.supports(BookingType.FLIGHT)).toBe(false);
      expect(gateway.supports(BookingType.HOTEL)).toBe(false);
    });

    // 501 with a clear code, not a 500 that looks like a bug in payments.
    it.each([BookingType.FLIGHT, BookingType.HOTEL])(
      'answers 501 for %s',
      async (bookingType) => {
        await expect(
          gateway.getPayableOrThrow(bookingType, BOOKING_ID),
        ).rejects.toThrow(NotImplementedException);
        await expect(
          gateway.getPayableOrThrow(bookingType, BOOKING_ID),
        ).rejects.toMatchObject({
          response: { code: 'BOOKING_TYPE_UNAVAILABLE' },
        });
      },
    );
  });

  describe('with only the hotels module wired in', () => {
    let hotelPort: PortStub;
    let gateway: BookingsGateway;

    beforeEach(() => {
      hotelPort = portStub();
      gateway = new BookingsGateway(undefined, asPort(hotelPort));
    });

    it('supports hotels and not flights', () => {
      expect(gateway.supports(BookingType.HOTEL)).toBe(true);
      expect(gateway.supports(BookingType.FLIGHT)).toBe(false);
    });

    it('routes every call to the hotel port', async () => {
      await gateway.getPayableOrThrow(BookingType.HOTEL, BOOKING_ID);
      await gateway.getPoliciesOrThrow(BookingType.HOTEL, BOOKING_ID);
      await gateway.confirmAfterPayment(
        BookingType.HOTEL,
        BOOKING_ID,
        'payment-1',
      );
      await gateway.releaseHold(
        BookingType.HOTEL,
        BOOKING_ID,
        HoldReleaseReason.HOLD_EXPIRED,
      );

      expect(hotelPort.findPayable).toHaveBeenCalledWith(BOOKING_ID);
      expect(hotelPort.findPolicies).toHaveBeenCalledWith(BOOKING_ID);
      expect(hotelPort.confirmAfterPayment).toHaveBeenCalledWith(
        BOOKING_ID,
        'payment-1',
      );
      expect(hotelPort.releaseHold).toHaveBeenCalledWith(
        BOOKING_ID,
        HoldReleaseReason.HOLD_EXPIRED,
      );
    });

    it('answers 404 when the port has no such booking', async () => {
      hotelPort.findPayable.mockResolvedValue(null);

      await expect(
        gateway.getPayableOrThrow(BookingType.HOTEL, BOOKING_ID),
      ).rejects.toThrow(NotFoundException);
    });

    // A malformed id gives the same answer as an unknown one, so the format
    // cannot be probed, and the port is never called with rubbish.
    it('answers 404 for a malformed id without calling the port', async () => {
      await expect(
        gateway.getPayableOrThrow(BookingType.HOTEL, 'not-an-id'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        gateway.getPoliciesOrThrow(BookingType.HOTEL, 'not-an-id'),
      ).rejects.toThrow(NotFoundException);
      expect(hotelPort.findPayable).not.toHaveBeenCalled();
      expect(hotelPort.findPolicies).not.toHaveBeenCalled();
    });

    it('asks the wired module about upcoming bookings (ACC-12)', async () => {
      hotelPort.hasUpcomingConfirmedBookings.mockResolvedValue(true);

      await expect(
        gateway.hasUpcomingConfirmedBookings('6720f1c2a1b2c3d4e5f60001'),
      ).resolves.toBe(true);
      expect(hotelPort.hasUpcomingConfirmedBookings).toHaveBeenCalledWith(
        '6720f1c2a1b2c3d4e5f60001',
      );
    });

    it('still answers 501 for a flight booking', async () => {
      await expect(
        gateway.getPayableOrThrow(BookingType.FLIGHT, BOOKING_ID),
      ).rejects.toThrow(NotImplementedException);
      expect(hotelPort.findPayable).not.toHaveBeenCalled();
    });
  });

  describe('with both modules wired in', () => {
    it('keeps the two types apart', async () => {
      const flightPort = portStub();
      const hotelPort = portStub();
      const gateway = new BookingsGateway(
        asPort(flightPort),
        asPort(hotelPort),
      );

      await gateway.getPayableOrThrow(BookingType.FLIGHT, BOOKING_ID);

      expect(flightPort.findPayable).toHaveBeenCalledTimes(1);
      expect(hotelPort.findPayable).not.toHaveBeenCalled();
    });

    // One upcoming booking anywhere is enough to block a deactivation.
    it('blocks deactivation when either module says yes (ACC-12)', async () => {
      const flightPort = portStub();
      const hotelPort = portStub();
      flightPort.hasUpcomingConfirmedBookings.mockResolvedValue(false);
      hotelPort.hasUpcomingConfirmedBookings.mockResolvedValue(true);
      const gateway = new BookingsGateway(
        asPort(flightPort),
        asPort(hotelPort),
      );

      await expect(
        gateway.hasUpcomingConfirmedBookings('6720f1c2a1b2c3d4e5f60001'),
      ).resolves.toBe(true);
      // Both are asked, in parallel, not short-circuited by order.
      expect(flightPort.hasUpcomingConfirmedBookings).toHaveBeenCalled();
      expect(hotelPort.hasUpcomingConfirmedBookings).toHaveBeenCalled();
    });
  });
  // ACC-17: the admin list is the one place both collections are read at once.
  describe('listForAdmin (ACC-17)', () => {
    // A row made at `minutesAgo` minutes before a fixed instant.
    const NOW = new Date('2026-11-19T12:00:00.000Z');

    function row(bookingType: BookingType, minutesAgo: number, id = String(minutesAgo).padStart(24, 'a')) {
      return {
        bookingId: id,
        bookingType,
        bookingReference: null,
        userId: '6720f1c2a1b2c3d4e5f60001',
        providerType:
          bookingType === BookingType.FLIGHT
            ? ProviderType.AIRLINE
            : ProviderType.HOTEL,
        providerId: '6720f1c2a1b2c3d4e5f60002',
        providerName: 'Provider',
        startsAt: NOW,
        endsAt: NOW,
        totalAmount: '100.00',
        currency: 'USD',
        status: BookingStatus.CONFIRMED,
        createdAt: new Date(NOW.getTime() - minutesAgo * 60_000),
      };
    }

    it('returns an empty page when no module is wired in', async () => {
      const page = await new BookingsGateway().listForAdmin({}, 1);

      expect(page.items).toEqual([]);
      expect(page.meta).toMatchObject({ totalItems: 0, totalPages: 0 });
    });

    // listForAdmin is the one optional method on the port: a module that has
    // not implemented it yet still works for payments and ACC-12, and simply
    // does not appear in the admin list.
    it('skips a wired port that does not implement listForAdmin', async () => {
      const older = portStub();
      delete (older as Partial<PortStub>).listForAdmin;
      const hotelPort = portStub();
      hotelPort.listForAdmin.mockResolvedValue({
        rows: [row(BookingType.HOTEL, 1)],
        total: 1,
      });
      const gateway = new BookingsGateway(asPort(older), asPort(hotelPort));

      const page = await gateway.listForAdmin({}, 1);

      expect(page.items).toHaveLength(1);
      expect(page.items[0].bookingType).toBe(BookingType.HOTEL);
      expect(page.meta.totalItems).toBe(1);
    });

    it('gives an empty page for a type whose port cannot list yet', async () => {
      const older = portStub();
      delete (older as Partial<PortStub>).listForAdmin;
      const gateway = new BookingsGateway(asPort(older), undefined);

      const page = await gateway.listForAdmin(
        { bookingType: BookingType.FLIGHT },
        1,
      );

      expect(page.items).toEqual([]);
      expect(page.meta.totalItems).toBe(0);
    });

    it('merges both modules newest first and counts them together', async () => {
      const flightPort = portStub();
      const hotelPort = portStub();
      flightPort.listForAdmin.mockResolvedValue({
        rows: [row(BookingType.FLIGHT, 1), row(BookingType.FLIGHT, 3)],
        total: 7,
      });
      hotelPort.listForAdmin.mockResolvedValue({
        rows: [row(BookingType.HOTEL, 2), row(BookingType.HOTEL, 4)],
        total: 5,
      });
      const gateway = new BookingsGateway(asPort(flightPort), asPort(hotelPort));

      const page = await gateway.listForAdmin({}, 1);

      expect(page.items.map((item) => item.bookingType)).toEqual([
        BookingType.FLIGHT,
        BookingType.HOTEL,
        BookingType.FLIGHT,
        BookingType.HOTEL,
      ]);
      expect(page.meta.totalItems).toBe(12);
    });

    // Each module is asked for page x 10 rows, because the first ten of the
    // merged list can all come from one module.
    it('asks each module for enough rows to cover the page', async () => {
      const flightPort = portStub();
      const hotelPort = portStub();
      const gateway = new BookingsGateway(asPort(flightPort), asPort(hotelPort));

      await gateway.listForAdmin({ status: BookingStatus.CONFIRMED }, 3);

      for (const port of [flightPort, hotelPort]) {
        expect(port.listForAdmin).toHaveBeenCalledWith({
          status: BookingStatus.CONFIRMED,
          createdFrom: undefined,
          createdTo: undefined,
          reference: undefined,
          limit: 30,
        });
      }
    });

    it('keeps only the rows of the page asked for', async () => {
      const flightPort = portStub();
      flightPort.listForAdmin.mockResolvedValue({
        rows: Array.from({ length: 20 }, (_, i) =>
          row(BookingType.FLIGHT, i, String(i).padStart(24, 'b')),
        ),
        total: 20,
      });
      const gateway = new BookingsGateway(asPort(flightPort), undefined);

      const page = await gateway.listForAdmin({}, 2);

      expect(page.items).toHaveLength(10);
      expect(page.items[0].bookingId).toBe(String(10).padStart(24, 'b'));
      expect(page.meta).toMatchObject({
        page: 2,
        totalItems: 20,
        totalPages: 2,
        hasNextPage: false,
        hasPreviousPage: true,
      });
    });

    it('asks only the module that owns the type when one is given', async () => {
      const flightPort = portStub();
      const hotelPort = portStub();
      const gateway = new BookingsGateway(asPort(flightPort), asPort(hotelPort));

      await gateway.listForAdmin({ bookingType: BookingType.HOTEL }, 1);

      expect(flightPort.listForAdmin).not.toHaveBeenCalled();
      expect(hotelPort.listForAdmin).toHaveBeenCalled();
    });

    // 501 would be wrong here: an admin list must still answer while a module
    // is being built, and a module that is not wired in has no bookings.
    it('gives an empty page for a type whose module is missing', async () => {
      const hotelPort = portStub();
      hotelPort.listForAdmin.mockResolvedValue({
        rows: [row(BookingType.HOTEL, 1)],
        total: 1,
      });
      const gateway = new BookingsGateway(undefined, asPort(hotelPort));

      const page = await gateway.listForAdmin(
        { bookingType: BookingType.FLIGHT },
        1,
      );

      expect(page.items).toEqual([]);
      expect(page.meta.totalItems).toBe(0);
    });

    // Two bookings made in the same millisecond, one per collection: the order
    // has to be the same every time or a row could repeat or vanish.
    it('breaks a tie on the booking id, not on which module answered first', async () => {
      const flightPort = portStub();
      const hotelPort = portStub();
      flightPort.listForAdmin.mockResolvedValue({
        rows: [row(BookingType.FLIGHT, 5, 'a'.repeat(24))],
        total: 1,
      });
      hotelPort.listForAdmin.mockResolvedValue({
        rows: [row(BookingType.HOTEL, 5, 'f'.repeat(24))],
        total: 1,
      });
      const gateway = new BookingsGateway(asPort(flightPort), asPort(hotelPort));

      const page = await gateway.listForAdmin({}, 1);

      expect(page.items.map((item) => item.bookingId)).toEqual([
        'f'.repeat(24),
        'a'.repeat(24),
      ]);
    });
  });
});
