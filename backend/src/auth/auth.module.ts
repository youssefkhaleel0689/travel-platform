import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { jwtModuleOptions, readJwtSecret } from './jwt-secret';
import { PasswordService } from './password/password.service';
import { User, UserSchema } from './schemas/user.schema';
import { AccessTokenService } from './tokens/access-token.service';
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
  ],
  controllers: [AuthController],
  providers: [PasswordService, UsersService, AuthService, AccessTokenService],
  exports: [UsersService, PasswordService],
})
export class AuthModule {}
