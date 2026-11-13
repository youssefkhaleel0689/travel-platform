import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';
import {
  forbidden,
  unauthenticated,
} from '../common/swagger/standard-errors';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator';
import { PageDto } from '../common/pagination/dto/page.dto';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { NotificationDto } from './dto/notification.dto';
import { NotificationsQueryDto } from './dto/notifications-query.dto';
import { UnreadCountDto } from './dto/unread-count.dto';
import { NotificationsService } from './notifications.service';

/**
 * GEN-01: the unread count, the list and marking as read. Every route works on
 * the account in the cookie, so one account can never see or change another's
 * notifications (ACC-11).
 */
@ApiTags('Notifications')
@ApiCookieAuth()
@ApiErrorResponse(unauthenticated('/api/notifications'))
@ApiErrorResponse(forbidden('/api/notifications'))
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List your notifications, newest first (GEN-01)',
    description: 'Pages of 10 (GEN-05). Add unreadOnly=true for unread ones.',
  })
  @ApiPaginatedResponse(NotificationDto)
  @ApiErrorResponse({
    status: 400,
    description: 'Bad page or unknown query parameter',
    examples: [
      { code: 'VALIDATION_FAILED', message: 'Bad page or unknown query parameter', path: '/api/notifications' },
    ],
  })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: NotificationsQueryDto,
  ): Promise<PageDto<NotificationDto>> {
    const page = await this.notifications.list(user.userId, query.page, {
      unreadOnly: query.unreadOnly,
    });
    return new PageDto(
      page.items.map((item) => NotificationDto.fromLean(item)),
      page.meta,
    );
  }

  // Declared before ':id/read' is irrelevant here, but 'unread-count' must come
  // before any ':param' route on the same path segment or Express would read it
  // as an id.
  @Get('unread-count')
  @ApiOperation({ summary: 'Number of unread notifications (GEN-01)' })
  @ApiOkResponse({ type: UnreadCountDto })
  async unreadCount(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UnreadCountDto> {
    return new UnreadCountDto(await this.notifications.unreadCount(user.userId));
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Mark every notification as read (GEN-01)',
    description: 'Succeeds even when nothing was unread.',
  })
  @ApiNoContentResponse({ description: 'Every notification is now read' })
  async markAllAsRead(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.notifications.markAllAsRead(user.userId);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Mark one notification as read (GEN-01)',
    description:
      'Marking an already-read notification succeeds and keeps the first ' +
      'read time. A notification of another account answers 404, the same as ' +
      'one that does not exist.',
  })
  @ApiParam({ name: 'id', example: '6720f1c2a1b2c3d4e5f60718' })
  @ApiNoContentResponse({ description: 'The notification is now read' })
  @ApiErrorResponse({
    status: 404,
    description: 'No such notification for this account',
    examples: [
      { code: 'NOT_FOUND', message: 'No such notification for this account', path: '/api/notifications' },
    ],
  })
  async markAsRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.notifications.markAsRead(user.userId, id);
  }
}
