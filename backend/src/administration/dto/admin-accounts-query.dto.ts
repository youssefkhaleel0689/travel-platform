import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/dto/pagination-query.dto';
import { Role, UserStatus } from '../../common/auth/auth.enums';

// ACC-14: search by name or email, filter by role and status.
export class AdminAccountsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'taher',
    description:
      'Case-insensitive fragment of the name or the email. Matched literally: ' +
      'regular-expression characters have no special meaning.',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1, { message: 'search should not be empty' })
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
