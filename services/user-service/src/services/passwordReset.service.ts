import { PasswordResetTokenRepository } from '../repositories/passwordResetToken.repository';
import { UserRepository } from '../repositories/user.repository';
import { NotFoundError, ValidationError, ConflictError } from '../../../../shared/errors';
import { generateTokenWithHash, hashToken } from '../utils/token';
import { sendPasswordResetEmail } from '../utils/email';
import logger from '../../../../shared/logger';
import bcrypt from 'bcrypt';

export interface ResetRequestResult {
  success: boolean;
  message: string;
}

export interface VerifyTokenResult {
  valid: boolean;
  message: string;
  email?: string;
}

export interface ResetPasswordResult {
  success: boolean;
  message: string;
  email?: string;
}

export class PasswordResetService {
  private static readonly TOKEN_EXPIRY_MINUTES = 15;
  private static readonly RATE_LIMIT_REQUESTS = 3; // max 3 requests per hour
  private static readonly RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
  private static readonly BCRYPT_ROUNDS = 12;

  constructor(
    private readonly tokenRepository: PasswordResetTokenRepository,
    private readonly userRepository: UserRepository
  ) {}

  /**
   * Request password reset - send email with reset token
   * @param email - User's email address
   */
  async requestPasswordReset(email: string): Promise<ResetRequestResult> {
    logger.info('Password reset requested', { email });

    // Find user by email
    const user = await this.userRepository.findByEmail(email);

    // Security: Don't reveal if email exists or not (same response time)
    if (!user) {
      logger.warn('Password reset requested for non-existent email', { email });
      // Return success to prevent email enumeration
      return {
        success: true,
        message: 'If that email is registered, you will receive a password reset link',
      };
    }

    // Check if user is active
    if (!user.isActive) {
      logger.warn('Password reset requested for inactive user', { userId: user.id, email });
      return {
        success: true,
        message: 'If that email is registered, you will receive a password reset link',
      };
    }

    // Check rate limiting - count recent tokens in the last hour
    const recentTokens = await this.tokenRepository.findRecentByUserId(
      user.id,
      new Date(Date.now() - PasswordResetService.RATE_LIMIT_WINDOW_MS)
    );

    if (recentTokens.length >= PasswordResetService.RATE_LIMIT_REQUESTS) {
      logger.warn('Password reset rate limit exceeded', { userId: user.id, email });
      throw new ValidationError(
        `Too many password reset requests. Please try again later. Limit: ${PasswordResetService.RATE_LIMIT_REQUESTS} per hour`
      );
    }

    // Delete any existing unused tokens for this user
    await this.tokenRepository.deleteUnusedByUserId(user.id);

    // Generate new token
    const { token, hash } = generateTokenWithHash();
    const expiresAt = new Date(Date.now() + PasswordResetService.TOKEN_EXPIRY_MINUTES * 60 * 1000);

    // Store hashed token in database
    await this.tokenRepository.create({
      userId: user.id,
      tokenHash: hash,
      expiresAt,
    });

    // Send email with plain token
    await sendPasswordResetEmail(user.email, token);

    logger.info('Password reset email sent successfully', {
      userId: user.id,
      email: user.email,
      expiresAt,
    });

    return {
      success: true,
      message: 'If that email is registered, you will receive a password reset link',
    };
  }

  /**
   * Verify if a reset token is valid
   * @param plainToken - Plain text token from URL
   */
  async verifyResetToken(plainToken: string): Promise<VerifyTokenResult> {
    logger.info('Verifying password reset token');

    // Hash the plain token to look it up
    const tokenHash = hashToken(plainToken);

    // Find token in database
    const tokenRecord = await this.tokenRepository.findByTokenHash(tokenHash);

    if (!tokenRecord) {
      logger.warn('Invalid password reset token used');
      return {
        valid: false,
        message: 'Invalid or expired reset token',
      };
    }

    // Check if token is expired
    if (tokenRecord.isExpired()) {
      logger.warn('Expired password reset token used', { userId: tokenRecord.userId });
      return {
        valid: false,
        message: 'Reset token has expired. Please request a new one.',
      };
    }

    // Check if token was already used
    if (tokenRecord.isUsed()) {
      logger.warn('Already used password reset token attempted', { userId: tokenRecord.userId });
      return {
        valid: false,
        message: 'This reset link has already been used. Please request a new one.',
      };
    }

    // Get user
    const user = await this.userRepository.findById(tokenRecord.userId);
    if (!user) {
      logger.error('User not found for valid token', { userId: tokenRecord.userId });
      return {
        valid: false,
        message: 'User not found',
      };
    }

    logger.info('Password reset token verified successfully', { userId: user.id });

    return {
      valid: true,
      message: 'Token is valid',
      email: user.email,
    };
  }

  /**
   * Reset password using token
   * @param plainToken - Plain text token from URL
   * @param newPassword - New password to set
   */
  async resetPassword(plainToken: string, newPassword: string): Promise<ResetPasswordResult> {
    logger.info('Resetting password with token');

    // Validate password strength
    if (!newPassword || newPassword.length < 8) {
      throw new ValidationError('Password must be at least 8 characters long');
    }

    // Hash the plain token to look it up
    const tokenHash = hashToken(plainToken);

    // Find token in database
    const tokenRecord = await this.tokenRepository.findByTokenHash(tokenHash);

    if (!tokenRecord) {
      logger.warn('Invalid password reset token used for reset');
      throw new ValidationError('Invalid or expired reset token');
    }

    // Check if token can be used
    if (!tokenRecord.canBeUsed()) {
      if (tokenRecord.isExpired()) {
        logger.warn('Expired token used for password reset', { userId: tokenRecord.userId });
        throw new ValidationError('Reset token has expired. Please request a new one.');
      }
      if (tokenRecord.isUsed()) {
        logger.warn('Already used token attempted for password reset', {
          userId: tokenRecord.userId,
        });
        throw new ValidationError(
          'This reset link has already been used. Please request a new one.'
        );
      }
      throw new ValidationError('Token cannot be used');
    }

    // Get user
    const user = await this.userRepository.findById(tokenRecord.userId);
    if (!user) {
      logger.error('User not found for valid token during reset', { userId: tokenRecord.userId });
      throw new NotFoundError('User not found');
    }

    // Hash the new password
    const passwordHash = await bcrypt.hash(newPassword, PasswordResetService.BCRYPT_ROUNDS);

    // Update user's password
    await this.userRepository.updatePassword(user.id, passwordHash);

    // Mark token as used
    await this.tokenRepository.markAsUsed(tokenRecord.id);

    logger.info('Password reset successfully', { userId: user.id, email: user.email });

    return {
      success: true,
      message: 'Password reset successfully. You can now login with your new password.',
      email: user.email,
    };
  }

  /**
   * Clean up expired and used tokens (can be run as a cron job)
   */
  async cleanupExpiredTokens(): Promise<number> {
    logger.info('Cleaning up expired password reset tokens');
    const deletedCount = await this.tokenRepository.deleteExpired();
    logger.info('Expired password reset tokens cleaned up', { deletedCount });
    return deletedCount;
  }
}
