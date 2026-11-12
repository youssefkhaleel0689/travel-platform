import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PasswordService } from './password/password.service';
import { User, UserSchema } from './schemas/user.schema';
import { UsersService } from './users/users.service';

// Auth feature module (ACC-01). Other modules use UsersService, never the User model.
@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  providers: [PasswordService, UsersService],
  exports: [UsersService, PasswordService],
})
export class AuthModule {}
