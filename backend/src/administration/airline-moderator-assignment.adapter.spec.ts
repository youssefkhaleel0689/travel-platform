import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AirlinesService } from '../flights/airlines/airlines.service';
import { AirlineStatus } from '../flights/schemas/airline.schema';
import { AirlineModeratorAssignmentAdapter } from './airline-moderator-assignment.adapter';

describe('AirlineModeratorAssignmentAdapter (ACC-13)', () => {
  const ADMIN_ID = '6720f1c2a1b2c3d4e5f60001';
  const MODERATOR_ID = '6720f1c2a1b2c3d4e5f60002';
  const AIRLINE_ID = '6720f1c2a1b2c3d4e5f60777';

  let airlines: jest.Mocked<Pick<AirlinesService, 'findOne' | 'assignModerator'>>;
  let adapter: AirlineModeratorAssignmentAdapter;

  function airline(status = AirlineStatus.ACTIVE) {
    return {
      id: AIRLINE_ID,
      name: 'Nile Air',
      iataCode: 'NL',
      icaoCode: null,
      logo: null,
      status,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    };
  }

  beforeEach(() => {
    airlines = {
      findOne: jest.fn().mockResolvedValue(airline()),
      assignModerator: jest.fn().mockResolvedValue(undefined),
    };
    adapter = new AirlineModeratorAssignmentAdapter(
      airlines as unknown as AirlinesService,
    );
  });

  it('accepts an active airline', async () => {
    await expect(
      adapter.assertAssignable(AIRLINE_ID, ADMIN_ID),
    ).resolves.toBeUndefined();
  });

  // As the admin, so a deactivated airline is visible instead of 404.
  it('looks the airline up as the acting admin', async () => {
    await adapter.assertAssignable(AIRLINE_ID, ADMIN_ID);

    expect(airlines.findOne).toHaveBeenCalledWith(AIRLINE_ID, {
      userId: ADMIN_ID,
      role: 'ADMIN',
    });
  });

  it('rejects a deactivated airline with 400 PROVIDER_DEACTIVATED', async () => {
    airlines.findOne.mockResolvedValue(
      airline(AirlineStatus.DEACTIVATED) as never,
    );

    await expect(
      adapter.assertAssignable(AIRLINE_ID, ADMIN_ID),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'PROVIDER_DEACTIVATED' },
    });
    expect(
      (await adapter
        .assertAssignable(AIRLINE_ID, ADMIN_ID)
        .catch((e: unknown) => e)) instanceof BadRequestException,
    ).toBe(true);
  });

  // AirlinesService owns the 404, so the adapter passes it straight through.
  it('passes an unknown airline through as 404', async () => {
    airlines.findOne.mockRejectedValue(
      new NotFoundException({
        code: 'AIRLINE_NOT_FOUND',
        message: 'Airline not found',
      }),
    );

    await expect(
      adapter.assertAssignable(AIRLINE_ID, ADMIN_ID),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: 'AIRLINE_NOT_FOUND' },
    });
  });

  it('writes the link through the service that owns the collection', async () => {
    await adapter.assign(MODERATOR_ID, AIRLINE_ID);

    expect(airlines.assignModerator).toHaveBeenCalledWith(
      MODERATOR_ID,
      AIRLINE_ID,
    );
  });
});
