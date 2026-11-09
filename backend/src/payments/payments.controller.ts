import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentDto } from './dto/payment.dto';
import { PaymentIntentDto } from './dto/payment-intent.dto';
import { PaymentsService } from './payments.service';
import {
  PaymentsWebhookService,
  WebhookOutcome,
} from './payments-webhook.service';

/** Express gives the untouched request bytes here when rawBody is enabled. */
type RawBodyRequest = Request & { rawBody?: Buffer };

@ApiTags('Payments and policies')
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly webhooks: PaymentsWebhookService,
  ) {}

  @Post('payments')
  @UseGuards(AuthenticatedGuard)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Start paying for a booking on hold (PAY-01)',
    description:
      'Opens a Stripe PaymentIntent in test mode for one of your ' +
      'PENDING_PAYMENT bookings and returns its clientSecret, which the card ' +
      'form uses to send the card straight to Stripe. No card detail ever ' +
      'reaches this backend.\n\n' +
      'The amount comes from the booking, never from the request. The ' +
      "provider's policies must be accepted first (PAY-02), and the hold must " +
      'not have expired. Calling this again while an attempt is still open ' +
      'returns that attempt instead of opening a second one.\n\n' +
      'The booking is confirmed only when the verified Stripe webhook says ' +
      'the payment succeeded.',
  })
  @ApiCreatedResponse({ type: PaymentIntentDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid body, or Stripe rejected the request',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'No valid access-token cookie, or the session expired',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description:
      'POLICIES_NOT_ACCEPTED, or the account is suspended or deactivated',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such booking for this account',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'HOLD_EXPIRED, ALREADY_PAID, BOOKING_NOT_AWAITING_PAYMENT or ' +
      'PAYMENT_ATTEMPT_CLOSED',
  })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description: 'PAYMENTS_UNAVAILABLE (no Stripe key) or STRIPE_UNAVAILABLE',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentDto,
  ): Promise<PaymentIntentDto> {
    return this.payments.createForBooking(
      user.id,
      dto.bookingType,
      dto.bookingId,
    );
  }

  @Post('payments/:id/retry')
  @UseGuards(AuthenticatedGuard)
  @ApiCookieAuth()
  // 200: a retry opens a new attempt but the client is being handed the state
  // of an existing payment flow, not a created resource at a new URL.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retry a failed payment (PAY-01)',
    description:
      'Opens a fresh PaymentIntent for the same booking, allowed as long as ' +
      'the hold has not expired. A payment that already succeeded is a ' +
      'conflict, and one that is still open is simply returned as it stands.',
  })
  @ApiParam({ name: 'id', example: '6720f1c2a1b2c3d4e5f60910' })
  @ApiOkResponse({ type: PaymentIntentDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such payment for this account',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'ALREADY_PAID, HOLD_EXPIRED or BOOKING_NOT_AWAITING_PAYMENT',
  })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto })
  retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<PaymentIntentDto> {
    return this.payments.retry(user.id, id);
  }

  @Get('payments/:id')
  @UseGuards(AuthenticatedGuard)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Payment status (PAY-01)',
    description:
      'Your own payment. The status is refreshed from Stripe on each read, ' +
      'so it is correct even if a webhook is late or was lost. Another ' +
      "account's payment answers 404, like one that does not exist.",
  })
  @ApiParam({ name: 'id', example: '6720f1c2a1b2c3d4e5f60910' })
  @ApiOkResponse({ type: PaymentDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such payment for this account',
  })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<PaymentDto> {
    return this.payments.getOwn(user.id, id);
  }

  /**
   * PAY-01: Stripe calls this; a user never does.
   *
   * No cookie and no guard, because Stripe has none. Its authentication is the
   * signature over the raw request bytes, which is why this reads req.rawBody
   * and binds no body DTO: parsing and re-serialising the JSON would change
   * the bytes and break the signature. The global validation pipe therefore
   * never touches this route either.
   *
   * It is excluded from Swagger because it cannot be driven from the browser:
   * a request without Stripe's signature is rejected. Drive it with the Stripe
   * CLI (stripe listen --forward-to localhost:3000/api/payments/webhook).
   */
  @Post('payments/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  @ApiHeader({ name: 'stripe-signature', required: true })
  async webhook(
    @Req() request: RawBodyRequest,
    @Headers('stripe-signature') signature?: string,
  ): Promise<WebhookOutcome> {
    if (!signature) {
      throw new BadRequestException({
        code: 'MISSING_WEBHOOK_SIGNATURE',
        message: 'The stripe-signature header is required',
      });
    }
    if (!request.rawBody) {
      // Only happens if the app was created without rawBody: true. Failing
      // loudly is better than verifying a re-serialised body, which would
      // either always fail or, worse, be skipped.
      throw new BadRequestException({
        code: 'RAW_BODY_UNAVAILABLE',
        message:
          'The raw request body is not available, so the signature cannot be ' +
          'verified',
      });
    }
    return this.webhooks.handle(request.rawBody, signature);
  }
}
