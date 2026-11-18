import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth/public.decorator';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';
import { EXCHANGE_RATES_UNAVAILABLE } from '../itineraries/itinerary-api-docs';
import { ExchangeRatesResponseDto } from './dto/exchange-rates-response.dto';
import { ExchangeRatesService } from './exchange-rates.service';

@ApiTags('Exchange Rates')
@Controller('exchange-rates')
export class ExchangeRatesController {
  constructor(private readonly exchangeRates: ExchangeRatesService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Latest exchange rates used for budget conversion (ITN-18)',
    description:
      'Open to guests: rates are not private. The backend fetches FXRatesAPI at most once a day and caches the answer; the API key never leaves the server.',
  })
  @ApiOkResponse({ type: ExchangeRatesResponseDto })
  @ApiErrorResponse(EXCHANGE_RATES_UNAVAILABLE)
  getRates() {
    return this.exchangeRates.getRates();
  }
}
