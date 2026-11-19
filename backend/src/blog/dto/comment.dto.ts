import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ModerationState } from '../../common/moderation/moderation-state';
import { trimText } from '../../common/validation/text-transforms';
import { COMMENT_MAX_LENGTH } from '../blog.constants';
import { AuthorBriefDto } from './author-brief.dto';

export class CommentBodyDto {
  @ApiProperty({
    example: 'Great tips! Did you need a guide inside the tombs?',
    maxLength: COMMENT_MAX_LENGTH,
  })
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(COMMENT_MAX_LENGTH)
  body: string;
}

export class CommentDto {
  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60750' })
  id: string;

  @ApiProperty({ example: '6720f1c2a1b2c3d4e5f60718' })
  postId: string;

  @ApiProperty({ type: AuthorBriefDto })
  author: AuthorBriefDto;

  @ApiProperty({ example: 'Great tips! Did you need a guide inside the tombs?' })
  body: string;

  @ApiProperty({ example: false, description: 'True once the author edited it' })
  edited: boolean;

  @ApiPropertyOptional({
    enum: ModerationState,
    description:
      'Present only when it is not VISIBLE: a hidden comment is shown to its ' +
      'author and to admins only (GEN-10)',
  })
  moderationState?: ModerationState;

  @ApiProperty({ example: '2026-11-18T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-18T10:00:00.000Z' })
  updatedAt: string;
}
