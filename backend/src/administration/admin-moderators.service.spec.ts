import { BadRequestException, NotImplementedException } from '@nestjs/common';
import { Role, UserStatus } from '../common/auth/auth.enums';
import { PasswordService } from '../auth/password/password.service';
import { UsersService } from '../auth/users/users.service';
import { ModeratorAssignmentsGateway } from '../common/providers/moderator-assignments.gateway';
import { AuditAction } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import { AdminModeratorsService } from './admin-moderators.service';
import { CreateModeratorDto } from './dto/create-moderator.dto';

describe('AdminModeratorsService (ACC-13)', () => {
  const ADMIN_ID = '6720f1c2a1b2c3d4e5f60001';
  const MODERATOR_ID = '6720f1c2a1b2c3d4e5f60002';
  const AIRLINE_ID = '6720f1c2a1b2c3d4e5f60777';
  const HOTEL_ID = '6720f1c2a1b2c3d4e5f60788';

  let users: jest.Mocked<Pick<UsersService, 'create' | 'deleteById'>>;
  let passwords: jest.Mocked<Pick<PasswordService, 'generateTemporary'>>;
  let assignments: jest.Mocked<
    Pick<ModeratorAssignmentsGateway, 'assertAssignable' | 'assign'>
  >;
  let audit: jest.Mocked<Pick<AuditService, 'record'>>;
  let email: jest.Mocked<Pick<EmailService, 'sendModeratorInvitation'>>;
  let service: AdminModeratorsService;

  function profile(overrides: Record<string, unknown> = {}) {
    return {
      id: MODERATOR_ID,
      name: 'Omar Fathy',
      email: 'omar@airline.example.com',
      phone: null,
      preferredCurrency: null,
      role: Role.AIRLINE_MODERATOR,
      status: UserStatus.ACTIVE,
      mustChangePassword: true,
      createdAt: new Date('2026-11-14T00:00:00.000Z'),
      suspendedAt: null,
      deactivatedAt: null,
      ...overrides,
    };
  }

  // The provider id follows the role, the way CreateModeratorDto requires it:
  // airlineId for an airline moderator, hotelId for a hotel one.
  function body(
    overrides: Partial<CreateModeratorDto> = {},
  ): CreateModeratorDto {
    const role = overrides.role ?? Role.AIRLINE_MODERATOR;
    return {
      name: 'Omar Fathy',
      email: 'omar@airline.example.com',
      role,
      ...(role === Role.HOTEL_MODERATOR
        ? { hotelId: HOTEL_ID }
        : { airlineId: AIRLINE_ID }),
      ...overrides,
    } as CreateModeratorDto;
  }

  beforeEach(() => {
    users = {
      create: jest.fn().mockResolvedValue(profile()),
      deleteById: jest.fn().mockResolvedValue(undefined),
    };
    passwords = {
      generateTemporary: jest.fn().mockReturnValue('Tmpabcde12349'),
    };
    assignments = {
      assertAssignable: jest.fn().mockResolvedValue(undefined),
      assign: jest.fn().mockResolvedValue(undefined),
    };

    audit = { record: jest.fn().mockResolvedValue(undefined) };
    email = { sendModeratorInvitation: jest.fn().mockResolvedValue(undefined) };

    service = new AdminModeratorsService(
      users as unknown as UsersService,
      passwords as unknown as PasswordService,
      assignments as unknown as ModeratorAssignmentsGateway,
      audit as unknown as AuditService,
      email as unknown as EmailService,
    );
  });

  it('creates the account, links it, and returns the password once', async () => {
    const result = await service.create(ADMIN_ID, body());

    expect(assignments.assertAssignable).toHaveBeenCalledWith(
      Role.AIRLINE_MODERATOR,
      AIRLINE_ID,
      ADMIN_ID,
    );
    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Omar Fathy',
        email: 'omar@airline.example.com',
        role: Role.AIRLINE_MODERATOR,
        mustChangePassword: true,
        termsAcceptedAt: null,
      }),
    );
    expect(assignments.assign).toHaveBeenCalledWith(
      Role.AIRLINE_MODERATOR,
      MODERATOR_ID,
      AIRLINE_ID,
    );
    expect(result.account.id).toBe(MODERATOR_ID);
    expect(result.account.role).toBe(Role.AIRLINE_MODERATOR);
    // GEN-07, without the temporary password.
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ADMIN_ID,
        action: AuditAction.MODERATOR_CREATED,
        entityId: MODERATOR_ID,
        after: { role: Role.AIRLINE_MODERATOR, providerId: AIRLINE_ID },
      }),
    );
    expect(result.account.mustChangePassword).toBe(true);
    expect(result.providerId).toBe(AIRLINE_ID);
    expect(result.temporaryPassword).toBe('Tmpabcde12349');
  });

  it('records when the temporary password was issued (ACC-07a)', async () => {
    await service.create(ADMIN_ID, body());

    const input = users.create.mock.calls[0][0];
    expect(input.temporaryPasswordIssuedAt).toBeInstanceOf(Date);
  });

  it('uses the password the admin set, and does not generate one', async () => {
    const result = await service.create(
      ADMIN_ID,
      body({ password: 'Welcome2026' }),
    );

    expect(passwords.generateTemporary).not.toHaveBeenCalled();
    expect(users.create.mock.calls[0][0].password).toBe('Welcome2026');
    expect(result.temporaryPassword).toBe('Welcome2026');
  });

  it('generates a temporary password when the admin sent none', async () => {
    const result = await service.create(ADMIN_ID, body());

    expect(passwords.generateTemporary).toHaveBeenCalledTimes(1);
    expect(users.create.mock.calls[0][0].password).toBe('Tmpabcde12349');
    expect(result.temporaryPassword).toBe('Tmpabcde12349');
  });

  // Step 1 before step 2: the cheap mistakes must not cost an account.
  it('creates nothing when the provider is unusable', async () => {
    assignments.assertAssignable.mockRejectedValue(
      new BadRequestException({ code: 'PROVIDER_DEACTIVATED' }),
    );

    await expect(service.create(ADMIN_ID, body())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(users.create).not.toHaveBeenCalled();
    expect(assignments.assign).not.toHaveBeenCalled();
  });

  it('creates nothing when the provider module is not built yet (501)', async () => {
    assignments.assertAssignable.mockRejectedValue(
      new NotImplementedException({ code: 'PROVIDER_TYPE_UNAVAILABLE' }),
    );

    await expect(
      service.create(ADMIN_ID, body({ role: Role.HOTEL_MODERATOR })),
    ).rejects.toBeInstanceOf(NotImplementedException);
    expect(users.create).not.toHaveBeenCalled();
  });

  // Step 3 failing leaves no half-made moderator behind, so the same email can
  // be retried.
  it('deletes the new account again when linking it fails', async () => {
    const linkFailed = new Error('duplicate key');
    assignments.assign.mockRejectedValue(linkFailed);

    await expect(service.create(ADMIN_ID, body())).rejects.toBe(linkFailed);
    expect(users.deleteById).toHaveBeenCalledWith(MODERATOR_ID);
  });

  it('still reports the linking error when the rollback itself fails', async () => {
    const linkFailed = new Error('duplicate key');
    assignments.assign.mockRejectedValue(linkFailed);
    users.deleteById.mockRejectedValue(new Error('database gone'));

    await expect(service.create(ADMIN_ID, body())).rejects.toBe(linkFailed);
  });

  // A duplicate email is caught by UsersService.create, so nothing is linked.
  it('does not link anything when the account could not be created', async () => {
    users.create.mockRejectedValue(new Error('EMAIL_ALREADY_REGISTERED'));

    await expect(service.create(ADMIN_ID, body())).rejects.toThrow();
    expect(assignments.assign).not.toHaveBeenCalled();
    expect(users.deleteById).not.toHaveBeenCalled();
  });

  it('routes a hotel moderator to the hotel side of the gateway', async () => {
    users.create.mockResolvedValue(
      profile({ role: Role.HOTEL_MODERATOR }) as never,
    );

    await service.create(ADMIN_ID, body({ role: Role.HOTEL_MODERATOR }));

    expect(assignments.assertAssignable).toHaveBeenCalledWith(
      Role.HOTEL_MODERATOR,
      HOTEL_ID,
      ADMIN_ID,
    );
    expect(assignments.assign).toHaveBeenCalledWith(
      Role.HOTEL_MODERATOR,
      MODERATOR_ID,
      HOTEL_ID,
    );
  });

  // Defence in depth for the one caller the DTO cannot protect: another module
  // using the exported service with an object it built itself.
  it('refuses a body whose role-specific provider id is missing', async () => {
    await expect(
      service.create(ADMIN_ID, {
        name: 'Omar Fathy',
        email: 'omar@airline.example.com',
        role: Role.AIRLINE_MODERATOR,
      } as CreateModeratorDto),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'airlineId' }],
      },
    });
    expect(assignments.assertAssignable).not.toHaveBeenCalled();
    expect(users.create).not.toHaveBeenCalled();
  });
});
