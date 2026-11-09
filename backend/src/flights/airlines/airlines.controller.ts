import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { resolveWriteActor } from './airline-actor';
import type { RequestWithActor } from './airline-actor';
import { AirlinesService } from './airlines.service';
import { AirlineIdParamDto } from './dto/airline-id-param.dto';
import { AirlineDto } from './dto/airline.dto';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';

// FLT-01: airline profiles.
// TODO(ACC-04): add the auth guard and role decorators when Youssef's auth is merged:
// POST needs ADMIN, PATCH needs ADMIN or AIRLINE_MODERATOR, GET stays public.
// Until then the write endpoints run as a placeholder admin (see airline-actor.ts).
@ApiTags('Airlines')
@Controller('airlines')
export class AirlinesController {
  constructor(private readonly airlines: AirlinesService) {}

  @Post()
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Create an airline profile (FLT-01, admin only)',
    description:
      'The airline starts ACTIVE with no logo. The logo is uploaded later (GEN-08).',
  })
  @ApiBody({ type: CreateAirlineDto })
  @ApiCreatedResponse({ type: AirlineDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Validation failed (field-level errors)',
  })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Not an admin' })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'iataCode or icaoCode already used (DUPLICATE_KEY)',
  })
  create(
    @Body() dto: CreateAirlineDto,
    @Req() request: RequestWithActor,
  ): Promise<AirlineDto> {
    return this.airlines.create(dto, resolveWriteActor(request));
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one airline (FLT-01)',
    description:
      'Public for ACTIVE airlines. A DEACTIVATED airline is visible only to an admin ' +
      'or its assigned moderator; others get 404.',
  })
  @ApiOkResponse({ type: AirlineDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Bad id' })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such airline (AIRLINE_NOT_FOUND)',
  })
  findOne(
    @Param() params: AirlineIdParamDto,
    @Req() request: RequestWithActor,
  ): Promise<AirlineDto> {
    // A guest has no user. Reads never use the placeholder admin.
    return this.airlines.findOne(params.id, request.user);
  }

  @Patch(':id')
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: "Edit an airline's name and codes (FLT-01)",
    description:
      'Admin, or the airline moderator assigned to this airline. Send at least one field. ' +
      'status and logo cannot be changed here.',
  })
  @ApiBody({ type: UpdateAirlineDto })
  @ApiOkResponse({ type: AirlineDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Validation failed, or no field sent (EMPTY_UPDATE)',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Not an admin, or a moderator of another airline',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such airline (AIRLINE_NOT_FOUND)',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'iataCode or icaoCode already used (DUPLICATE_KEY)',
  })
  update(
    @Param() params: AirlineIdParamDto,
    @Body() dto: UpdateAirlineDto,
    @Req() request: RequestWithActor,
  ): Promise<AirlineDto> {
    return this.airlines.update(params.id, dto, resolveWriteActor(request));
  }
}
