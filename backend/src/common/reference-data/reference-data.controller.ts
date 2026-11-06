import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { ApiPaginatedResponse } from '../pagination/api-paginated-response.decorator';
import { PageDto } from '../pagination/dto/page.dto';
import { PaginationQueryDto } from '../pagination/dto/pagination-query.dto';
import { AirportDto } from './dto/airport.dto';
import { AirportsQueryDto } from './dto/airports-query.dto';
import { CitiesQueryDto } from './dto/cities-query.dto';
import { CityDto } from './dto/city.dto';
import { CountryDto } from './dto/country.dto';
import { CurrencyDto } from './dto/currency.dto';
import { ReferenceDataService } from './reference-data.service';

// Public, read-only access to the seeded reference data.
@ApiTags('Reference data')
@ApiBadRequestResponse({
  type: ErrorResponseDto,
  description: 'Bad page, bad filter format or unknown query parameter',
})
@Controller()
export class ReferenceDataController {
  constructor(private readonly referenceData: ReferenceDataService) {}

  @Get('airports')
  @ApiOperation({ summary: 'List seeded airports (FLT-02)' })
  @ApiPaginatedResponse(AirportDto)
  listAirports(@Query() query: AirportsQueryDto): Promise<PageDto<AirportDto>> {
    const { page, cityId, countryId } = query;
    return this.referenceData.listAirports(page, { cityId, countryId });
  }

  @Get('countries')
  @ApiOperation({ summary: 'List seeded countries (FLT-02)' })
  @ApiPaginatedResponse(CountryDto)
  listCountries(
    @Query() query: PaginationQueryDto,
  ): Promise<PageDto<CountryDto>> {
    return this.referenceData.listCountries(query.page);
  }

  @Get('cities')
  @ApiOperation({ summary: 'List seeded cities (FLT-02)' })
  @ApiPaginatedResponse(CityDto)
  listCities(@Query() query: CitiesQueryDto): Promise<PageDto<CityDto>> {
    const { page, countryId } = query;
    return this.referenceData.listCities(page, { countryId });
  }

  @Get('currencies')
  @ApiOperation({ summary: 'List seeded currencies (FLT-02)' })
  @ApiPaginatedResponse(CurrencyDto)
  listCurrencies(
    @Query() query: PaginationQueryDto,
  ): Promise<PageDto<CurrencyDto>> {
    return this.referenceData.listCurrencies(query.page);
  }
}
