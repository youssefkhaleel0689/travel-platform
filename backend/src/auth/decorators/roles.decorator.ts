import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums/role.enum';

export const ROLES_KEY = 'auth:roles';

/**
 * Restricts a route or a whole controller to the listed roles (ACC-11).
 * Use it together with AuthenticatedGuard and RolesGuard:
 *
 *   @UseGuards(AuthenticatedGuard, RolesGuard)
 *   @Roles(Role.ADMIN)
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
