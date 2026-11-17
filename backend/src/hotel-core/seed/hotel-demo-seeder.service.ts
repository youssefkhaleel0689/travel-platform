import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UsersService } from '../../auth/users/users.service';
import { Availability, AvailabilityStatus } from '../../availability/schemas/availability.schema';
import { Hotel, HotelStatus } from '../schemas/hotel.schema';
import { Room } from '../../rooms/schemas/room.schema';

interface DemoHotel {
  name: string;
  address: string;
  cityId: string;
  countryId: string;
  starClass: number;
  pricePerNight: string;
}

// Hotels in the seeded reference cities, so search and room lists show data in Swagger.
const DEMO_HOTELS: DemoHotel[] = [
  { name: 'Cairo Nile View Hotel', address: '1 Nile Corniche', cityId: 'cairo', countryId: 'EG', starClass: 4, pricePerNight: '120.00' },
  { name: 'Dubai Marina Suites', address: '12 Marina Walk', cityId: 'dubai', countryId: 'AE', starClass: 5, pricePerNight: '210.00' },
  { name: 'London Bridge Hotel', address: '8 London Bridge', cityId: 'london', countryId: 'GB', starClass: 4, pricePerNight: '180.00' },
  { name: 'Paris Eiffel Residence', address: '5 Avenue de Tour Eiffel', cityId: 'paris', countryId: 'FR', starClass: 4, pricePerNight: '195.00' },
  { name: 'New York Central Inn', address: '100 Broadway', cityId: 'new_york', countryId: 'US', starClass: 3, pricePerNight: '160.00' },
  { name: 'Tokyo Garden Hotel', address: '3-1 Ginza', cityId: 'tokyo', countryId: 'JP', starClass: 5, pricePerNight: '230.00' },
  { name: 'Riyadh Business Hotel', address: '20 King Fahd Road', cityId: 'riyadh', countryId: 'SA', starClass: 4, pricePerNight: '140.00' },
  { name: 'Frankfurt Airport Hotel', address: '1 Airport Avenue', cityId: 'frankfurt', countryId: 'DE', starClass: 3, pricePerNight: '110.00' },
];

const AVAILABLE_FROM = new Date('2026-11-01T00:00:00.000Z');
const AVAILABLE_TO = new Date('2027-12-31T00:00:00.000Z');

@Injectable()
export class HotelDemoSeeder {
  private readonly logger = new Logger(HotelDemoSeeder.name);

  constructor(
    @InjectModel(Hotel.name) private readonly hotelModel: Model<Hotel>,
    @InjectModel(Room.name) private readonly roomModel: Model<Room>,
    @InjectModel(Availability.name)
    private readonly availabilityModel: Model<Availability>,
    private readonly users: UsersService,
  ) {}

  /** Safe to run repeatedly: matches by natural key and never deletes. */
  async seed(): Promise<void> {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      throw new Error('ADMIN_EMAIL is required for the demo hotel seed');
    }
    const admin = await this.users.findByEmail(adminEmail);
    if (!admin) {
      throw new Error('No seeded admin found for ADMIN_EMAIL; run npm run seed:admin first');
    }
    const createdBy = new Types.ObjectId(admin.id);

    let hotelsCreated = 0;
    let roomsCreated = 0;
    let rangesCreated = 0;

    for (const demo of DEMO_HOTELS) {
      let hotel = await this.hotelModel
        .findOne({ name: demo.name, cityId: demo.cityId })
        .exec();
      if (!hotel) {
        hotel = await this.hotelModel.create({
          name: demo.name,
          address: demo.address,
          cityId: demo.cityId,
          countryId: demo.countryId,
          description: `${demo.name} in ${demo.cityId}, close to the city centre.`,
          starClass: demo.starClass,
          status: HotelStatus.ACTIVE,
          createdBy,
        });
        hotelsCreated++;
      }

      for (const [index, roomNumber] of ['101', '102', '103'].entries()) {
        let room = await this.roomModel
          .findOne({ hotelId: hotel._id, roomNumber })
          .exec();
        if (!room) {
          room = await this.roomModel.create({
            hotelId: hotel._id,
            roomNumber,
            name: index === 0 ? 'Standard Room' : index === 1 ? 'Deluxe Room' : 'Suite',
            type: index === 2 ? 'SUITE' : 'DOUBLE',
            beds: index === 2 ? 2 : 1,
            maxOccupancy: index === 2 ? 4 : 2,
            pricePerNight: Types.Decimal128.fromString(demo.pricePerNight),
          });
          roomsCreated++;
        }

        const rangeExists = await this.availabilityModel.exists({
          roomId: room._id,
          status: AvailabilityStatus.AVAILABLE,
          startDate: { $lte: AVAILABLE_FROM },
          endDate: { $gte: AVAILABLE_TO },
        });
        if (!rangeExists) {
          await this.availabilityModel.create({
            hotelId: hotel._id,
            roomId: room._id,
            startDate: AVAILABLE_FROM,
            endDate: AVAILABLE_TO,
            status: AvailabilityStatus.AVAILABLE,
            createdBy,
          });
          rangesCreated++;
        }
      }
    }

    this.logger.log(
      `demo hotels: total=${DEMO_HOTELS.length} hotelsCreated=${hotelsCreated} roomsCreated=${roomsCreated} rangesCreated=${rangesCreated}`,
    );
  }
}
