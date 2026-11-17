import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { HotelDemoSeedModule } from './hotel-demo-seeder.module';
import { HotelDemoSeeder } from './hotel-demo-seeder.service';

async function seedHotels() {
  const app = await NestFactory.createApplicationContext(HotelDemoSeedModule, {
    abortOnError: false,
  });
  try {
    await app.get(HotelDemoSeeder).seed();
  } finally {
    await app.close();
  }
}

seedHotels().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  new Logger('SeedHotels').error(`Hotel demo seed failed: ${message}`);
  process.exit(1);
});
