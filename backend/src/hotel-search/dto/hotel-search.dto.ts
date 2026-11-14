import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from "class-validator";

import { PaginationQueryDto } from "../../common/pagination/dto/pagination-query.dto";

export enum HotelSortBy {
  PRICE = "price",
  RATING = "rating",
}
export enum SortOrder {
  ASC = "asc",
  DESC = "desc",
}

const MONEY = /^\d{1,10}(?:\.\d{1,2})?$/;

export class HotelSearchDto extends PaginationQueryDto {
  @ApiProperty({
    example: "Cairo",
    description: "City or country name (seeded reference data)",
  })
  @IsString()
  @IsNotEmpty()
  destination!: string;

  @ApiProperty({ example: "2026-12-20" }) @IsDateString() checkInDate!: string;
  @ApiProperty({ example: "2026-12-23" }) @IsDateString() checkOutDate!: string;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  guestCount!: number;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomCount: number = 1;

  @ApiPropertyOptional({
    description: "Inclusive; price of the cheapest qualifying room",
  })
  @IsOptional()
  @Matches(MONEY, { message: "minPricePerNight must be a non-negative amount" })
  minPricePerNight?: string;
  @ApiPropertyOptional({ description: "Inclusive" })
  @IsOptional()
  @Matches(MONEY, { message: "maxPricePerNight must be a non-negative amount" })
  maxPricePerNight?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 5,
    description: "Unrated hotels are excluded when set",
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  minAverageRating?: number;

  @ApiPropertyOptional({ enum: HotelSortBy, default: HotelSortBy.PRICE })
  @IsOptional()
  @IsEnum(HotelSortBy)
  sortBy: HotelSortBy = HotelSortBy.PRICE;
  @ApiPropertyOptional({ enum: SortOrder })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder;
}
