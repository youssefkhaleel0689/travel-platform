import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsLocalDate } from '../../../common/time/local-date-time.validators';
import { trimText } from '../../../common/validation/text-transforms';
import { trimUpper } from '../../airlines/dto/create-airline.dto';
import { PassengerType, TripType } from '../../schemas/flight-booking.schema';
import { CabinCategory } from '../../schemas/flight.schema';
import {
  DOCUMENT_NUMBER,
  MAX_BAG_WEIGHT_KG,
  MAX_EXTRA_BAGS,
  MAX_SEATED_PASSENGERS,
} from '../flight-bookings.constants';
import {
  HasAnAdult,
  HasNoMoreInfantsThanAdults,
  HasSeatedAtMost,
  IsValidInbound,
} from './flight-booking-request.validators';

// One flight of the trip and the cabin to sit in (FLT-11, FLT-12).
export class SegmentChoiceDto {
  @ApiProperty({
    example: '6720f1c2a1b2c3d4e5f60719',
    description: 'The id of a flight from GET /api/flights/search.',
  })
  @IsMongoId({ message: 'flightId must be a flight id' })
  flightId: string;

  @ApiProperty({ enum: CabinCategory, example: CabinCategory.ECONOMY })
  @Transform(trimUpper)
  @IsEnum(CabinCategory)
  cabin: CabinCategory;
}

// Extra bags of one passenger, on top of the cabin's free allowance (FLT-19).
export class ExtraBagsDto {
  @ApiProperty({
    example: 1,
    minimum: 1,
    maximum: MAX_EXTRA_BAGS,
    description: "At most the airline's maxExtraBagsPerPassenger (FLT-08).",
  })
  @IsInt()
  @Min(1)
  @Max(MAX_EXTRA_BAGS)
  count: number;

  @ApiProperty({
    example: 20,
    description:
      "Weight of each extra bag in kg, at most the cabin's maxBagWeightKg (FLT-08).",
  })
  @IsNumber({ maxDecimalPlaces: 1, allowNaN: false, allowInfinity: false })
  @IsPositive()
  @Max(MAX_BAG_WEIGHT_KG)
  weightKg: number;
}

// One traveller (FLT-19). The type is checked against the date of birth by the service,
// because the age counts on the departure date at the departure airport (FLT-12, GEN-06).
export class PassengerDto {
  @ApiProperty({ example: 'Khaled Elshitany', maxLength: 100 })
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName: string;

  @ApiProperty({ example: '2004-03-10', description: 'YYYY-MM-DD.' })
  @IsLocalDate()
  dateOfBirth: string;

  @ApiProperty({
    enum: PassengerType,
    example: PassengerType.ADULT,
    description:
      'ADULT 12+, CHILD 2-11, INFANT under 2, on the outbound departure date. Infants sit on a lap.',
  })
  @Transform(trimUpper)
  @IsEnum(PassengerType)
  passengerType: PassengerType;

  @ApiProperty({
    example: 'A12345678',
    description: 'Passport or national ID number: 5 to 30 letters or digits.',
  })
  @Transform(trimUpper)
  @IsString()
  @Matches(DOCUMENT_NUMBER, {
    message: 'documentNumber must be 5 to 30 letters or digits',
  })
  documentNumber: string;

  @ApiPropertyOptional({ type: ExtraBagsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExtraBagsDto)
  extraBags?: ExtraBagsDto;
}

// Body of POST /flight-bookings (summary, FLT-19, FLT-21) and POST /flight-bookings/hold
// (FLT-22). Prices, times and seats are never sent: the server reads them from the flights.
export class FlightBookingRequestDto {
  @ApiPropertyOptional({ enum: TripType, default: TripType.ONE_WAY })
  @Transform(trimUpper)
  @IsOptional()
  @IsEnum(TripType)
  tripType: TripType = TripType.ONE_WAY;

  @ApiProperty({ type: SegmentChoiceDto })
  @IsDefined({ message: 'outbound is required' })
  @ValidateNested()
  @Type(() => SegmentChoiceDto)
  outbound: SegmentChoiceDto;

  @ApiPropertyOptional({
    type: SegmentChoiceDto,
    description:
      'The flight back. Required for a ROUND_TRIP, not allowed for a ONE_WAY trip.',
  })
  @IsValidInbound()
  @ValidateNested()
  @Type(() => SegmentChoiceDto)
  inbound?: SegmentChoiceDto;

  @ApiProperty({
    type: [PassengerDto],
    description: `At least one adult, no more infants than adults, at most ${MAX_SEATED_PASSENGERS} adults and children.`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SEATED_PASSENGERS * 2)
  @ValidateNested({ each: true })
  @Type(() => PassengerDto)
  @HasAnAdult()
  @HasNoMoreInfantsThanAdults()
  @HasSeatedAtMost(MAX_SEATED_PASSENGERS)
  passengers: PassengerDto[];
}
