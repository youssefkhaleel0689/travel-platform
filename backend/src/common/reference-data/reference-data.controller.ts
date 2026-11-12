import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../pagination/api-paginated-response.decorator';
import { PageDto } from '../pagination/dto/page.dto';
import { PaginationQueryDto } from '../pagination/dto/pagination-query.dto';
import { ApiErrorResponse } from '../swagger/api-error-response.decorator';
import { AirportDto } from './dto/airport.dto';
import { AirportsQueryDto } from './dto/airports-query.dto';
import { CitiesQueryDto } from './dto/cities-query.dto';
import { CityDto } from './dto/city.dto';
import { CountryDto } from './dto/country.dto';
import { CurrencyDto } from './dto/currency.dto';
import { ReferenceDataService } from './reference-data.service';

// Public, read-only access to the seeded reference data.
// Each endpoint documents its own 400, so every example carries that endpoint's path.
@ApiTags('Reference data')
@Controller()
export class ReferenceDataController {
  constructor(private readonly referenceData: ReferenceDataService) {}

  @Get('airports')
  @ApiOperation({ summary: 'List seeded airports (FLT-02)' })
  @ApiPaginatedResponse(AirportDto)
  @ApiErrorResponse({
    status: 400,
    description: 'Bad page, bad filter format or unknown query parameter',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: '/api/airports',
        errors: [{ field: 'page', messages: ['page must not be less than 1'] }],
      },
    ],
  })
  listAirports(@Query() query: AirportsQueryDto): Promise<PageDto<AirportDto>> {
    const { page, cityId, countryId } = query;
    return this.referenceData.listAirports(page, { cityId, countryId });
  }

  @Get('countries')
  @ApiOperation({ summary: 'List seeded countries (ITN-01, HTL-01)' })
  @ApiPaginatedResponse(CountryDto)
  @ApiErrorResponse({
    status: 400,
    description: 'Bad page, bad filter format or unknown query parameter',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: '/api/countries',
        errors: [{ field: 'page', messages: ['page must not be less than 1'] }],
      },
    ],
  })
  listCountries(
    @Query() query: PaginationQueryDto,
  ): Promise<PageDto<CountryDto>> {
    return this.referenceData.listCountries(query.page);
  }

  @Get('cities')
  @ApiOperation({ summary: 'List seeded cities (ITN-05, ITN-16, HTL-01)' })
  @ApiPaginatedResponse(CityDto)
  @ApiErrorResponse({
    status: 400,
    description: 'Bad page, bad filter format or unknown query parameter',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: '/api/cities',
        errors: [{ field: 'page', messages: ['page must not be less than 1'] }],
      },
    ],
  })
  listCities(@Query() query: CitiesQueryDto): Promise<PageDto<CityDto>> {
    const { page, countryId } = query;
    return this.referenceData.listCities(page, { countryId });
  }

  @Get('currencies')
  @ApiOperation({ summary: 'List seeded currencies (ACC-09, ITN-18)' })
  @ApiPaginatedResponse(CurrencyDto)
  @ApiErrorResponse({
    status: 400,
    description: 'Bad page, bad filter format or unknown query parameter',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: '/api/currencies',
        errors: [{ field: 'page', messages: ['page must not be less than 1'] }],
      },
    ],
  })
  listCurrencies(
    @Query() query: PaginationQueryDto,
  ): Promise<PageDto<CurrencyDto>> {
    return this.referenceData.listCurrencies(query.page);
  }
}
