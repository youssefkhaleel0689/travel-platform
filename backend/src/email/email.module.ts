import { Global, Module } from '@nestjs/common';
import { EmailService } from '../notifications/email.service';

/**
 * SMTP delivery is used by notifications (GEN-01-B) and by the account
 * bonuses (ACC-02, ACC-07). A small global module keeps AuthModule and
 * NotificationsModule independent of each other.
 */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
