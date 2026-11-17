import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentDocument } from '../schemas/payment.schema';
import { PaymentDto } from './payment.dto';

/**
 * PAY-01: the payment plus the client secret the card form needs.
 *
 * The client secret is what keeps card details away from this backend: the
 * browser sends the card straight to Stripe with it, using Stripe Elements,
 * and the backend never sees a card number. It is not a credential for this
 * API: it only ever lets its holder complete this one PaymentIntent, which is
 * why it may be returned to the booking's owner.
 */
export class PaymentIntentDto extends PaymentDto {
  @ApiPropertyOptional({
    nullable: true,
    example: 'pi_3QabcdEFghijKLmn0PqRs_secret_9XyZ',
    description:
      'Pass this to Stripe Elements (or to Stripe CLI in test mode) to ' +
      'complete the payment. Null once the PaymentIntent is finished.',
  })
  clientSecret: string | null;

  @ApiProperty({
    example:
      'Complete the payment with Stripe Elements using clientSecret. The ' +
      'booking is confirmed only when the verified Stripe webhook arrives.',
  })
  nextStep: string;

  static from(
    payment: PaymentDocument,
    clientSecret: string | null | undefined,
  ): PaymentIntentDto {
    const dto = Object.assign(
      new PaymentIntentDto(),
      PaymentDto.fromDocument(payment),
    );
    dto.clientSecret = clientSecret ?? null;
    dto.nextStep =
      'Complete the payment with Stripe Elements using clientSecret. The ' +
      'booking is confirmed only when the verified Stripe webhook arrives.';
    return dto;
  }
}
