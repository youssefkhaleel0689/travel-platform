import {
  addMoney,
  formatMoney,
  parseMoney,
  percentageOf,
} from '../../common/money/money';
import { parseLocalDate } from '../../common/time/local-date-time';
import { PassengerType } from '../schemas/flight-booking.schema';

// FLT-12: ages on the outbound departure date. Adult 12+, child 2 to 11, infant under 2.
export const ADULT_MIN_AGE = 12;
export const CHILD_MIN_AGE = 2;

// FLT-12: an infant pays 10% of the fare and takes no seat.
export const INFANT_FARE_PERCENTAGE = 10;

/**
 * The passenger type someone born on `dateOfBirth` has on `onDate` (both "YYYY-MM-DD", the
 * second being the outbound departure date at the departure airport), or null when they
 * are born after that date. Whole calendar years, compared as dates, never in days: a day
 * count would be wrong across leap years. Someone born on 29 February is a year older from
 * 1 March in other years.
 */
export function passengerTypeOn(
  dateOfBirth: string,
  onDate: string,
): PassengerType | null {
  const born = parseLocalDate(dateOfBirth);
  const on = parseLocalDate(onDate);
  if (!born || !on) {
    // The DTO and the flight schema both validate these dates, so this is a bug.
    throw new Error(`Not a calendar date: ${dateOfBirth} or ${onDate}`);
  }
  // "YYYY-MM-DD" strings sort in date order.
  if (dateOfBirth > onDate) {
    return null;
  }
  const hadBirthdayThisYear =
    on.month > born.month || (on.month === born.month && on.day >= born.day);
  const age = on.year - born.year - (hadBirthdayThisYear ? 0 : 1);

  if (age >= ADULT_MIN_AGE) {
    return PassengerType.ADULT;
  }
  return age >= CHILD_MIN_AGE ? PassengerType.CHILD : PassengerType.INFANT;
}

/** What one passenger costs on one segment: the cabin price, 10% of it for an infant. */
export function fareFor(
  passengerType: PassengerType,
  cabinPrice: string,
): string {
  return passengerType === PassengerType.INFANT
    ? percentageOf(cabinPrice, INFANT_FARE_PERCENTAGE)
    : formatMoney(cabinPrice);
}

export interface PricedPassenger {
  passengerType: PassengerType;
  // 0 when the passenger buys no extra bag.
  extraBagCount: number;
}

export interface BookingPrice {
  // One per passenger, in the order given: the fare over all segments.
  fares: string[];
  // One per passenger, in the order given: the extra-bag fee over all segments.
  bagFees: string[];
  subtotal: string;
  baggageTotal: string;
  total: string;
}

/**
 * The price of a booking (FLT-12, FLT-19, FLT-21), as money strings with 2 decimals and
 * never through a float (PAY-04). `segmentPrices` are the cabin prices per seat of the
 * booked segments, outbound first. An infant's 10% is rounded half up per segment, the way
 * each segment would be invoiced. An extra bag flies every segment, so it is charged once
 * per segment at the booking's `extraBagPrice` (the outbound airline's, FLT-08).
 */
export function priceBooking(
  segmentPrices: readonly string[],
  passengers: readonly PricedPassenger[],
  extraBagPrice: string | null,
): BookingPrice {
  // The DTO guarantees both; an empty list here is a bug in the caller.
  if (segmentPrices.length === 0 || passengers.length === 0) {
    throw new Error('A booking has at least one segment and one passenger');
  }

  const fares = passengers.map((passenger) =>
    segmentPrices
      .map((price) => fareFor(passenger.passengerType, price))
      .reduce(addMoney),
  );

  const bagFees = passengers.map(({ extraBagCount }) => {
    if (extraBagCount === 0) {
      return formatMoney('0');
    }
    if (extraBagPrice === null) {
      // The service refuses extra bags when the airline sells none, before pricing.
      throw new Error('Extra bags were priced without an extra-bag price');
    }
    return formatMoney(
      parseMoney(extraBagPrice).times(extraBagCount * segmentPrices.length),
    );
  });

  const subtotal = fares.reduce(addMoney);
  const baggageTotal = bagFees.reduce(addMoney, formatMoney('0'));
  return {
    fares,
    bagFees,
    subtotal,
    baggageTotal,
    total: addMoney(subtotal, baggageTotal),
  };
}
