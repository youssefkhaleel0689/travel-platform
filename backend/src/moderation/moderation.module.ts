import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BlogModule } from '../blog/blog.module';
import { REVIEW_MODERATION_PORT } from '../common/moderation/content-moderation.port';
import { ReviewsModule } from '../reviews/reviews.module';
import { AdminModerationController } from './admin-moderation.controller';
import { ContentModerationGateway } from './content-moderation.gateway';
import { ModerationService } from './moderation.service';
import { ReportsController } from './reports.controller';
import { ReviewModerationAdapter } from './review-moderation.adapter';
import { Report, ReportSchema } from './schemas/report.schema';

/**
 * GEN-09 and GEN-10, owned by D2. Owns the reports collection. Reaches the
 * reported content through each owner's ContentModerationPort: posts and
 * comments from BlogModule, reviews through ReviewsService (B2), itineraries
 * from D1's global ITINERARY_MODERATION_PORT once it exists. Writes every
 * decision to the audit log (GEN-07).
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Report.name, schema: ReportSchema }]),
    AuthModule,
    AuditModule,
    BlogModule,
    ReviewsModule,
  ],
  controllers: [ReportsController, AdminModerationController],
  providers: [
    ModerationService,
    ContentModerationGateway,
    { provide: REVIEW_MODERATION_PORT, useClass: ReviewModerationAdapter },
  ],
  exports: [ModerationService],
})
export class ModerationModule {}
