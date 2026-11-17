import {
  fromStripeStatus,
  OPEN_PAYMENT_STATUSES,
  PAYMENT_STATUSES,
  PaymentStatus,
  TERMINAL_PAYMENT_STATUSES,
} from './payment-status.enum';

describe('payment status (PAY-01)', () => {
  it('has exactly the five states of the data model', () => {
    expect(PAYMENT_STATUSES).toEqual([
      'REQUIRES_PAYMENT_METHOD',
      'PROCESSING',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
    ]);
  });

  it('splits the states into open and terminal with nothing left over', () => {
    expect([...OPEN_PAYMENT_STATUSES, ...TERMINAL_PAYMENT_STATUSES].sort()).toEqual(
      [...PAYMENT_STATUSES].sort(),
    );
  });

  describe('fromStripeStatus', () => {
    it.each([
      ['succeeded', PaymentStatus.SUCCEEDED],
      ['processing', PaymentStatus.PROCESSING],
      ['canceled', PaymentStatus.CANCELLED],
    ])('maps %s to %s', (stripeStatus, expected) => {
      expect(fromStripeStatus(stripeStatus)).toBe(expected);
    });

    // All four mean the same thing here: the money has not been taken and the
    // user still has something to do.
    it.each([
      'requires_payment_method',
      'requires_confirmation',
      'requires_action',
      'requires_capture',
    ])('maps %s to REQUIRES_PAYMENT_METHOD', (stripeStatus) => {
      expect(fromStripeStatus(stripeStatus)).toBe(
        PaymentStatus.REQUIRES_PAYMENT_METHOD,
      );
    });

    // The safe direction: a booking stays unconfirmed and the user can retry,
    // rather than a booking being confirmed without money.
    it.each(['', 'something_new', 'SUCCEEDED', 'succeeded '])(
      'maps the unknown status "%s" to FAILED, never to SUCCEEDED',
      (stripeStatus) => {
        expect(fromStripeStatus(stripeStatus)).toBe(PaymentStatus.FAILED);
      },
    );
  });
});
