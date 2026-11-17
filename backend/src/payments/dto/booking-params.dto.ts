import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsMongoId } from 'class-validator';
import { BookingType } from '../../common/bookings/booking-status';

/**
 * Path parameters of /api/bookings/:type/:id/... .
 *
 * :type is written lowercase in a URL (flight, hotel) and upper-cased here
 * into the BookingType the rest of the code uses, so the enum has one spelling
 * everywhere and the route still reads like a REST path.
 */
export class BookingParamsDto {
  @ApiProperty({
    enum: ['flight', 'hotel'],
    example: 'hotel',
    description: 'Booking type, lowercase',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsEnum(BookingType, { message: 'type must be flight or hotel' })
  type: BookingType;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  @IsMongoId({ message: 'id must be a booking id' })
  id: string;
}
