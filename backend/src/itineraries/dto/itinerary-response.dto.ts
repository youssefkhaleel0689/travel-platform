import { ApiProperty } from '@nestjs/swagger';
import { Visibility } from '../schemas/itinerary.schema';

// Only used to document responses in Swagger.
export class ItinerarySummaryDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ example: 'Summer in Europe' })
  title: string;

  @ApiProperty({ example: ['FR', 'GB'] })
  countries: string[];

  @ApiProperty({ example: '2026-12-20' })
  startDate: string;

  @ApiProperty({ example: 5 })
  dayCount: number;

  @ApiProperty({ enum: Visibility })
  visibility: Visibility;

  @ApiProperty()
  updatedAt: Date;
}

export class ItineraryDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ example: '64b7f0c2a1b2c3d4e5f60718' })
  ownerId: string;

  @ApiProperty({ example: 'Summer in Europe' })
  title: string;

  @ApiProperty({ example: ['FR', 'GB'] })
  countries: string[];

  @ApiProperty({ example: '2026-12-20' })
  startDate: string;

  @ApiProperty({ enum: Visibility })
  visibility: Visibility;

  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description:
      'Days in order. dayNumber and date are derived from position and startDate.',
  })
  days: Record<string, unknown>[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: 'Consecutive days in the same city, with day count (ITN-09)',
  })
  cityGroups: Record<string, unknown>[];

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  transportCosts: Record<string, unknown>[];

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  clonedFrom: Record<string, unknown> | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
