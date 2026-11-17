import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from '../common/auth/public.decorator';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';
import { HotelSearchDto } from "./dto/hotel-search.dto";
import { HotelSearchService } from "./hotel-search.service";

const PATH = '/api/hotels/search';

@ApiTags("Hotel search (B2)")
@Controller("hotels/search")
export class HotelSearchController {
  constructor(private readonly service: HotelSearchService) {}

  @Get()
  @Public()
  @ApiOkResponse({ description: 'Paginated list of hotels with available rooms' })
  @ApiErrorResponse({
    status: 400,
    description: 'Invalid search parameters (VALIDATION_FAILED)',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: PATH,
        errors: [{ field: 'checkInDate', messages: ['checkInDate must be a valid ISO 8601 date'] }],
      },
      {
        code: 'DESTINATION_REQUIRED',
        message: 'Provide cityId or countryId',
        path: PATH,
      },
      {
        code: 'UNKNOWN_CITY',
        message: 'Unknown city: unknown_city',
        path: PATH,
      },
      {
        code: 'UNKNOWN_COUNTRY',
        message: 'Unknown country: ZZ',
        path: PATH,
      },
    ],
  })
  @ApiOperation({
    summary: "HTL-11/12 Search available hotels (PUBLIC)",
    description:
      "Access: PUBLIC — no login required. Searches active hotels by seeded cityId or countryId that have enough rooms available for the complete requested stay. Supports minimum/maximum price, minimum rating, and sorting.",
  })
  search(@Query() dto: HotelSearchDto) {
    return this.service.search(dto);
  }
}
