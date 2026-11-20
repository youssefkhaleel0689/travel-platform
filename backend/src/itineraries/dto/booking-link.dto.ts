import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsString, MaxLength } from 'class-validator';
import { BookingType } from '../../common/bookings/booking-status';

/** ITN-27: link a confirmed flight or hotel booking to an itinerary day. */
export class LinkBookingDto {
  @ApiProperty({ enum: BookingType, example: BookingType.HOTEL })
  @IsEnum(BookingType)
  bookingType: BookingType;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  @IsMongoId()
  bookingId: string;

  @ApiPropertyOptional({
    example: 'Nile View Hotel, 3 nights',
    description: 'Optional name shown in the itinerary and its PDF',
  })
  @IsString()
  @MaxLength(200)
  label?: string;
}
