import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { HotelSearchDto } from "./dto/hotel-search.dto";
import { HotelSearchService } from "./hotel-search.service";

@ApiTags("Hotel search (B2)")
@Controller("hotels/search")
export class HotelSearchController {
  constructor(private readonly service: HotelSearchService) {}

  @Get()
  @ApiOperation({
    summary: "HTL-11/12 Search available hotels (PUBLIC)",
    description:
      "Access: PUBLIC — no login required. Searches active hotels that have enough rooms available for the complete requested stay. Supports minimum/maximum price, minimum rating, and sorting.",
  })
  search(@Query() dto: HotelSearchDto) {
    return this.service.search(dto);
  }
}
