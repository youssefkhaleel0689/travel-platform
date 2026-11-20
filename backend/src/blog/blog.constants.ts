export enum PostStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

export const POST_STATUSES = Object.values(PostStatus);

export const POST_TITLE_MAX_LENGTH = 150;
export const POST_BODY_MAX_LENGTH = 20_000;
export const MAX_TAGS_PER_POST = 5;
export const TAG_MAX_LENGTH = 30;
export const COMMENT_MAX_LENGTH = 500;

export const EXCERPT_LENGTH = 200;

export const DELETED_USER_NAME = 'Deleted user';
