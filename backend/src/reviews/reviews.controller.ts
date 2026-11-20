import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ReviewsService } from './reviews.service';
import {
  CreateHotelReviewDto,
  ReplyReviewDto,
  UpdateHotelReviewDto,
} from './dto/review.dto';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { Roles } from '../common/auth/roles.decorator';
import { Public } from '../common/auth/public.decorator';
import { Role } from '../common/auth/auth.enums';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';
import { PaginationQueryDto } from '../common/pagination/dto/pagination-query.dto';

const CREATE_PATH = '/api/hotel-bookings/6af8b9fdbc5624b5a1b41d6b/review';
const REVIEW = '/api/reviews/6af8b9fdbc5624b5a1b41d6b';
const REPLY = `${REVIEW}/reply`;
const LIST = '/api/hotels/6af83761fa40574d39eb7dc2/reviews';
const UNAUTH = { code: 'UNAUTHENTICATED', message: 'Authentication required' };
const FORBIDDEN = {
  code: 'FORBIDDEN',
  message: 'You do not have permission to do this',
};
const VALIDATION = {
  code: 'VALIDATION_FAILED',
  message: 'Validation failed',
  errors: [{ field: 'body', messages: ['invalid value'] }],
};
const NOT_FOUND = { code: 'NOT_FOUND', message: 'Review not found' };

@ApiTags('Hotel reviews (B2)')
@Controller()
export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Post('hotel-bookings/:id/review')
  @ApiCookieAuth()
  @ApiOkResponse({ description: 'The created review' })
  @ApiErrorResponse({
    status: 400,
    description: 'Booking not completed (BAD_REQUEST)',
    examples: [
      { ...VALIDATION, path: CREATE_PATH },
      {
        code: 'BAD_REQUEST',
        message:
          'Only COMPLETED reservations (check-out date passed) can be reviewed',
        path: CREATE_PATH,
      },
    ],
  })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in (UNAUTHENTICATED)',
    examples: [{ ...UNAUTH, path: CREATE_PATH }],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Wrong role (FORBIDDEN)',
    examples: [{ ...FORBIDDEN, path: CREATE_PATH }],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'Booking not found (NOT_FOUND)',
    examples: [
      {
        code: 'NOT_FOUND',
        message: 'Hotel booking not found',
        path: CREATE_PATH,
      },
    ],
  })
  @ApiErrorResponse({
    status: 409,
    description: 'Booking already reviewed (CONFLICT)',
    examples: [
      {
        code: 'CONFLICT',
        message: 'This reservation has already been reviewed',
        path: CREATE_PATH,
      },
    ],
  })
  @ApiOperation({
    summary: 'HTL-23 Review a completed hotel booking (USER)',
    description:
      'Access: USER only — login required. The caller must own the completed hotel booking. One rating from 1 to 5 and an optional comment; one review per reservation.',
  })
  @Roles(Role.USER)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateHotelReviewDto,
  ) {
    return this.service.create(user, id, dto);
  }

  @Patch('reviews/:id')
  @ApiCookieAuth()
  @ApiOkResponse({ description: 'The updated review' })
  @ApiErrorResponse({
    status: 400,
    description: 'Nothing to update or invalid rating (BAD_REQUEST)',
    examples: [
      { ...VALIDATION, path: REVIEW },
      { code: 'BAD_REQUEST', message: 'Nothing to update', path: REVIEW },
    ],
  })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in (UNAUTHENTICATED)',
    examples: [{ ...UNAUTH, path: REVIEW }],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Wrong role (FORBIDDEN)',
    examples: [{ ...FORBIDDEN, path: REVIEW }],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'Review not found or not yours (NOT_FOUND)',
    examples: [{ ...NOT_FOUND, path: REVIEW }],
  })
  @ApiOperation({
    summary: 'HTL-23 Edit my hotel review (USER)',
    description:
      'Access: USER only — login required. The caller may edit only their own review; the hotel rating aggregate is recalculated.',
  })
  @Roles(Role.USER)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateHotelReviewDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Delete('reviews/:id')
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOkResponse({ description: 'Deletion result' })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in (UNAUTHENTICATED)',
    examples: [{ ...UNAUTH, path: REVIEW }],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Wrong role (FORBIDDEN)',
    examples: [{ ...FORBIDDEN, path: REVIEW }],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'Review not found or not yours (NOT_FOUND)',
    examples: [{ ...NOT_FOUND, path: REVIEW }],
  })
  @ApiOperation({
    summary: 'HTL-23 Delete my hotel review (USER)',
    description:
      'Access: USER only — login required. The caller may delete only their own review; the hotel rating average and count are recalculated.',
  })
  @Roles(Role.USER)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.remove(user, id);
  }

  @Post('reviews/:id/reply')
  @ApiCookieAuth()
  @ApiOkResponse({ description: 'The review with the moderator reply' })
  @ApiErrorResponse({
    status: 400,
    description: 'Validation failed (VALIDATION_FAILED)',
    examples: [{ ...VALIDATION, path: REPLY }],
  })
  @ApiErrorResponse({
    status: 401,
    description: 'Not logged in (UNAUTHENTICATED)',
    examples: [{ ...UNAUTH, path: REPLY }],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Wrong role or not assigned to this hotel (FORBIDDEN)',
    examples: [{ ...FORBIDDEN, path: REPLY }],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'Review not found (NOT_FOUND)',
    examples: [{ ...NOT_FOUND, path: REPLY }],
  })
  @ApiOperation({
    summary: 'HTL-26 Reply to a hotel review (HOTEL_MODERATOR)',
    description:
      'Access: HOTEL_MODERATOR only — login required. The moderator must be assigned to the hotel that owns the review.',
  })
  @Roles(Role.HOTEL_MODERATOR)
  reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReplyReviewDto,
  ) {
    return this.service.reply(user, id, dto);
  }

  @Get('hotels/:hotelId/reviews')
  @Public()
  @ApiOkResponse({
    description: 'Paginated visible reviews with rating aggregate',
  })
  @ApiErrorResponse({
    status: 400,
    description: 'Invalid query (VALIDATION_FAILED)',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: LIST,
        errors: [
          { field: 'page', messages: ['page must be a positive integer'] },
        ],
      },
    ],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'Hotel not found (HOTEL_NOT_FOUND)',
    examples: [
      { code: 'HOTEL_NOT_FOUND', message: 'Hotel not found', path: LIST },
    ],
  })
  @ApiOperation({
    summary: 'HTL-24 List hotel reviews (PUBLIC)',
    description:
      'Access: PUBLIC — no login required. Returns visible reviews for the specified hotel, newest first, with the hotel average rating, rating count and pagination.',
  })
  list(@Param('hotelId') hotelId: string, @Query() q: PaginationQueryDto) {
    return this.service.listForHotel(hotelId, q.page);
  }
}
