import { EmailVerificationTokenRepository } from '../repositories/emailVerificationToken.repository';
import { UserRepository } from '../repositories/user.repository';
import { NotFoundError, ValidationError, ConflictError } from '../../../../shared/errors';
import { generateTokenWithHash, hashToken } from '../utils/token';
import { sendVerificationEmail } from '../utils/email';
import logger from '../../../../shared/logger';

export interface VerifcationResult {
  success: boolean;
  message: string;
  email?: string;
}

export class EmailVerificationService {
  private static readonly TOKEN_EXPIRY_HOURS = 24;
  private static readonly RESEND_RATE_LIMIT = 3;
  private static readonly RESEND_WINDOW_MS = 60 * 60 * 1000;
  constructor(
    private readonly tokenRepository: EmailVerificationTokenRepository,
    private readonly userRepository: UserRepository
  ) {}
  //  Generate and send verification email to user
  async sendVerificationEmail(userId: number, email: string): Promise<void> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    if (user.emailVerified) {
      logger.warn('Verification email requested for already verified user', { userId });
      throw new ConflictError('Email already verified');
    }
    await this.tokenRepository.deleteByUserId(userId);

    // generate new token
    const { token, hash } = generateTokenWithHash();
    const expiresAt = new Date(
      Date.now() + EmailVerificationService.TOKEN_EXPIRY_HOURS * 60 * 60 * 1000
    );
    await this.tokenRepository.create({
      userId,
      tokenHash: hash,
      expiresAt,
    });
    // Send email with plain token
    await sendVerificationEmail(email, token);

    logger.info('Verification email sent successfully', { userId, email, expiresAt });
  }
  //  Verify email using token
  async verifyEmail(plainToke: string): Promise<VerifcationResult> {
    const tokenHash = hashToken(plainToke);
    const tokenInDB = await this.tokenRepository.findByTokenHash(tokenHash);
    if (!tokenHash) {
      logger.warn('Invalid verification token used');
      throw new ValidationError('Invalid or expired verification token');
    }
    // Check if token is expired
    if (tokenInDB.isExpired()) {
      logger.warn('Expired verification token used', { userId: tokenInDB.userId });
      await this.tokenRepository.deleteByUserId(tokenInDB.userId);
      throw new ValidationError('Verification token has expired');
    }
    const user = await this.userRepository.findActiveById(tokenInDB);
    if (!user) {
      logger.error('User not found for valid token', { userId: tokenInDB.userId });
      throw new NotFoundError('User not found');
    }
    // Check if already verified
    if (user.emailVerified) {
      logger.info('Email already verified', { userId: user.id });
      await this.tokenRepository.deleteByUserId(user.id);
      return {
        success: true,
        message: 'Email already verified',
        email: user.email,
      };
    }
    // Mark email as verified
    await this.userRepository.updateEmailVerified(user.id, true);

    // Delete the used token
    await this.tokenRepository.deleteByUserId(user.id);

    logger.info('Email verified successfully', { userId: user.id, email: user.email });

    return {
      success: true,
      message: 'Email verified successfully',
      email: user.email,
    };
  }

  /**
   * Resend verification email with rate limiting
   */
  async resendVerificationEmail(userId: number): Promise<void> {
    logger.info('Resending verification email', { userId });

    // Get user
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Check if already verified
    if (user.emailVerified) {
      logger.warn('Resend requested for already verified email', { userId });
      throw new ConflictError('Email already verified');
    }

    // Check rate limiting - count recent tokens created in the last hour
    const recentTokens = await this.tokenRepository.findValidByUserId(userId);
    const oneHourAgo = new Date(Date.now() - EmailVerificationService.RESEND_WINDOW_MS);
    const recentCount = recentTokens.filter((t) => t.createdAt > oneHourAgo).length;

    if (recentCount >= EmailVerificationService.RESEND_RATE_LIMIT) {
      logger.warn('Rate limit exceeded for verification email resend', { userId, recentCount });
      throw new ValidationError(
        `Too many verification emails sent. Please try again later. Limit: ${EmailVerificationService.RESEND_RATE_LIMIT} per hour`
      );
    }

    // Send new verification email
    await this.sendVerificationEmail(userId, user.email);

    logger.info('Verification email resent successfully', { userId });
  }

  /**
   * Clean up expired tokens (can be run as a cron job)
   */
  async cleanupExpiredTokens(): Promise<number> {
    logger.info('Cleaning up expired verification tokens');
    const deletedCount = await this.tokenRepository.deleteExpired();
    logger.info('Expired verification tokens cleaned up', { deletedCount });
    return deletedCount;
  }
}
