import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { UsersService } from '../auth/users/users.service';
import { PasswordService } from '../auth/password/password.service';
import { Role } from '../common/auth/auth.enums';
import { ModeratorAssignmentsGateway } from '../common/providers/moderator-assignments.gateway';
import type { ModeratorRole } from '../common/providers/moderator-assignments.gateway';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { AuditAction, AuditEntityType } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { ModeratorCreatedDto } from './dto/moderator-created.dto';
import { EmailService } from '../notifications/email.service';

/**
 * ACC-13: an admin creates a hotel or airline moderator account linked to
 * exactly one provider, with a temporary password it must replace at first
 * login.
 *
 * Two collections are written, in two modules: the account in `users` (this
 * module's, through UsersService) and the link in the provider module's own
 * assignment collection (through ModeratorAssignmentsGateway). MongoDB gives
 * no transaction across them here, so the order is chosen to make a half-done
 * creation either impossible or repairable:
 *
 *  1. the provider is checked FIRST, so the common mistakes - a provider id
 *     that does not exist or is deactivated - cost nothing;
 *  2. the account is created, which is also where a duplicate email is caught;
 *  3. the link is written. If that fails anyway (a race that deactivated the
 *     provider, a moderator id somehow already linked, the database going
 *     away), the account is deleted again before the error is rethrown, so the
 *     admin can simply retry with the same email.
 *
 * mustChangePassword is what makes the "must change the password on first
 * login" half of the requirement real: JwtAuthGuard refuses every route but
 * PATCH /api/auth/change-password while the flag is set (ACC-07a).
 */
@Injectable()
export class AdminModeratorsService {
  private readonly logger = new Logger(AdminModeratorsService.name);

  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly assignments: ModeratorAssignmentsGateway,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  async create(
    actingAdminId: string,
    dto: CreateModeratorDto,
  ): Promise<ModeratorCreatedDto> {
    const role: ModeratorRole = dto.role;
    const providerId = this.providerIdFor(dto);

    // Step 1. Both the 501 for an unbuilt provider module and the 404/400 for
    // a bad provider id happen here, before anything is written.
    await this.assignments.assertAssignable(role, providerId, actingAdminId);

    // The admin may set the temporary password; otherwise one is generated the
    // same way ACC-07a generates its reset passwords.
    const temporaryPassword =
      dto.password ?? this.passwords.generateTemporary();

    // Step 2. A duplicate email throws 409 EMAIL_ALREADY_REGISTERED from here.
    const profile = await this.users.create({
      name: dto.name,
      email: dto.email,
      password: temporaryPassword,
      role,
      // A moderator did not sign up, so it accepted no terms (ACC-01). The
      // admin who created it did.
      termsAcceptedAt: null,
      mustChangePassword: true,
      temporaryPasswordIssuedAt: new Date(),
      emailVerifiedAt: new Date(),
    });

    // Step 3, with the compensating delete described above.
    try {
      await this.assignments.assign(role, profile.id, providerId);
    } catch (error) {
      await this.rollback(profile.id);
      throw error;
    }

    await this.audit.record({
      actorId: actingAdminId,
      action: AuditAction.MODERATOR_CREATED,
      entityType: AuditEntityType.ACCOUNT,
      entityId: profile.id,
      after: { role, providerId },
    });

    // GEN-01-B: the invitation (including the temporary password) goes by
    // email. Best effort only: account creation has already succeeded.
    await this.email.sendModeratorInvitation(
      profile.email,
      profile.name,
      temporaryPassword,
    );

    return ModeratorCreatedDto.from(profile, providerId, temporaryPassword);
  }

  /**
   * The body names the provider by role - airlineId or hotelId - while the
   * ports underneath take one generic providerId, so the two meet here. This is
   * the only place that knows the request field names; the gateway, the ports
   * and the adapters stay provider-shaped rather than request-shaped.
   *
   * CreateModeratorDto already requires the id that matches the role and
   * rejects the other one, so over HTTP the guard below cannot fire. It is here
   * because this service is exported from AdministrationModule: another module
   * calling it with a hand-built object would otherwise reach the provider
   * lookup with undefined.
   */
  private providerIdFor(dto: CreateModeratorDto): string {
    const field = dto.role === Role.AIRLINE_MODERATOR ? 'airlineId' : 'hotelId';
    const providerId =
      dto.role === Role.AIRLINE_MODERATOR ? dto.airlineId : dto.hotelId;

    if (providerId === undefined) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        errors: [
          {
            field,
            messages: [`${field} is required when role is ${dto.role}`],
          },
        ],
      });
    }
    return providerId;
  }

  /**
   * Undoes step 2 after step 3 failed. A failure here must not replace the
   * error that caused the rollback - that one tells the admin what went wrong -
   * so it is logged and swallowed. The leftover account is harmless on its own:
   * it owes a password change, so it can reach nothing.
   */
  private async rollback(userId: string): Promise<void> {
    try {
      await this.users.deleteById(userId);
    } catch (cleanupError) {
      this.logger.error(
        `ACC-13: could not remove the half-created moderator ${userId} after ` +
          'its provider link failed; it must be removed by hand',
        cleanupError instanceof Error ? cleanupError.stack : undefined,
      );
    }
  }
}
