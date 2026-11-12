import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponse } from '../../common/swagger/api-error-response.decorator';
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
  @ApiErrorResponse({
    status: 400,
    description: 'Validation failed (field-level errors)',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: '/api/airlines',
        errors: [
          {
            field: 'iataCode',
            messages: ['iataCode must be 2 letters or digits (for example MS)'],
          },
        ],
      },
    ],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Not an admin',
    examples: [
      {
        code: 'FORBIDDEN',
        message: 'Only an admin can create an airline',
        path: '/api/airlines',
      },
    ],
  })
  @ApiErrorResponse({
    status: 409,
    description: 'iataCode or icaoCode already used (DUPLICATE_KEY)',
    examples: [
      {
        code: 'DUPLICATE_KEY',
        message: 'iataCode already exists',
        path: '/api/airlines',
        errors: [{ field: 'iataCode', messages: ['already exists'] }],
      },
    ],
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
  @ApiErrorResponse({
    status: 400,
    description: 'Bad id',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: '/api/airlines/not-an-id',
        errors: [{ field: 'id', messages: ['id must be a mongodb id'] }],
      },
    ],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'No such airline (AIRLINE_NOT_FOUND)',
    examples: [
      {
        code: 'AIRLINE_NOT_FOUND',
        message: 'Airline not found',
        path: '/api/airlines/6720f1c2a1b2c3d4e5f60718',
      },
    ],
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
  @ApiErrorResponse({
    status: 400,
    description: 'Validation failed, or no field sent (EMPTY_UPDATE)',
    examples: [
      {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        path: '/api/airlines/6720f1c2a1b2c3d4e5f60718',
        errors: [
          {
            field: 'icaoCode',
            messages: ['icaoCode must be 3 letters (for example MSR)'],
          },
        ],
      },
      {
        code: 'EMPTY_UPDATE',
        message: 'Send at least one of name, iataCode, icaoCode',
        path: '/api/airlines/6720f1c2a1b2c3d4e5f60718',
        errors: [
          {
            field: 'body',
            messages: ['send at least one of name, iataCode, icaoCode'],
          },
        ],
      },
    ],
  })
  @ApiErrorResponse({
    status: 403,
    description: 'Not an admin, or a moderator of another airline',
    examples: [
      {
        code: 'FORBIDDEN',
        message: 'You can only edit the airline you are assigned to',
        path: '/api/airlines/6720f1c2a1b2c3d4e5f60718',
      },
    ],
  })
  @ApiErrorResponse({
    status: 404,
    description: 'No such airline (AIRLINE_NOT_FOUND)',
    examples: [
      {
        code: 'AIRLINE_NOT_FOUND',
        message: 'Airline not found',
        path: '/api/airlines/6720f1c2a1b2c3d4e5f60718',
      },
    ],
  })
  @ApiErrorResponse({
    status: 409,
    description: 'iataCode or icaoCode already used (DUPLICATE_KEY)',
    examples: [
      {
        code: 'DUPLICATE_KEY',
        message: 'iataCode already exists',
        path: '/api/airlines/6720f1c2a1b2c3d4e5f60718',
        errors: [{ field: 'iataCode', messages: ['already exists'] }],
      },
    ],
  })
  update(
    @Param() params: AirlineIdParamDto,
    @Body() dto: UpdateAirlineDto,
    @Req() request: RequestWithActor,
  ): Promise<AirlineDto> {
    return this.airlines.update(params.id, dto, resolveWriteActor(request));
  }
}
