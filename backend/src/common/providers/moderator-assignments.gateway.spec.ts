import { NotImplementedException } from '@nestjs/common';
import { Role } from '../auth/auth.enums';
import { ModeratorAssignmentsGateway } from './moderator-assignments.gateway';
import type { ModeratorAssignmentPort } from './moderator-assignment.port';

describe('ModeratorAssignmentsGateway (ACC-13)', () => {
  // A plain object of jest.fn()s rather than jest.Mocked<ModeratorAssignmentPort>:
  // referencing an interface's methods in an expectation trips the
  // unbound-method lint rule, and the cast below is what the gateway needs anyway.
  function port() {
    return {
      assertAssignable: jest.fn().mockResolvedValue(undefined),
      assign: jest.fn().mockResolvedValue(undefined),
    };
  }

  function gatewayWith(
    airline?: ReturnType<typeof port>,
    hotel?: ReturnType<typeof port>,
  ): ModeratorAssignmentsGateway {
    return new ModeratorAssignmentsGateway(
      airline as unknown as ModeratorAssignmentPort | undefined,
      hotel as unknown as ModeratorAssignmentPort | undefined,
    );
  }

  it('reports which provider types are wired in', () => {
    const gateway = gatewayWith(port(), undefined);

    expect(gateway.supports(Role.AIRLINE_MODERATOR)).toBe(true);
    expect(gateway.supports(Role.HOTEL_MODERATOR)).toBe(false);
  });

  it('sends an airline moderator to the airline port only', async () => {
    const airline = port();
    const hotel = port();
    const gateway = gatewayWith(airline, hotel);

    await gateway.assertAssignable(Role.AIRLINE_MODERATOR, 'air1', 'admin1');
    await gateway.assign(Role.AIRLINE_MODERATOR, 'mod1', 'air1');

    expect(airline.assertAssignable.mock.calls).toEqual([['air1', 'admin1']]);
    expect(airline.assign.mock.calls).toEqual([['mod1', 'air1']]);
    expect(hotel.assertAssignable.mock.calls).toEqual([]);
    expect(hotel.assign.mock.calls).toEqual([]);
  });

  it('sends a hotel moderator to the hotel port only', async () => {
    const airline = port();
    const hotel = port();
    const gateway = gatewayWith(airline, hotel);

    await gateway.assertAssignable(Role.HOTEL_MODERATOR, 'hot1', 'admin1');
    await gateway.assign(Role.HOTEL_MODERATOR, 'mod1', 'hot1');

    expect(hotel.assertAssignable.mock.calls).toEqual([['hot1', 'admin1']]);
    expect(hotel.assign.mock.calls).toEqual([['mod1', 'hot1']]);
    expect(airline.assertAssignable.mock.calls).toEqual([]);
  });

  // The state the repository is in today: flights exists, hotels does not.
  it('answers 501 PROVIDER_TYPE_UNAVAILABLE for an unwired type', async () => {
    const gateway = gatewayWith(port(), undefined);

    await expect(
      gateway.assertAssignable(Role.HOTEL_MODERATOR, 'hot1', 'admin1'),
    ).rejects.toMatchObject({
      status: 501,
      response: { code: 'PROVIDER_TYPE_UNAVAILABLE' },
    });
    await expect(
      gateway.assign(Role.HOTEL_MODERATOR, 'mod1', 'hot1'),
    ).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('answers 501 for both types when neither is wired in', async () => {
    const gateway = gatewayWith(undefined, undefined);

    expect(gateway.supports(Role.AIRLINE_MODERATOR)).toBe(false);
    await expect(
      gateway.assertAssignable(Role.AIRLINE_MODERATOR, 'air1', 'admin1'),
    ).rejects.toBeInstanceOf(NotImplementedException);
  });
});
