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

// Multer stops reading at 5 MB, so a 2 GB upload never fills the server's
// memory, and keeps the file in memory (no dest), so MediaService can check
// the bytes before anything touches the disk.
const MultipartImage = FileInterceptor(IMAGE_UPLOAD_FIELD, {
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
});

/**
 * Reads the one image of a multipart upload (GEN-08) and turns multer's own
 * errors into the shared error format, so a too-large file answers
 * 400 FILE_TOO_LARGE like every other upload rule instead of a bare 413.
 *
 * Use it on any upload route: @UseInterceptors(ImageUploadInterceptor), then
 * @UploadedFile() file: UploadedImage, and pass the file to MediaService.
 */
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
    // Multer's "Unexpected field" / "Too many files": the client used another
    // field name or sent several files.
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
