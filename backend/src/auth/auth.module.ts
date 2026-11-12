import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.constants';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { readJwtSecret } from './jwt-secret';
import { PasswordService } from './password/password.service';
import { User, UserSchema } from './schemas/user.schema';
import { UsersService } from './users/users.service';

// Auth feature module (ACC-01). Other modules use UsersService, never the User model.
@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    // Pinning the algorithm rejects tokens that claim another algorithm or 'none'.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: readJwtSecret(config),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [PasswordService, UsersService, AuthService],
  exports: [UsersService, PasswordService],
})
export class AuthModule {}
