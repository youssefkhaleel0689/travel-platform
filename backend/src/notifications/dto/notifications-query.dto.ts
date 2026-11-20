import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/dto/pagination-query.dto';

export class NotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: true,
    description: 'Return only notifications that have not been read yet',
  })
  @IsOptional()
  // Query strings carry text, so "true" and "false" are turned into booleans
  // here; anything else stays a string and fails @IsBoolean with a clear error.
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  unreadOnly?: boolean;
}
