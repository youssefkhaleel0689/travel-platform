import { NotFoundException, NotImplementedException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingPaymentGateway } from './booking-payment.gateway';
import {
  BookingPaymentPort,
  HoldReleaseReason,
} from './booking-payment.port';
import { BookingStatus, BookingType, ProviderType } from './booking-status';

describe('BookingPaymentGateway (GEN-11)', () => {
  const BOOKING_ID = new Types.ObjectId().toString();

  // A plain record of jest mocks rather than jest.Mocked<BookingPaymentPort>:
  // reading an interface method off a typed mock trips the unbound-method lint
  // rule on every assertion, and the cast at the call site costs nothing.
  interface PortStub {
    findPayable: jest.Mock;
    findPolicies: jest.Mock;
    confirmAfterPayment: jest.Mock;
    releaseHold: jest.Mock;
  }

  const asPort = (stub: PortStub): BookingPaymentPort =>
    stub as unknown as BookingPaymentPort;

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
    };
  }

  describe('with no booking module wired in', () => {
    const gateway = new BookingPaymentGateway();

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
    let gateway: BookingPaymentGateway;

    beforeEach(() => {
      hotelPort = portStub();
      gateway = new BookingPaymentGateway(undefined, asPort(hotelPort));
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
      const gateway = new BookingPaymentGateway(
        asPort(flightPort),
        asPort(hotelPort),
      );

      await gateway.getPayableOrThrow(BookingType.FLIGHT, BOOKING_ID);

      expect(flightPort.findPayable).toHaveBeenCalledTimes(1);
      expect(hotelPort.findPayable).not.toHaveBeenCalled();
    });
  });
});
