import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AuditLogsController } from './audit-logs.controller';
import { AuditService } from './audit.service';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
    AuthModule,
  ],
  controllers: [AuditLogsController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
