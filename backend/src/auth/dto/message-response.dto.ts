import { ApiProperty } from '@nestjs/swagger';

// Response of an action that changes state but has nothing to return.
export class MessageResponseDto {
  @ApiProperty({ example: 'Password changed' })
  message: string;

  constructor(message: string) {
    this.message = message;
  }
}
