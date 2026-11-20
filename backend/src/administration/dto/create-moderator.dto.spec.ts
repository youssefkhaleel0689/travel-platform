import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from '../../common/auth/auth.enums';
import { CreateModeratorDto } from './create-moderator.dto';

/**
 * ACC-13's body rule: the provider id that matches the selected role is
 * required, and the other one must not be sent at all.
 *
 * The obsolete `providerId` field is not tested here. Rejecting an unknown
 * property is ValidationPipe's forbidNonWhitelisted rather than a decorator on
 * the DTO, so it is proved over HTTP in test/admin-moderators.e2e-spec.ts.
 */
describe('CreateModeratorDto (ACC-13)', () => {
  const AIRLINE_ID = '6720f1c2a1b2c3d4e5f60777';
  const HOTEL_ID = '6720f1c2a1b2c3d4e5f60788';

  function airlineBody(overrides: object = {}) {
    return {
      name: 'Omar Fathy',
      email: 'omar@airline.example.com',
      role: Role.AIRLINE_MODERATOR,
      airlineId: AIRLINE_ID,
      ...overrides,
    };
  }

  async function errorsFor(plain: object) {
    return validate(plainToInstance(CreateModeratorDto, plain));
  }

  async function errorFields(plain: object): Promise<string[]> {
    const errors = await errorsFor(plain);
    return errors.map((error) => error.property).sort();
  }

  async function messagesFor(plain: object, field: string): Promise<string[]> {
    const errors = await errorsFor(plain);
    const match = errors.find((error) => error.property === field);
    return Object.values(match?.constraints ?? {});
  }

  it('accepts an airline moderator named by airlineId', async () => {
    expect(await errorFields(airlineBody())).toEqual([]);
  });

  it('accepts a hotel moderator named by hotelId', async () => {
    expect(
      await errorFields({
        name: 'Omar Fathy',
        email: 'omar@hotel.example.com',
        role: Role.HOTEL_MODERATOR,
        hotelId: HOTEL_ID,
      }),
    ).toEqual([]);
  });

  it('accepts an optional password and trims and lower-cases the email', async () => {
    const dto = plainToInstance(
      CreateModeratorDto,
      airlineBody({
        email: '  Omar@Airline.Example.COM ',
        password: 'Welcome2026',
      }),
    );
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.email).toBe('omar@airline.example.com');
  });

  it('requires airlineId for an airline moderator', async () => {
    expect(await errorFields(airlineBody({ airlineId: undefined }))).toEqual([
      'airlineId',
    ]);
    expect(
      await messagesFor(airlineBody({ airlineId: undefined }), 'airlineId'),
    ).toEqual(['airlineId must be a mongodb id']);
  });

  it('requires hotelId for a hotel moderator', async () => {
    expect(
      await errorFields({
        name: 'Omar Fathy',
        email: 'omar@hotel.example.com',
        role: Role.HOTEL_MODERATOR,
      }),
    ).toEqual(['hotelId']);
  });

  it('rejects hotelId on an airline moderator', async () => {
    const body = airlineBody({ hotelId: HOTEL_ID });
    expect(await errorFields(body)).toEqual(['hotelId']);
    expect(await messagesFor(body, 'hotelId')).toEqual([
      'hotelId is only allowed when role is HOTEL_MODERATOR',
    ]);
  });

  it('rejects airlineId on a hotel moderator', async () => {
    const body = {
      name: 'Omar Fathy',
      email: 'omar@hotel.example.com',
      role: Role.HOTEL_MODERATOR,
      hotelId: HOTEL_ID,
      airlineId: AIRLINE_ID,
    };
    expect(await errorFields(body)).toEqual(['airlineId']);
    expect(await messagesFor(body, 'airlineId')).toEqual([
      'airlineId is only allowed when role is AIRLINE_MODERATOR',
    ]);
  });

  it('rejects a provider id that is not an object id', async () => {
    expect(await errorFields(airlineBody({ airlineId: 'not-an-id' }))).toEqual([
      'airlineId',
    ]);
  });

  // With no usable role neither id can be judged, so only role is reported.
  it('reports only role when the role is not a moderator role', async () => {
    expect(
      await errorFields({
        name: 'Omar Fathy',
        email: 'omar@airline.example.com',
        role: Role.ADMIN,
        airlineId: AIRLINE_ID,
      }),
    ).toEqual(['role']);
  });

  it('rejects a sent null password rather than treating it as omitted', async () => {
    expect(await errorFields(airlineBody({ password: null }))).toEqual([
      'password',
    ]);
  });
});
