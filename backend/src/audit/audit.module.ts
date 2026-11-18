import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AuditLogsController } from './audit-logs.controller';
import { AuditService } from './audit.service';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';

/**
 * GEN-07, owned by D2 (schema section 2.2: auditLogs has one owner). Exports
 * AuditService so the admin module (ACC-07a, ACC-13, ACC-16), provider
 * deactivation (ACC-15) and moderation (GEN-10) write through one door.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: AuditLog.name, schema: AuditLogSchema }]),
    AuthModule,
  ],
  controllers: [AuditLogsController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
