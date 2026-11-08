import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingsModule } from '../common/bookings/bookings.module';
import { ReferenceDataModule } from '../common/reference-data/reference-data.module';
import { AuthController } from './auth.controller';
import { AuthCookiesService } from './auth-cookies.service';
import { AuthTokensService } from './auth-tokens.service';
import { AuthenticatedGuard } from './guards/authenticated.guard';
import { RolesGuard } from './guards/roles.guard';
import { PasswordService } from './password.service';
import { Session, SessionSchema } from './schemas/session.schema';
import { User, UserSchema } from './schemas/user.schema';
import { SessionsService } from './sessions.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Owns the users and sessions collections and the access control every other
 * module uses. A feature module that needs the signed-in account imports this
 * module and applies AuthenticatedGuard (and RolesGuard where a role matters);
 * it never injects the User or Session model itself.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Session.name, schema: SessionSchema },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      // getOrThrow: the app must not start without a signing secret, because a
      // default one would let anyone mint a valid access token.
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      }),
    }),
    ReferenceDataModule,
    BookingsModule,
  ],
  controllers: [AuthController, UsersController],
  providers: [
    PasswordService,
    AuthTokensService,
    AuthCookiesService,
    SessionsService,
    UsersService,
    AuthenticatedGuard,
    RolesGuard,
  ],
  exports: [
    PasswordService,
    AuthTokensService,
    AuthCookiesService,
    SessionsService,
    UsersService,
    AuthenticatedGuard,
    RolesGuard,
  ],
})
export class AuthModule {}
