import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingsModule } from '../common/bookings/bookings.module';
import { ReferenceDataModule } from '../common/reference-data/reference-data.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { jwtModuleOptions, readJwtSecret } from './jwt-secret';
import { PasswordService } from './password/password.service';
import { User, UserSchema } from './schemas/user.schema';
import { AdminSeeder } from './seed/admin-seeder.service';
import { AccessTokenService } from './tokens/access-token.service';
import { AccountsService } from './users/accounts.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

// Auth feature module (ACC-01). Other modules use UsersService, never the User model.
@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    // Pinning the algorithm rejects tokens that claim another algorithm or 'none'.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        jwtModuleOptions(readJwtSecret(config)),
    }),
    // ACC-09 checks the preferred currency against the seeded list; ACC-12 asks
    // the booking modules whether the account still has an upcoming booking.
    ReferenceDataModule,
    BookingsModule,
  ],
  controllers: [AuthController, UsersController],
  providers: [
    PasswordService,
    UsersService,
    AccountsService,
    AuthService,
    AccessTokenService,
    // Used only by the seed:admin script (ACC-18); not exported.
    AdminSeeder,
    // Global guards for every route of the app, in this order: authenticate, then roles.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [UsersService, AccountsService, PasswordService],
})
export class AuthModule {}
