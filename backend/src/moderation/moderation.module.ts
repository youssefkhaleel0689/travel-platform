import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BlogModule } from '../blog/blog.module';
import {
  ITINERARY_MODERATION_PORT,
  REVIEW_MODERATION_PORT,
} from '../common/moderation/content-moderation.port';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { AdminModerationController } from './admin-moderation.controller';
import { ContentModerationGateway } from './content-moderation.gateway';
import { ItineraryModerationAdapter } from './itinerary-moderation.adapter';
import { ModerationService } from './moderation.service';
import { ReportsController } from './reports.controller';
import { ReviewModerationAdapter } from './review-moderation.adapter';
import { Report, ReportSchema } from './schemas/report.schema';

/**
 * GEN-09 and GEN-10 (D2). Owns the reports collection and reaches the
 * reported content through each owner's ContentModerationPort: posts and
 * comments from BlogModule, reviews through ReviewsService (B2), itineraries
 * through PublicItinerariesService (D1). Every decision goes to the audit log.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Report.name, schema: ReportSchema }]),
    AuthModule,
    AuditModule,
    BlogModule,
    ReviewsModule,
    ItinerariesModule,
  ],
  controllers: [ReportsController, AdminModerationController],
  providers: [
    ModerationService,
    ContentModerationGateway,
    { provide: REVIEW_MODERATION_PORT, useClass: ReviewModerationAdapter },
    {
      provide: ITINERARY_MODERATION_PORT,
      useClass: ItineraryModerationAdapter,
    },
  ],
  exports: [ModerationService],
})
export class ModerationModule {}
