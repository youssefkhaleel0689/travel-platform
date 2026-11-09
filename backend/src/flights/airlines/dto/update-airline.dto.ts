import { PartialType } from '@nestjs/swagger';
import { CreateAirlineDto } from './create-airline.dto';

// Body of PATCH /airlines/:id (FLT-01): any of name, iataCode, icaoCode.
// status is not here: only the admin deactivate endpoint changes it (ACC-15).
export class UpdateAirlineDto extends PartialType(CreateAirlineDto) {}
