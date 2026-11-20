import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../app.module';
import { ReferenceDataSeeder } from './reference-data-seeder.service';

// Standalone entry point (no HTTP server), see the "seed" npm script.
async function seed() {
  // abortOnError: false lets startup errors reach the catch below.
  const app = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
  });
  try {
    await app.get(ReferenceDataSeeder).seed();
  } finally {
    // Also closes the MongoDB connection.
    await app.close();
  }
}

seed().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  new Logger('Seed').error(`Seed failed: ${message}`);
  process.exit(1);
});
