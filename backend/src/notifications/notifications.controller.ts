import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator';
import { PageDto } from '../common/pagination/dto/page.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
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
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'No valid access-token cookie, or the session expired',
})
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description:
    'Account suspended or deactivated, or a password change is pending',
})
@UseGuards(AuthenticatedGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List your notifications, newest first (GEN-01)',
    description: 'Pages of 10 (GEN-05). Add unreadOnly=true for unread ones.',
  })
  @ApiPaginatedResponse(NotificationDto)
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Bad page or unknown query parameter',
  })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: NotificationsQueryDto,
  ): Promise<PageDto<NotificationDto>> {
    const page = await this.notifications.list(user.id, query.page, {
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
    return new UnreadCountDto(await this.notifications.unreadCount(user.id));
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Mark every notification as read (GEN-01)',
    description: 'Succeeds even when nothing was unread.',
  })
  @ApiNoContentResponse({ description: 'Every notification is now read' })
  async markAllAsRead(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.notifications.markAllAsRead(user.id);
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
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such notification for this account',
  })
  async markAsRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.notifications.markAsRead(user.id, id);
  }
}
