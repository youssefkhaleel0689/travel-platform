import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FieldErrorDto {
  @ApiProperty({
    example: 'email',
    description: 'Dotted path, e.g. passengers.0.name',
  })
  field: string;

  @ApiProperty({ type: [String], example: ['email must be an email'] })
  messages: string[];
}

// The single error shape returned by every endpoint (see AllExceptionsFilter).
export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({
    example: 'VALIDATION_FAILED',
    description:
      'Stable machine-readable code, e.g. NOT_FOUND, SEAT_UNAVAILABLE',
  })
  code: string;

  @ApiProperty({ example: 'Bad Request', description: 'HTTP reason phrase' })
  error: string;

  @ApiProperty({ example: 'Validation failed' })
  message: string;

  @ApiPropertyOptional({
    type: [FieldErrorDto],
    description:
      'Per-field errors; only present for validation and duplicate key errors',
  })
  errors?: FieldErrorDto[];

  @ApiProperty({ example: '/api/auth/register' })
  path: string;

  @ApiProperty({ example: '2026-11-03T10:00:00.000Z' })
  timestamp: string;
}
