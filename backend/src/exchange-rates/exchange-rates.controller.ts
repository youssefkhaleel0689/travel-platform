import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { ExchangeRatesResponseDto } from './dto/exchange-rates-response.dto';
import { ExchangeRatesService } from './exchange-rates.service';

@ApiTags('Exchange Rates')
@Controller('exchange-rates')
export class ExchangeRatesController {
  constructor(private readonly exchangeRates: ExchangeRatesService) {}

  @Get()
  @ApiOperation({
    summary: 'Latest exchange rates used for budget conversion (ITN-18)',
  })
  @ApiOkResponse({ type: ExchangeRatesResponseDto })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto })
  getRates() {
    return this.exchangeRates.getRates();
  }
}
