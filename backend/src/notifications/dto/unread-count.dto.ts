import { ApiProperty } from '@nestjs/swagger';

// GEN-01: the number behind the bell icon.
export class UnreadCountDto {
  @ApiProperty({ example: 3 })
  unreadCount: number;

  constructor(unreadCount: number) {
    this.unreadCount = unreadCount;
  }
}
