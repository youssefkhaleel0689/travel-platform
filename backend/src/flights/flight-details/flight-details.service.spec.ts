import { HttpException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import type { ReferenceDataService } from '../../common/reference-data/reference-data.service';
import type { AirlinePoliciesService } from '../policies/airline-policies.service';
import { Airline, AirlineStatus } from '../schemas/airline.schema';
import { CabinCategory, Flight, FlightStatus } from '../schemas/flight.schema';
import { FlightDetailsService } from './flight-details.service';

const FLIGHT_ID = new Types.ObjectId();
const AIRLINE_ID = new Types.ObjectId();
const ZONES: Record<string, string> = {
  CAI: 'Africa/Cairo',
  DXB: 'Asia/Dubai',
};

function makeFlight(status = FlightStatus.SCHEDULED): Flight {
  return {
    _id: FLIGHT_ID,
    airlineId: AIRLINE_ID,
    flightNumber: 'MS910',
    departureAirportId: 'CAI',
    arrivalAirportId: 'DXB',
    departureAtUtc: new Date('2026-12-20T06:30:00.000Z'),
    arrivalAtUtc: new Date('2026-12-20T10:30:00.000Z'),
    status,
    cabinInventory: [
      {
        category: CabinCategory.ECONOMY,
        totalSeats: 10,
        bookedSeats: 2,
        heldSeats: 1,
        price: Types.Decimal128.fromString('199.99'),
        freeBaggageCount: 1,
        maxBagWeightKg: 23,
      },
    ],
  } as unknown as Flight;
}
const FLIGHT = makeFlight();

// A query stand-in: lean() and exec() resolve to the given result.
function query<R>(result: R) {
  const chain = {
    lean: () => chain,
    exec: () => Promise.resolve(result),
  };
  return chain;
}

function setup(
  options: {
    flight?: Flight | null;
    airlineStatus?: AirlineStatus | null;
  } = {},
) {
  const flight = options.flight === undefined ? FLIGHT : options.flight;
  const airlineStatus =
    options.airlineStatus === undefined
      ? AirlineStatus.ACTIVE
      : options.airlineStatus;
  const flightModel = { findById: jest.fn(() => query(flight)) };
  const airlineModel = {
    findById: jest.fn(() =>
      query(
        airlineStatus
          ? {
              _id: AIRLINE_ID,
              name: 'EgyptAir',
              iataCode: 'MS',
              status: airlineStatus,
            }
          : null,
      ),
    ),
  };
  const referenceData = {
    getAirportOrThrow: jest.fn((id: string) =>
      Promise.resolve({
        id,
        name: `${id} airport`,
        cityId: id.toLowerCase(),
        countryId: 'XX',
        timeZone: ZONES[id],
      }),
    ),
  };
  const airlinePolicies = {
    getForAirline: jest.fn(() => Promise.resolve(null)),
  };
  const service = new FlightDetailsService(
    flightModel as unknown as Model<Flight>,
    airlineModel as unknown as Model<Airline>,
    referenceData as unknown as ReferenceDataService,
    airlinePolicies as unknown as AirlinePoliciesService,
  );
  return { service, flightModel, airlineModel, airlinePolicies };
}

async function failure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('expected the call to fail');
}

describe('FlightDetailsService (FLT-17)', () => {
  it("returns the flight with its airline, airports and the airline's policy", async () => {
    const { service, airlineModel, airlinePolicies } = setup();

    const details = await service.getDetails(FLIGHT_ID.toString());

    expect(airlineModel.findById).toHaveBeenCalledWith(AIRLINE_ID, {
      name: 1,
      iataCode: 1,
      status: 1,
    });
    expect(airlinePolicies.getForAirline).toHaveBeenCalledWith(AIRLINE_ID);
    expect(details).toMatchObject({
      id: FLIGHT_ID.toString(),
      airline: { id: AIRLINE_ID.toString(), name: 'EgyptAir', iataCode: 'MS' },
      departureAirport: { id: 'CAI', timeZone: 'Africa/Cairo' },
      arrivalAirport: { id: 'DXB', timeZone: 'Asia/Dubai' },
      departureLocalTime: '2026-12-20T08:30:00+02:00',
      cabins: [{ category: CabinCategory.ECONOMY, seatsRemaining: 7 }],
      policy: { extraBagPrice: null, cancellationTiers: [] },
    });
  });

  it('shows a cancelled flight with its status, so an old link still explains itself', async () => {
    const { service } = setup({
      flight: makeFlight(FlightStatus.CANCELLED),
    });

    const details = await service.getDetails(FLIGHT_ID.toString());

    expect(details.status).toBe(FlightStatus.CANCELLED);
  });

  it.each([
    ['a flight that does not exist', { flight: null }],
    [
      'a flight of a deactivated airline (ACC-15)',
      { airlineStatus: AirlineStatus.DEACTIVATED },
    ],
    ['a flight whose airline is missing', { airlineStatus: null }],
  ])('answers 404 FLIGHT_NOT_FOUND for %s', async (_case, options) => {
    const { service } = setup(options);

    const error = await failure(service.getDetails(FLIGHT_ID.toString()));

    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toEqual({
      code: 'FLIGHT_NOT_FOUND',
      message: 'Flight not found',
    });
  });

  it('answers 404 for a malformed id without querying', async () => {
    const { service, flightModel } = setup();

    const error = await failure(service.getDetails('search-me'));

    expect(error.getStatus()).toBe(404);
    expect(flightModel.findById).not.toHaveBeenCalled();
  });
});
