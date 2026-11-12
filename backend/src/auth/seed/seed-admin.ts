import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { AdminSeeder } from './admin-seeder.service';

// Standalone entry point (no HTTP server), see the "seed:admin" npm script (ACC-18).
async function seedAdmin() {
  // abortOnError: false lets startup errors reach the catch below.
  const app = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
  });
  try {
    await app.get(AdminSeeder).seed();
  } finally {
    // Also closes the MongoDB connection.
    await app.close();
  }
}

seedAdmin().catch((error: unknown) => {
  // Only the message: the seeder's messages never contain the password.
  const message = error instanceof Error ? error.message : String(error);
  new Logger('SeedAdmin').error(`Admin seed failed: ${message}`);
  process.exit(1);
});
