import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { ApiErrorResponse } from '../common/swagger/api-error-response.decorator';
import { ImageUploadInterceptor } from './image-upload.interceptor';
import { IMAGE_UPLOAD_FIELD } from './media.constants';
import { imageLimitMessage } from './media.service';

export function ApiImageUpload(path: string, targetLabel: string, limit = 5) {
  return applyDecorators(
    UseInterceptors(ImageUploadInterceptor),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: [IMAGE_UPLOAD_FIELD],
        properties: {
          [IMAGE_UPLOAD_FIELD]: {
            type: 'string',
            format: 'binary',
            description: 'One JPG or PNG image, at most 5 MB',
          },
        },
      },
    }),
    ApiErrorResponse({
      status: 400,
      description:
        'No file, not a JPG or PNG (checked on the bytes, not the name), ' +
        'larger than 5 MB, or not sent in the "file" field',
      examples: [
        { code: 'FILE_REQUIRED', message: 'An image file is required', path },
        {
          code: 'INVALID_FILE_TYPE',
          message: 'Only JPG and PNG images are accepted',
          path,
        },
        {
          code: 'FILE_TOO_LARGE',
          message: 'Images must be at most 5 MB',
          path,
        },
        {
          code: 'INVALID_UPLOAD',
          message: 'Send exactly one image in the form field "file"',
          path,
        },
      ],
    }),
    ApiErrorResponse({
      status: 409,
      description: `The ${targetLabel} already has its maximum number of images`,
      examples: [
        {
          code: 'IMAGE_LIMIT_REACHED',
          message: imageLimitMessage(targetLabel, limit),
          path,
        },
      ],
    }),
  );
}
