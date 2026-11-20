import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from '../common/auth/auth.enums';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { AdminProvidersController } from './admin-providers.controller';
import { AdminProvidersService } from './admin-providers.service';
import {
  AdminProviderParamsDto,
  AdminProviderStatusDto,
  ProviderType,
} from './dto/admin-provider.dto';

const ID = '6720f1c2a1b2c3d4e5f60788';

describe('AdminProviderParamsDto (ACC-15)', () => {
  async function errorsFor(plain: object) {
    const errors = await validate(
      plainToInstance(AdminProviderParamsDto, plain),
    );
    return errors.map((error) => ({
      field: error.property,
      messages: Object.values(error.constraints ?? {}),
    }));
  }

  it.each([ProviderType.HOTEL, ProviderType.AIRLINE])(
    'accepts type %s',
    async (type) => {
      expect(await errorsFor({ type, id: ID })).toEqual([]);
    },
  );

  it.each(['train', 'HOTEL', 'hotels', ''])(
    'rejects type %p with a field error on type',
    async (type) => {
      expect(await errorsFor({ type, id: ID })).toEqual([
        { field: 'type', messages: ['type must be hotel or airline'] },
      ]);
    },
  );

  // A malformed id is not a 400: it answers the same 404 as a missing provider.
  it('leaves a malformed id to the service', async () => {
    expect(
      await errorsFor({ type: ProviderType.HOTEL, id: 'not-an-id' }),
    ).toEqual([]);
  });
});

describe('AdminProvidersController (ACC-15)', () => {
  const admin: AuthenticatedUser = {
    userId: '6720f1c2a1b2c3d4e5f60001',
    role: Role.ADMIN,
    sessionId: '6720f1c2a1b2c3d4e5f60999',
  };
  const answer = new AdminProviderStatusDto();

  function setup() {
    const providers = {
      deactivate: jest.fn().mockResolvedValue(answer),
      reactivate: jest.fn().mockResolvedValue(answer),
    };
    const controller = new AdminProvidersController(
      providers as unknown as AdminProvidersService,
    );
    return { controller, providers };
  }

  it('deactivate passes the admin, the type and the id to the service', async () => {
    const { controller, providers } = setup();

    await expect(
      controller.deactivate(admin, { type: ProviderType.AIRLINE, id: ID }),
    ).resolves.toBe(answer);
    expect(providers.deactivate).toHaveBeenCalledWith(
      admin.userId,
      ProviderType.AIRLINE,
      ID,
    );
  });

  it('reactivate passes the admin, the type and the id to the service', async () => {
    const { controller, providers } = setup();

    await expect(
      controller.reactivate(admin, { type: ProviderType.HOTEL, id: ID }),
    ).resolves.toBe(answer);
    expect(providers.reactivate).toHaveBeenCalledWith(
      admin.userId,
      ProviderType.HOTEL,
      ID,
    );
  });
});
