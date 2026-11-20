import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { EmailService } from './email.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';

/**
 * GEN-01. Owns the notifications collection and exports NotificationsService
 * for every module that has something to tell a user: payments and refunds
 * (PAY-01, PAY-03), flight changes and cancellations (FLT-05, FLT-06),
 * hotel cancellations (HTL-21) and admin actions (ACC-15, ACC-16).
 *
 * It is a feature module rather than part of src/common/, because its three
 * endpoints need AuthenticatedGuard and common/ must not import a feature
 * module. Other modules import this module and inject the service, the same
 * way they use any other module's exported service.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
    ]),
    AuthModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, EmailService],
  exports: [NotificationsService, EmailService],
})
export class NotificationsModule {}
