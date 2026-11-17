// This test WRITES to the shared database (FLT-22). It creates its own flights with a
// random airlineId that matches no airline (so search never shows them), flight numbers
// starting with KE and dates in 2099, and afterAll deletes exactly those flights by _id.
// It needs MONGODB_URI in backend/.env.
import { HttpException } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import {
  CabinCategory,
  CabinInventory,
  Flight,
  FlightSchema,
  FlightStatus,
} from './../src/flights/schemas/flight.schema';
import {
  SeatChange,
  SeatInventoryService,
} from './../src/flights/seat-inventory/seat-inventory.service';

// Connecting to Atlas and running many round trips can take longer than Jest's 5 seconds.
const CONNECT_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 60_000;

const TEST_AIRLINE_ID = new Types.ObjectId();
const ECONOMY = CabinCategory.ECONOMY;

describe('SeatInventoryService (e2e, shared database)', () => {
  let moduleRef: TestingModule;
  let seats: SeatInventoryService;
  let flightModel: Model<Flight>;
  let connection: Connection;
  const createdIds: Types.ObjectId[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        MongooseModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            uri: config.getOrThrow<string>('MONGODB_URI'),
          }),
        }),
        MongooseModule.forFeature([
          { name: Flight.name, schema: FlightSchema },
        ]),
      ],
      providers: [SeatInventoryService],
    }).compile();

    seats = moduleRef.get(SeatInventoryService);
    flightModel = moduleRef.get<Model<Flight>>(getModelToken(Flight.name));
    connection = moduleRef.get<Connection>(getConnectionToken());
  }, CONNECT_TIMEOUT_MS);

  // Deletes only the flights this file created, then closes the connection.
  afterAll(async () => {
    if (createdIds.length > 0) {
      await flightModel.deleteMany({ _id: { $in: createdIds } }).exec();
    }
    await moduleRef.close();
  }, CONNECT_TIMEOUT_MS);

  // A SCHEDULED test flight in 2099 with one ECONOMY cabin.
  async function createFlight(
    totalSeats: number,
    counters: { bookedSeats?: number; heldSeats?: number } = {},
  ): Promise<Types.ObjectId> {
    const number = String(createdIds.length + 1).padStart(4, '0');
    const flight = await flightModel.create({
      airlineId: TEST_AIRLINE_ID,
      flightNumber: `KE${number}`,
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureLocalInput: '2099-01-01T08:00',
      arrivalLocalInput: '2099-01-01T12:30',
      departureAtUtc: new Date('2099-01-01T06:00:00Z'),
      arrivalAtUtc: new Date('2099-01-01T08:30:00Z'),
      departureDateKey: '2099-01-01',
      status: FlightStatus.SCHEDULED,
      cabinInventory: [
        {
          category: ECONOMY,
          totalSeats,
          bookedSeats: counters.bookedSeats ?? 0,
          heldSeats: counters.heldSeats ?? 0,
          price: Types.Decimal128.fromString('100.00'),
          freeBaggageCount: 1,
          maxBagWeightKg: 23,
        },
      ],
    });
    createdIds.push(flight._id);
    return flight._id;
  }

  async function economy(flightId: Types.ObjectId): Promise<CabinInventory> {
    const flight = await flightModel.findById(flightId).lean<Flight>().exec();
    if (!flight) {
      throw new Error(`Test flight ${flightId.toString()} is missing`);
    }
    return flight.cabinInventory[0];
  }

  function seatChange(flightId: Types.ObjectId, count: number): SeatChange {
    return { flightId, category: ECONOMY, seats: count };
  }

  // Starts `times` holds at once and returns how many succeeded and every failure code.
  async function holdConcurrently(
    flightId: Types.ObjectId,
    count: number,
    times: number,
  ): Promise<{ succeeded: number; codes: string[] }> {
    const results = await Promise.allSettled(
      Array.from({ length: times }, () =>
        seats.hold(seatChange(flightId, count)),
      ),
    );
    const codes = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => {
        const reason: unknown = r.reason;
        return reason instanceof HttpException
          ? (reason.getResponse() as { code: string }).code
          : String(reason);
      });
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    return { succeeded, codes };
  }

  describe('concurrent holds never oversell', () => {
    it(
      'gives the last seat to exactly one of 20 requests',
      async () => {
        const flightId = await createFlight(1);
        const { succeeded, codes } = await holdConcurrently(flightId, 1, 20);

        expect(succeeded).toBe(1);
        expect(new Set(codes)).toEqual(new Set(['SEAT_UNAVAILABLE']));
        expect(await economy(flightId)).toMatchObject({
          bookedSeats: 0,
          heldSeats: 1,
        });
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'gives the last 5 seats to exactly 5 of 20 requests',
      async () => {
        const flightId = await createFlight(5);
        const { succeeded } = await holdConcurrently(flightId, 1, 20);

        expect(succeeded).toBe(5);
        expect((await economy(flightId)).heldSeats).toBe(5);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'counts already booked seats: 3 of 10 booked leaves room for two holds of 3',
      async () => {
        const flightId = await createFlight(10, { bookedSeats: 3 });
        const { succeeded } = await holdConcurrently(flightId, 3, 10);

        expect(succeeded).toBe(2);
        expect(await economy(flightId)).toMatchObject({
          bookedSeats: 3,
          heldSeats: 6,
        });
      },
      TEST_TIMEOUT_MS,
    );
  });

  describe('round trip inside a transaction', () => {
    it(
      'leaves both flights unchanged when the return flight is full',
      async () => {
        const outboundId = await createFlight(5);
        const returnId = await createFlight(2, { bookedSeats: 2 });

        const roundTrip = connection.transaction(async (session) => {
          await seats.hold(seatChange(outboundId, 2), session);
          await seats.hold(seatChange(returnId, 2), session);
        });

        await expect(roundTrip).rejects.toBeInstanceOf(HttpException);
        expect(await economy(outboundId)).toMatchObject({ heldSeats: 0 });
        expect(await economy(returnId)).toMatchObject({
          bookedSeats: 2,
          heldSeats: 0,
        });
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'lets exactly one of 5 concurrent round trips take the last return seats',
      async () => {
        const outboundId = await createFlight(20);
        const returnId = await createFlight(2);

        const results = await Promise.allSettled(
          Array.from({ length: 5 }, () =>
            connection.transaction(async (session) => {
              await seats.hold(seatChange(outboundId, 2), session);
              await seats.hold(seatChange(returnId, 2), session);
            }),
          ),
        );

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect((await economy(outboundId)).heldSeats).toBe(2);
        expect((await economy(returnId)).heldSeats).toBe(2);
      },
      TEST_TIMEOUT_MS,
    );
  });

  describe('releases and conversion never go below 0', () => {
    it(
      'refuses to release more held seats than are held, and a second release',
      async () => {
        const flightId = await createFlight(5, { heldSeats: 1 });

        await expect(
          seats.releaseHeld(seatChange(flightId, 2)),
        ).rejects.toThrow('Seat counters out of sync');
        expect((await economy(flightId)).heldSeats).toBe(1);

        await seats.releaseHeld(seatChange(flightId, 1));
        expect((await economy(flightId)).heldSeats).toBe(0);

        await expect(
          seats.releaseHeld(seatChange(flightId, 1)),
        ).rejects.toThrow('Seat counters out of sync');
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'converts held seats to booked once and releases booked seats once',
      async () => {
        const flightId = await createFlight(5, { heldSeats: 2 });

        await seats.convertHeldToBooked(seatChange(flightId, 2));
        expect(await economy(flightId)).toMatchObject({
          bookedSeats: 2,
          heldSeats: 0,
        });
        await expect(
          seats.convertHeldToBooked(seatChange(flightId, 2)),
        ).rejects.toThrow('Seat counters out of sync');

        await seats.releaseBooked(seatChange(flightId, 2));
        expect(await economy(flightId)).toMatchObject({
          bookedSeats: 0,
          heldSeats: 0,
        });
        await expect(
          seats.releaseBooked(seatChange(flightId, 1)),
        ).rejects.toThrow('Seat counters out of sync');
      },
      TEST_TIMEOUT_MS,
    );
  });
});
