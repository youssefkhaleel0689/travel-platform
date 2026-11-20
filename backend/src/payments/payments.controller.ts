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
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { PLATFORM_CURRENCY } from '../common/money/money';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';
import { forbidden, unauthenticated } from '../common/swagger/standard-errors';
import type { Request } from 'express';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { Public } from '../common/auth/public.decorator';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
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
  @ApiErrorResponse({
    status: 400,
    description: 'Invalid body, or Stripe rejected the request',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Invalid body, or Stripe rejected the request',
        path: '/api/payments',
      },
    ],
  })
  @ApiErrorResponse(unauthenticated('/api/payments'))
  @ApiErrorResponse(forbidden('/api/payments'))
  @ApiErrorResponse({
    status: 404,
    description:
      'No booking of that type and id belongs to this account. The same 404 ' +
      'covers a booking that does not exist and one that is not yours, so ' +
      'booking ids cannot be probed (ACC-11).',
    examples: [
      {
        code: 'NOT_FOUND',
        message: 'Booking not found',
        path: '/api/payments',
      },
    ],
  })
  @ApiErrorResponse({
    status: 409,
    description:
      'The booking is not in a state that can be paid for. Pick the code in ' +
      'the dropdown to see each body.',
    examples: [
      {
        code: 'BOOKING_NOT_AWAITING_PAYMENT',
        message: 'This booking is CONFIRMED and cannot be paid for',
        path: '/api/payments',
      },
      {
        code: 'HOLD_EXPIRED',
        message:
          'The hold on this booking has expired. Start a new booking to ' +
          'reserve the seats or rooms again.',
        path: '/api/payments',
      },
      {
        code: 'ALREADY_PAID',
        message: 'This booking has already been paid for',
        path: '/api/payments',
      },
      {
        code: 'PAYMENT_ATTEMPT_CLOSED',
        message:
          'The last payment attempt is closed. Retry it with POST ' +
          '/api/payments/{id}/retry.',
        path: '/api/payments',
      },
      {
        code: 'UNSUPPORTED_BOOKING_CURRENCY',
        message: `Bookings must be priced in ${PLATFORM_CURRENCY}`,
        path: '/api/payments',
      },
    ],
  })
  @ApiErrorResponse({
    status: 503,
    description:
      'Payments are switched off on this server, or Stripe itself could not ' +
      'be reached. Nothing was charged either way.',
    examples: [
      {
        code: 'PAYMENTS_UNAVAILABLE',
        message:
          'Payments are not configured on this server: STRIPE_SECRET_KEY is ' +
          'missing',
        path: '/api/payments',
      },
      {
        code: 'STRIPE_UNAVAILABLE',
        message: 'The payment provider is unavailable, please try again',
        path: '/api/payments',
      },
    ],
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentDto,
  ): Promise<PaymentIntentDto> {
    return this.payments.createForBooking(
      user.userId,
      dto.bookingType,
      dto.bookingId,
    );
  }

  @Post('payments/:id/retry')
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
  @ApiErrorResponse(unauthenticated('/api/payments'))
  @ApiErrorResponse({
    status: 404,
    description:
      'No payment of that id belongs to this account - the same 404 as one ' +
      'that does not exist (ACC-11).',
    examples: [
      {
        code: 'NOT_FOUND',
        message: 'Payment not found',
        path: '/api/payments/6720f1c2a1b2c3d4e5f60910/retry',
      },
    ],
  })
  @ApiErrorResponse({
    status: 409,
    description:
      'There is nothing left to retry, or the booking can no longer be paid ' +
      'for. The status is refreshed from Stripe first, so a payment that ' +
      'succeeded while the page was open is reported as ALREADY_PAID rather ' +
      'than charged twice.',
    examples: [
      {
        code: 'ALREADY_PAID',
        message: 'This payment already succeeded',
        path: '/api/payments/6720f1c2a1b2c3d4e5f60910/retry',
      },
      {
        code: 'HOLD_EXPIRED',
        message:
          'The hold on this booking has expired. Start a new booking to ' +
          'reserve the seats or rooms again.',
        path: '/api/payments/6720f1c2a1b2c3d4e5f60910/retry',
      },
      {
        code: 'BOOKING_NOT_AWAITING_PAYMENT',
        message: 'This booking is CANCELLED and cannot be paid for',
        path: '/api/payments/6720f1c2a1b2c3d4e5f60910/retry',
      },
    ],
  })
  @ApiErrorResponse({
    status: 503,
    description:
      'Payments are switched off on this server, or Stripe itself could not ' +
      'be reached. Nothing was charged either way.',
    examples: [
      {
        code: 'PAYMENTS_UNAVAILABLE',
        message:
          'Payments are not configured on this server: STRIPE_SECRET_KEY is ' +
          'missing',
        path: '/api/payments/6720f1c2a1b2c3d4e5f60910/retry',
      },
      {
        code: 'STRIPE_UNAVAILABLE',
        message: 'The payment provider is unavailable, please try again',
        path: '/api/payments/6720f1c2a1b2c3d4e5f60910/retry',
      },
    ],
  })
  retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<PaymentIntentDto> {
    return this.payments.retry(user.userId, id);
  }

  @Get('payments/:id')
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
  @ApiErrorResponse(unauthenticated('/api/payments'))
  @ApiErrorResponse({
    status: 404,
    description:
      'No payment of that id belongs to this account - the same 404 as one ' +
      'that does not exist (ACC-11).',
    examples: [
      {
        code: 'NOT_FOUND',
        message: 'Payment not found',
        path: '/api/payments/6720f1c2a1b2c3d4e5f60910',
      },
    ],
  })
  @ApiErrorResponse({
    status: 503,
    description:
      'Payments are switched off on this server, or Stripe could not be ' +
      'reached for the status refresh.',
    examples: [
      {
        code: 'PAYMENTS_UNAVAILABLE',
        message:
          'Payments are not configured on this server: STRIPE_SECRET_KEY is ' +
          'missing',
        path: '/api/payments/6720f1c2a1b2c3d4e5f60910',
      },
      {
        code: 'STRIPE_UNAVAILABLE',
        message: 'The payment provider is unavailable, please try again',
        path: '/api/payments/6720f1c2a1b2c3d4e5f60910',
      },
    ],
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<PaymentDto> {
    return this.payments.getOwn(user.userId, id);
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
  // @Public: Stripe has no cookie, so the global JwtAuthGuard would answer 401
  // and no booking would ever be confirmed. The route authenticates itself, by
  // verifying Stripe's signature over the raw body, which is stronger than a
  // session cookie for this purpose.
  @Public()
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
