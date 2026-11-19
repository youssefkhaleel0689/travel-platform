import { ApiProperty } from '@nestjs/swagger';

export class AuthorBriefDto {
  @ApiProperty({
    example: '6720f1c2a1b2c3d4e5f60701',
    nullable: true,
    description: 'null for an account its owner deactivated',
  })
  id: string | null;

  @ApiProperty({
    example: 'Mona Adel',
    description: '"Deleted user" for an account its owner deactivated (ACC-12)',
  })
  name: string;
}
