import { Controller, Get, Param, Query, StreamableFile } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { BudgetSummaryQueryDto } from './dto/budget-summary-query.dto';
import {
  ApiErrorResponse,
  ApiItineraryAuth,
  EXCHANGE_RATES_UNAVAILABLE,
  ITINERARY_NOT_FOUND_EXAMPLE,
  notFoundError,
} from './itinerary-api-docs';
import { ItineraryPdfService } from './itinerary-pdf.service';

const PATH = '/api/itineraries/{id}/pdf';

@ApiTags('Itineraries - Export')
@ApiCookieAuth()
@ApiItineraryAuth(PATH)
@Controller('itineraries')
export class ItineraryPdfController {
  constructor(private readonly pdf: ItineraryPdfService) {}

  @Get(':id/pdf')
  @ApiOperation({
    summary: 'Export your itinerary as a PDF (ITN-28)',
    description:
      'Owner only. The document includes the days, city groups, transport ' +
      'costs and the budget converted to the requested display currency.',
  })
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description: 'The itinerary, downloaded as itinerary-<title>.pdf',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiErrorResponse(notFoundError(PATH, ITINERARY_NOT_FOUND_EXAMPLE))
  @ApiErrorResponse(EXCHANGE_RATES_UNAVAILABLE)
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: BudgetSummaryQueryDto,
  ): Promise<StreamableFile> {
    const content = await this.pdf.render(user, id, query.currency);
    const safeTitle = 'itinerary';
    return new StreamableFile(content, {
      type: 'application/pdf',
      disposition: `attachment; filename="${safeTitle}.pdf"`,
    });
  }
}
