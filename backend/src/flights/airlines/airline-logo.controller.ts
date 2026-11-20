import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  StreamableFile,
  UploadedFile,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { createReadStream } from 'node:fs';
import { Role } from '../../common/auth/auth.enums';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import {
  CurrentUser,
  OptionalUser,
} from '../../common/auth/current-user.decorator';
import { Public } from '../../common/auth/public.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { ApiErrorResponse } from '../../common/swagger/api-error-response.decorator';
import {
  forbidden,
  unauthenticated,
} from '../../common/swagger/standard-errors';
import { ApiImageUpload } from '../../media/api-image-upload.decorator';
import { IMAGE_MIME_TYPES } from '../../media/media.constants';
import type { UploadedImage } from '../../media/media.service';
import { AirlineLogoService } from './airline-logo.service';
import { AirlineIdParamDto } from './dto/airline-id-param.dto';
import { AirlineLogoDto } from './dto/airline-logo.dto';

const EXAMPLE_AIRLINE_ID = '6720f1c2a1b2c3d4e5f60718';
const LOGO = `/api/airlines/${EXAMPLE_AIRLINE_ID}/logo`;

const AIRLINE_NOT_FOUND = {
  code: 'AIRLINE_NOT_FOUND',
  message: 'Airline not found',
  path: LOGO,
};
const LOGO_NOT_FOUND = {
  code: 'LOGO_NOT_FOUND',
  message: 'This airline has no logo',
  path: LOGO,
};

// FLT-01 / GEN-08: the airline logo. PUT and DELETE need ADMIN or AIRLINE_MODERATOR (a
// moderator only for the airline they are assigned to, checked in the service); GET is
// public. The route sits under /airlines like the other airline routes.
@ApiTags('Airlines')
@Controller('airlines')
export class AirlineLogoController {
  constructor(private readonly logos: AirlineLogoService) {}

  @Put(':id/logo')
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiImageUpload(LOGO, 'airline', 1)
  @ApiOperation({
    summary: 'Upload or replace the airline logo (FLT-01, GEN-08)',
    description:
      'Admin, or the airline moderator assigned to this airline. Multipart, field ' +
      '"file": one JPG or PNG of at most 5 MB. A new logo replaces the old one; a ' +
      'rejected file leaves the old one in place. The response has the URL that ' +
      'serves it, which is also airline.logo.',
  })
  @ApiOkResponse({ type: AirlineLogoDto })
  @ApiErrorResponse(unauthenticated(LOGO))
  @ApiErrorResponse(forbidden(LOGO, { role: true, passwordChange: true }))
  @ApiErrorResponse({
    status: 404,
    description: 'No such airline (AIRLINE_NOT_FOUND)',
    examples: [AIRLINE_NOT_FOUND],
  })
  @ApiErrorResponse({
    status: 409,
    description:
      'Two uploads for the same airline kept replacing each other (CONCURRENT_UPDATE); try again',
    examples: [
      {
        code: 'CONCURRENT_UPDATE',
        message:
          'Another logo upload for this airline is in progress, please try again',
        path: LOGO,
      },
    ],
  })
  setLogo(
    @Param() params: AirlineIdParamDto,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<AirlineLogoDto> {
    return this.logos.setLogo(params.id, user, file);
  }

  @Get(':id/logo')
  @Public()
  @ApiOperation({
    summary: 'Download the airline logo (FLT-01, GEN-08)',
    description:
      'Public for ACTIVE airlines. A DEACTIVATED airline’s logo is visible only to an ' +
      'admin or its assigned moderator; others get 404.',
  })
  @ApiProduces(...IMAGE_MIME_TYPES)
  @ApiOkResponse({
    description: 'The logo file',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiErrorResponse({
    status: 404,
    description: 'No such airline, or it has no logo',
    examples: [AIRLINE_NOT_FOUND, LOGO_NOT_FOUND],
  })
  async getLogo(
    @Param() params: AirlineIdParamDto,
    @OptionalUser() viewer: AuthenticatedUser | undefined,
  ): Promise<StreamableFile> {
    const logo = await this.logos.openLogo(params.id, viewer);
    return new StreamableFile(createReadStream(logo.path), {
      type: logo.mimeType,
      length: logo.sizeBytes,
    });
  }

  @Delete(':id/logo')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Remove the airline logo (FLT-01, GEN-08)',
    description:
      'Admin, or the airline moderator assigned to this airline. airline.logo goes ' +
      'back to null.',
  })
  @ApiNoContentResponse({ description: 'The logo and its file are gone' })
  @ApiErrorResponse(unauthenticated(LOGO))
  @ApiErrorResponse(forbidden(LOGO, { role: true, passwordChange: true }))
  @ApiErrorResponse({
    status: 404,
    description: 'No such airline, or it has no logo',
    examples: [AIRLINE_NOT_FOUND, LOGO_NOT_FOUND],
  })
  async removeLogo(
    @Param() params: AirlineIdParamDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.logos.removeLogo(params.id, user);
  }
}
