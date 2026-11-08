import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';

/**
 * The administration module (ACC-07a, ACC-14, ACC-16, and later ACC-13,
 * ACC-15, ACC-17, GEN-07, GEN-09, GEN-10).
 *
 * It owns no collection of its own: it works through UsersService and
 * NotificationsService, which is why the account rules cannot drift between
 * the admin routes and the account's own routes.
 */
@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [AdminAccountsController],
  providers: [AdminAccountsService],
  exports: [AdminAccountsService],
})
export class AdministrationModule {}
