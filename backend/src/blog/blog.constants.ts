// Limits of the blog (BLG-01 to BLG-10). The numbers in the requirements are
// fixed: 5 tags of at most 30 characters (BLG-08) and comments of at most 500
// (BLG-05). The title and body limits are ours, generous enough for a travel
// post and small enough to keep a page of results light.

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

/** Characters of the body shown in search results (BLG-09 "excerpt"). */
export const EXCERPT_LENGTH = 200;

/** Shown instead of the name of an account its owner deactivated (ACC-12). */
export const DELETED_USER_NAME = 'Deleted user';
