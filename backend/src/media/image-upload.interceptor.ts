import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import { IMAGE_UPLOAD_FIELD, MAX_IMAGE_BYTES } from './media.constants';
import { fileTooLarge } from './media.service';

const MultipartImage = FileInterceptor(IMAGE_UPLOAD_FIELD, {
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
});

// Reads one image from the "file" field and turns multer's errors into the
// usual error format (400 FILE_TOO_LARGE instead of a bare 413).
@Injectable()
export class ImageUploadInterceptor implements NestInterceptor {
  private readonly multipart = new MultipartImage();

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    try {
      return await this.multipart.intercept(context, next);
    } catch (error) {
      throw translateUploadError(error);
    }
  }
}

function translateUploadError(error: unknown): unknown {
  if (!(error instanceof HttpException)) {
    return error;
  }
  if (error.getStatus() === HttpStatus.PAYLOAD_TOO_LARGE) {
    return fileTooLarge();
  }
  if (error.getStatus() === HttpStatus.BAD_REQUEST) {
    return new BadRequestException({
      code: 'INVALID_UPLOAD',
      message: `Send exactly one image in the form field "${IMAGE_UPLOAD_FIELD}"`,
      errors: [
        {
          field: IMAGE_UPLOAD_FIELD,
          messages: [`exactly one file is expected in "${IMAGE_UPLOAD_FIELD}"`],
        },
      ],
    });
  }
  return error;
}
