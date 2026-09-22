import { UserRepository } from '../repositories/user.repository';
import { User } from '../models/User';
import { NotFoundError, ValidationError } from '../../../../shared/errors';
import logger from '../../../../shared/logger';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export interface UploadAvatarResult {
  filename: string;
  url: string;
  user: User;
}

export class AvatarService {
  private static readonly UPLOAD_DIR = process.env.AVATAR_UPLOAD_DIR || 'uploads/avatars';
  private static readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
  private static readonly ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  private static readonly ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

  constructor(private readonly userRepository: UserRepository) {}

  /**
   * Upload or update user avatar
   * @param userId - User ID
   * @param file - File buffer and metadata
   */
  async uploadAvatar(
    userId: number,
    file: {
      buffer: Buffer;
      mimetype: string;
      originalname: string;
      size: number;
    }
  ): Promise<UploadAvatarResult> {
    logger.info('Uploading avatar', { userId, filename: file.originalname, size: file.size });

    // Verify user exists
    const user = await this.userRepository.findById(userId);
    if (!user) {
      logger.warn('Cannot upload avatar for non-existent user', { userId });
      throw new NotFoundError('User not found');
    }

    // Validate file size
    if (file.size > AvatarService.MAX_FILE_SIZE) {
      logger.warn('Avatar file too large', { userId, size: file.size });
      throw new ValidationError(
        `File size exceeds maximum allowed size of ${AvatarService.MAX_FILE_SIZE / 1024 / 1024}MB`
      );
    }

    // Validate mime type
    if (!AvatarService.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      logger.warn('Invalid avatar mime type', { userId, mimetype: file.mimetype });
      throw new ValidationError(
        `Invalid file type. Allowed types: ${AvatarService.ALLOWED_MIME_TYPES.join(', ')}`
      );
    }

    // Validate file extension
    const ext = path.extname(file.originalname).toLowerCase();
    if (!AvatarService.ALLOWED_EXTENSIONS.includes(ext)) {
      logger.warn('Invalid avatar file extension', { userId, extension: ext });
      throw new ValidationError(
        `Invalid file extension. Allowed: ${AvatarService.ALLOWED_EXTENSIONS.join(', ')}`
      );
    }

    // Delete old avatar if exists
    if (user.avatar) {
      await this.deleteAvatarFile(user.avatar);
    }

    // Generate unique filename
    const filename = this.generateFilename(userId, ext);

    // Ensure upload directory exists
    await this.ensureUploadDirectory();

    // Save file to disk
    const filePath = path.join(AvatarService.UPLOAD_DIR, filename);
    await fs.writeFile(filePath, file.buffer);

    logger.info('Avatar file saved successfully', { userId, filename, path: filePath });

    // Update user record with new avatar filename
    await this.updateUserAvatar(userId, filename);

    // Fetch updated user
    const updatedUser = await this.userRepository.findById(userId);
    if (!updatedUser) {
      throw new NotFoundError('User not found after avatar update');
    }

    logger.info('Avatar uploaded successfully', { userId, filename });

    return {
      filename,
      url: updatedUser.getAvatarUrl()!,
      user: updatedUser,
    };
  }

  /**
   * Delete user avatar
   * @param userId - User ID
   */
  async deleteAvatar(userId: number): Promise<void> {
    logger.info('Deleting avatar', { userId });

    // Verify user exists
    const user = await this.userRepository.findById(userId);
    if (!user) {
      logger.warn('Cannot delete avatar for non-existent user', { userId });
      throw new NotFoundError('User not found');
    }

    if (!user.avatar) {
      logger.warn('User has no avatar to delete', { userId });
      throw new NotFoundError('User has no avatar');
    }

    // Delete file from disk
    await this.deleteAvatarFile(user.avatar);

    // Update user record
    await this.updateUserAvatar(userId, null);

    logger.info('Avatar deleted successfully', { userId });
  }

  /**
   * Get avatar URL for a user
   * @param userId - User ID
   */
  async getAvatarUrl(userId: number): Promise<string | null> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    return user.getAvatarUrl();
  }

  /**
   * Check if user has an avatar
   * @param userId - User ID
   */
  async hasAvatar(userId: number): Promise<boolean> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    return user.avatar !== null;
  }

  /**
   * Validate avatar file before upload
   * @param file - File metadata
   */
  validateAvatarFile(file: {
    mimetype: string;
    originalname: string;
    size: number;
  }): { valid: boolean; error?: string } {
    // Check size
    if (file.size > AvatarService.MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `File size exceeds maximum allowed size of ${AvatarService.MAX_FILE_SIZE / 1024 / 1024}MB`,
      };
    }

    // Check mime type
    if (!AvatarService.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return {
        valid: false,
        error: `Invalid file type. Allowed types: ${AvatarService.ALLOWED_MIME_TYPES.join(', ')}`,
      };
    }

    // Check extension
    const ext = path.extname(file.originalname).toLowerCase();
    if (!AvatarService.ALLOWED_EXTENSIONS.includes(ext)) {
      return {
        valid: false,
        error: `Invalid file extension. Allowed: ${AvatarService.ALLOWED_EXTENSIONS.join(', ')}`,
      };
    }

    return { valid: true };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Generate unique filename for avatar
   */
  private generateFilename(userId: number, extension: string): string {
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(8).toString('hex');
    return `user-${userId}-${timestamp}-${randomString}${extension}`;
  }

  /**
   * Ensure upload directory exists
   */
  private async ensureUploadDirectory(): Promise<void> {
    try {
      await fs.access(AvatarService.UPLOAD_DIR);
    } catch {
      logger.info('Creating avatar upload directory', { dir: AvatarService.UPLOAD_DIR });
      await fs.mkdir(AvatarService.UPLOAD_DIR, { recursive: true });
    }
  }

  /**
   * Delete avatar file from disk
   */
  private async deleteAvatarFile(filename: string): Promise<void> {
    const filePath = path.join(AvatarService.UPLOAD_DIR, filename);

    try {
      await fs.access(filePath);
      await fs.unlink(filePath);
      logger.info('Avatar file deleted from disk', { filename, path: filePath });
    } catch (error) {
      logger.warn('Avatar file not found on disk', { filename, path: filePath, error });
      // Don't throw error - file might have been manually deleted
    }
  }

  /**
   * Update user avatar in database
   */
  private async updateUserAvatar(userId: number, filename: string | null): Promise<void> {
    // Note: This requires adding an updateAvatar method to UserRepository
    // For now, using a workaround with Prisma client directly
    // TODO: Add updateAvatar method to UserRepository

    const { PrismaClient } = await import('../generated/prisma-client');
    const prisma = new PrismaClient();

    try {
      await prisma.user.update({
        where: { id: userId },
        data: {
          avatar: filename,
          updatedAt: new Date(),
        },
      });
    } finally {
      await prisma.$disconnect();
    }
  }

  /**
   * Get allowed file types
   */
  getAllowedFileTypes(): string[] {
    return [...AvatarService.ALLOWED_MIME_TYPES];
  }

  /**
   * Get max file size
   */
  getMaxFileSize(): number {
    return AvatarService.MAX_FILE_SIZE;
  }
}
