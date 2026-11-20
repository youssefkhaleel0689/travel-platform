import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { PRICE_REGEX } from './create-room.dto';

export class UpdateRoomDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  roomNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() type?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beds?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxOccupancy?: number;

  @ApiPropertyOptional({
    description:
      'Price change never affects existing reservations (they keep a snapshot).',
  })
  @IsOptional()
  @Matches(PRICE_REGEX, {
    message: 'pricePerNight must be greater than zero (max 2 decimals)',
  })
  pricePerNight?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
