import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, Matches } from 'class-validator';
import { BookingType } from '../../common/bookings/booking-status';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** BON-01: all bookings and revenue per provider in a UTC date range. */
export class AdminAnalyticsQueryDto {
  @ApiProperty({ example: '2026-11-01' })
  @Matches(DAY, { message: 'from must use YYYY-MM-DD' })
  from!: string;

  @ApiProperty({ example: '2026-11-30' })
  @Matches(DAY, { message: 'to must use YYYY-MM-DD' })
  to!: string;

  @ApiPropertyOptional({ enum: BookingType })
  @IsOptional()
  @IsEnum(BookingType)
  type?: BookingType;
}

export class ProviderAnalyticsDto {
  @ApiProperty({ enum: BookingType })
  type!: BookingType;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  providerId!: string;

  @ApiProperty({ example: 'Nile View Hotel', nullable: true })
  providerName!: string | null;

  @ApiProperty({ example: 12 })
  bookings!: number;

  @ApiProperty({ example: '1450.00' })
  revenue!: string;

  @ApiProperty({ example: 'USD' })
  currency!: string;
}

export class AdminAnalyticsDto {
  @ApiProperty({ example: '2026-11-01' })
  from!: string;

  @ApiProperty({ example: '2026-11-30' })
  to!: string;

  @ApiProperty({ example: 42 })
  totalBookings!: number;

  @ApiProperty({ example: '5200.00' })
  totalRevenue!: string;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ type: [ProviderAnalyticsDto] })
  byProvider!: ProviderAnalyticsDto[];
}
