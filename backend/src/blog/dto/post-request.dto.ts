import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/dto/pagination-query.dto';
import { trimText } from '../../common/validation/text-transforms';
import {
  MAX_TAGS_PER_POST,
  POST_BODY_MAX_LENGTH,
  POST_TITLE_MAX_LENGTH,
  PostStatus,
  TAG_MAX_LENGTH,
} from '../blog.constants';
import { normalizeTag, normalizeTags, TAG_PATTERN, TAG_RULES } from '../tags';

// Strings are normalised before validation, so the count and length rules
// apply to the stored form ("Egypt" and "egypt" are one tag). Anything that
// is not an array of strings is left alone for the validators to reject.
const toTags = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value) && value.every((tag) => typeof tag === 'string')
    ? normalizeTags(value as string[])
    : value;

const TAG_MESSAGE =
  'each tag may contain only letters, digits, spaces, hyphens and underscores';

/** BLG-01: title and body required, tags optional, saved as DRAFT or PUBLISHED. */
export class CreatePostDto {
  @ApiProperty({ example: 'Three days in Luxor', maxLength: POST_TITLE_MAX_LENGTH })
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(POST_TITLE_MAX_LENGTH)
  title: string;

  @ApiProperty({
    example: 'We started at Karnak at sunrise, before the tour buses...',
    maxLength: POST_BODY_MAX_LENGTH,
  })
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(POST_BODY_MAX_LENGTH)
  body: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['egypt', 'history', 'nile cruise'],
    maxItems: MAX_TAGS_PER_POST,
    description: TAG_RULES,
  })
  @IsOptional()
  @Transform(toTags)
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_POST)
  @IsString({ each: true })
  @MaxLength(TAG_MAX_LENGTH, { each: true })
  @Matches(TAG_PATTERN, { each: true, message: TAG_MESSAGE })
  tags?: string[];

  @ApiProperty({
    enum: PostStatus,
    example: PostStatus.PUBLISHED,
    description:
      'DRAFT is visible only to you; PUBLISHED appears in the blog, search ' +
      'and your author page. Images are added afterwards with ' +
      'POST /api/posts/{id}/images.',
  })
  @IsEnum(PostStatus)
  status: PostStatus;
}

/**
 * BLG-04, BLG-08: change any of the fields. Send only what changes; tags
 * replace the whole list ([] removes them all).
 */
export class UpdatePostDto {
  @ApiPropertyOptional({ example: 'Four days in Luxor' })
  @IsOptional()
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(POST_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({ example: 'Updated: we added a day for the West Bank.' })
  @IsOptional()
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(POST_BODY_MAX_LENGTH)
  body?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['egypt', 'luxor'],
    description: `${TAG_RULES} Replaces the whole list.`,
  })
  @IsOptional()
  @Transform(toTags)
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_POST)
  @IsString({ each: true })
  @MaxLength(TAG_MAX_LENGTH, { each: true })
  @Matches(TAG_PATTERN, { each: true, message: TAG_MESSAGE })
  tags?: string[];

  @ApiPropertyOptional({
    enum: PostStatus,
    description: 'Publish a draft, or move a published post back to DRAFT',
  })
  @IsOptional()
  @IsEnum(PostStatus)
  status?: PostStatus;
}

/** BLG-02 browse and BLG-09 search. */
export class PostsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'luxor',
    description:
      'BLG-09: matches the title, a tag or the author name (case-insensitive, ' +
      'literal). With a keyword, results are ordered by interaction score ' +
      '(likes + comments), newest first on a tie. Without one, newest first.',
  })
  @IsOptional()
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional({
    example: 'egypt',
    description: 'BLG-02, BLG-08: only posts with this tag',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeTag(value) : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(TAG_MAX_LENGTH)
  tag?: string;
}
