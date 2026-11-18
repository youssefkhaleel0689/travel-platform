import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsString, MaxLength, ValidateIf } from 'class-validator';
import { trimText } from '../../../common/validation/text-transforms';
import { isSent } from '../../airlines/dto/create-airline.dto';
import { FlightDto } from '../../flights/dto/flight.dto';

// FLT-06: cancelling a flight cancels every paid booking on it and refunds them in full, so
// the moderator confirms it explicitly in the request.
export class CancelFlightDto {
  @ApiProperty({
    example: true,
    description:
      'The confirmation: must be true. All CONFIRMED bookings of the flight are cancelled and refunded in full.',
  })
  @Equals(true, { message: 'confirm must be true to cancel the flight' })
  confirm: boolean;

  @ApiPropertyOptional({
    example: 'Aircraft unavailable',
    maxLength: 500,
    description: 'Optional reason, kept on every cancelled booking.',
  })
  @Transform(trimText)
  @ValidateIf(isSent)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CancelledFlightResultDto {
  @ApiProperty({ type: FlightDto, description: 'The flight, now CANCELLED.' })
  flight: FlightDto;

  @ApiProperty({
    example: 42,
    description: 'CONFIRMED bookings cancelled with a 100% refund.',
  })
  cancelledBookings: number;

  @ApiProperty({
    example: 3,
    description: 'Unpaid holds released (they expire, their seats go back).',
  })
  releasedHolds: number;

  @ApiProperty({
    example: 40,
    description: 'Refunds the payment provider accepted (PAY-03).',
  })
  refundsRequested: number;

  @ApiProperty({
    example: 0,
    description:
      'Refunds that could not be requested. The cancellations stand; the refund can be retried.',
  })
  refundsFailed: number;
}
