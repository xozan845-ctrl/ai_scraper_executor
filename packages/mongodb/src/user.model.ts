import { Schema, model, Document, Types } from 'mongoose';

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  role: 'superadmin' | 'user';
  createdAt: Date;
  lastLoginAt?: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['superadmin', 'user'], default: 'user' },
  },
  { timestamps: true }
);

export const User = model<IUser>('User', UserSchema);