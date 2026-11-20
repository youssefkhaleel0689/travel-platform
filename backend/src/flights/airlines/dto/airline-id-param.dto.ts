import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

// Path parameter of the airline endpoints; a bad id is a field-level 400, not a 500.
export class AirlineIdParamDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  @IsMongoId()
  id: string;
}
