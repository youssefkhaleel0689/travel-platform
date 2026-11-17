import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  ArrayMaxSize,
  Equals,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { PaginationQueryDto } from "../../common/pagination/dto/pagination-query.dto";
import { GuestType, HotelBookingStatus } from "../schemas/hotel-booking.schema";

export class AssignedGuestDto {
  @ApiProperty({ enum: GuestType }) @IsEnum(GuestType) type!: GuestType;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;
  @ApiPropertyOptional({ description: "Required for CHILD (0-17)" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  age?: number;
}

export class RoomSelectionDto {
  @ApiProperty() @IsMongoId() roomId!: string;
  @ApiProperty({ type: [AssignedGuestDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AssignedGuestDto)
  assignedGuests!: AssignedGuestDto[];
}

// NOTE: no userId here — the user is always taken from the authenticated session.
// Prices, currency, nights, totals and guest counts are computed by the server.
export class CreateHotelBookingDto {
  @ApiProperty() @IsMongoId() hotelId!: string;
  @ApiProperty({ example: "2026-12-20" }) @IsDateString() checkInDate!: string;
  @ApiProperty({ example: "2026-12-23" }) @IsDateString() checkOutDate!: string;
  @ApiProperty({ type: [RoomSelectionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RoomSelectionDto)
  rooms!: RoomSelectionDto[];
}

export enum BookingGroup {
  UPCOMING = "UPCOMING",
  PAST = "PAST",
  CANCELLED = "CANCELLED",
}

export class ListBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: BookingGroup, default: BookingGroup.UPCOMING })
  @IsOptional()
  @IsEnum(BookingGroup)
  group: BookingGroup = BookingGroup.UPCOMING;
}

export class CancelBookingDto {
  @ApiProperty({
    description: "GEN-03: user must confirm after seeing the refund preview",
  })
  @IsBoolean()
  @Equals(true, { message: "confirm must be true to cancel the reservation" })
  confirm!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ReservationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: HotelBookingStatus })
  @IsOptional()
  @IsEnum(HotelBookingStatus)
  status?: HotelBookingStatus;
}
