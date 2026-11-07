import { Module } from '@nestjs/common';
import { ExternalModelsService } from './external-models.service';

@Module({
  providers: [ExternalModelsService],
  exports: [ExternalModelsService],
})
export class B2CommonModule {}
