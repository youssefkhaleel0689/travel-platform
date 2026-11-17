import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsNotEmpty, IsString, Matches, Min } from "class-validator";

// Up to 2 decimals, strictly > 0.
export const PRICE_REGEX = /^(?=.*[1-9])\d{1,10}(?:\.\d{1,2})?$/;

export class CreateRoomDto {
  @ApiProperty({ example: "101" })
  @IsString()
  @IsNotEmpty()
  roomNumber!: string;

  @ApiProperty({ example: "Deluxe Sea View 101" })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: "DOUBLE" })
  @IsString()
  @IsNotEmpty()
  type!: string;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beds!: number;

  @ApiProperty({ example: 3 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxOccupancy!: number;

  @ApiProperty({
    example: "120.50",
    description: "Decimal string, > 0, up to 2 decimals",
  })
  @Matches(PRICE_REGEX, {
    message: "pricePerNight must be greater than zero (max 2 decimals)",
  })
  pricePerNight!: string;
}
