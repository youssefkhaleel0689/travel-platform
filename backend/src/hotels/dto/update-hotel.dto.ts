import { PartialType } from '@nestjs/swagger';
import { CreateHotelDto } from './create-hotel.dto';

// Body of PATCH /api/hotels/:id (HTL-01). Assigned hotel moderator only.
// Every field of CreateHotelDto is optional and keeps the same validation.
// If cityId or countryId changes, the service checks the resulting pair
// against the seeded reference data.
export class UpdateHotelDto extends PartialType(CreateHotelDto) {}
