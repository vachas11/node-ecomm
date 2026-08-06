/**
 * User Service - Business logic for user management
 * All user operations go through this layer
 */

import { User } from '../models/User';
import { UserRepository, CreateUserData, UpdateUserData } from '../repositories/user.repository';
import { hashPassword, comparePassword, validatePasswordStrength } from '../utils/password';
import { NotFoundError, ValidationError, UnauthorizedError, ConflictError } from '../../../../shared/errors';
import logger from '../../../../shared/logger';

interface RegisterUserData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

interface ChangePasswordData {
  userId: number;
  currentPassword: string;
  newPassword: string;
}

interface ValidateCredentialsResult {
  id: number;
  email: string;
  role: string;
  firstName: string | null;
  lastName: string | null;
}

export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  async createUser(data: RegisterUserData): Promise<User> {
    const { email, password, firstName, lastName } = data;

    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.isValid) {
      throw new ValidationError('Password validation failed', passwordValidation.errors);
    }

    const emailExists = await this.userRepository.existsByEmail(email);
    if (emailExists) {
      throw new ConflictError('User with this email already exists');
    }

    const passwordHash = await hashPassword(password);
    const user = await this.userRepository.create({
      email,
      passwordHash,
      firstName,
      lastName
    });

    if (!user) {
      throw new Error('Failed to create user');
    }

    logger.info('User created', { userId: user.id, email: user.email });
    return user;
  }

  async validateCredentials(email: string, password: string): Promise<ValidateCredentialsResult> {
    const userRow = await this.userRepository.findByEmailWithPassword(email);
    if (!userRow) {
      throw new UnauthorizedError('Invalid email or password');
    }

    if (!userRow.is_active) {
      throw new UnauthorizedError('Account is deactivated');
    }

    const isPasswordValid = await comparePassword(password, userRow.password_hash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    logger.info('User credentials validated', { userId: userRow.id, email: userRow.email });

    return {
      id: userRow.id,
      email: userRow.email,
      role: userRow.role,
      firstName: userRow.first_name,
      lastName: userRow.last_name
    };
  }

  async getUserById(userId: number): Promise<User> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return user;
  }

  async getActiveUserById(userId: number): Promise<User> {
    const user = await this.userRepository.findActiveById(userId);
    if (!user) {
      throw new NotFoundError('User not found or deactivated');
    }
    return user;
  }

  async getUserByEmail(email: string): Promise<User> {
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return user;
  }

  async updateProfile(userId: number, updates: UpdateUserData): Promise<User> {
    if (updates.email) {
      const emailExists = await this.userRepository.existsByEmailExcludingUser(updates.email, userId);
      if (emailExists) {
        throw new ConflictError('Email already in use');
      }
    }

    const user = await this.userRepository.update(userId, updates);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    logger.info('User profile updated', { userId });
    return user;
  }

  async changePassword(data: ChangePasswordData): Promise<boolean> {
    const { userId, currentPassword, newPassword } = data;

    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.isValid) {
      throw new ValidationError('New password validation failed', passwordValidation.errors);
    }

    const userRow = await this.userRepository.findByIdWithPassword(userId);
    if (!userRow) {
      throw new NotFoundError('User not found');
    }

    const isPasswordValid = await comparePassword(currentPassword, userRow.password_hash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Current password is incorrect');
    }

    const passwordHash = await hashPassword(newPassword);
    await this.userRepository.updatePassword(userId, passwordHash);

    logger.info('User password changed', { userId });
    return true;
  }

  async verifyEmail(userId: number): Promise<boolean> {
    const success = await this.userRepository.updateEmailVerified(userId, true);
    if (!success) {
      throw new NotFoundError('User not found');
    }
    logger.info('Email verified', { userId });
    return true;
  }

  async deactivateAccount(userId: number): Promise<boolean> {
    const success = await this.userRepository.deactivate(userId);
    if (!success) {
      throw new NotFoundError('User not found');
    }
    logger.info('Account deactivated', { userId });
    return true;
  }

  async activateAccount(userId: number): Promise<boolean> {
    const success = await this.userRepository.activate(userId);
    if (!success) {
      throw new NotFoundError('User not found');
    }
    logger.info('Account activated', { userId });
    return true;
  }

  async deleteUser(userId: number): Promise<boolean> {
    const success = await this.userRepository.delete(userId);
    if (!success) {
      throw new NotFoundError('User not found');
    }
    logger.warn('User permanently deleted', { userId });
    return true;
  }

  async getUsersById(userIds: number[]): Promise<User[]> {
    if (userIds.length === 0) {
      return [];
    }
    if (userIds.length > 100) {
      throw new ValidationError('Maximum 100 users per bulk request');
    }

    const users: User[] = [];
    for (const id of userIds) {
      const user = await this.userRepository.findById(id);
      if (user) {
        users.push(user);
      }
    }
    return users;
  }
}
