import { Injectable, Logger } from '@nestjs/common';
import { User, IUser, UserDocument } from '@ai-scraper/mongodb';
import { Model, Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { hashPassword, generateApiKey } from './password.util';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(@InjectModel(User.name) private readonly userModel: Model<IUser>) {}

  async countUsers(): Promise<number> {
    return this.userModel.countDocuments({});
  }

  async createUser(data: { email: string; passwordHash: string; role: 'superadmin' | 'user' }): Promise<UserDocument> {
    const created = new this.userModel({
      email: data.email,
      passwordHash: data.passwordHash,
      role: data.role,
    });
    return created.save();
  }

  generateApiKey(): string {
    return generateApiKey();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  async recordLogin(userId: Types.ObjectId): Promise<void> {
    // Solo metadata, sin passwords en logs
    this.logger.debug(`User login recorded: ${userId.toString()}`);
    // Actualizar último login
    await this.userModel.findByIdAndUpdate(userId, { lastLoginAt: new Date() });
  }
}