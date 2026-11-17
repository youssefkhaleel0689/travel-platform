import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsMongoId } from 'class-validator';
import { BookingType } from '../../common/bookings/booking-status';

// PAY-01: which booking to pay for. The amount is never taken from the
// client: it comes from the booking the flights or hotels module holds.
export class CreatePaymentDto {
  @ApiProperty({
    enum: BookingType,
    example: BookingType.HOTEL,
    description: 'FLIGHT or HOTEL; lowercase is accepted too',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsEnum(BookingType, { message: 'bookingType must be FLIGHT or HOTEL' })
  bookingType: BookingType;

  @ApiProperty({
    example: '6720f1c2a1b2c3d4e5f60718',
    description: 'A booking of yours that is PENDING_PAYMENT',
  })
  @IsMongoId({ message: 'bookingId must be a booking id' })
  bookingId: string;
}
