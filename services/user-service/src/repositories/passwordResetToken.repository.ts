import { PrismaClient } from '../generated/prisma-client';
import { PasswordResetToken } from '../models/PasswordResetToken';

interface DatabasePool {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

export class PasswordResetTokenRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly db: DatabasePool
  ) {}

  /**
   * Create a new password reset token
   */
  async create(data: {
    userId: number;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<PasswordResetToken | any> {
    const token = await this.prisma.passwordResetToken.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        usedAt: null, // Not used yet
      },
    });
    return token;
    // return PasswordResetToken.fromDatabase(this.toDatabaseRow(token));
  }

  /**
   * Find token by hash
   */
  async findByTokenHash(tokenHash: string): Promise<PasswordResetToken | null | any> {
    const token = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });
    return token;
    // return token ? PasswordResetToken.fromDatabase(this.toDatabaseRow(token)) : null;
  }

  /**
   * Mark token as used (one-time use enforcement)
   */
  async markAsUsed(id: number): Promise<PasswordResetToken | any> {
    const token = await this.prisma.passwordResetToken.update({
      where: { id },
      data: {
        usedAt: new Date(),
      },
    });
    return token;
    // return PasswordResetToken.fromDatabase(this.toDatabaseRow(token));
  }

  /**
   * Delete all tokens for a user
   * Used when generating a new reset token
   */
  async deleteByUserId(userId: number): Promise<number> {
    const result = await this.prisma.passwordResetToken.deleteMany({
      where: { userId },
    });
    return result.count;
  }

  /**
   * Delete all expired tokens (cleanup job)
   * Run this periodically to keep the table clean
   */
  async deleteExpired(): Promise<number> {
    const result = await this.prisma.passwordResetToken.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(), // Less than current time = expired
        },
      },
    });
    return result.count;
  }

  /**
   * Find valid (non-expired, not used) token for a user
   * Useful for checking if user already has an active reset request
   */
  async findValidByUserId(userId: number): Promise<PasswordResetToken | null | any> {
    const token = await this.prisma.passwordResetToken.findFirst({
      where: {
        userId,
        expiresAt: {
          gt: new Date(), // Not expired
        },
        usedAt: null, // Not used yet
      },
      orderBy: {
        createdAt: 'desc', // Get the most recent one
      },
    });
    return token;
    // return token ? PasswordResetToken.fromDatabase(this.toDatabaseRow(token)) : null;
  }

  /**
   * Find recent tokens for a user (for rate limiting)
   * Returns tokens created after the specified date
   */
  async findRecentByUserId(userId: number, since: Date): Promise<PasswordResetToken[] | any[]> {
    const tokens = await this.prisma.passwordResetToken.findMany({
      where: {
        userId,
        createdAt: {
          gte: since, // Greater than or equal to the since date
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    return tokens;
    // return tokens.map(t => PasswordResetToken.fromDatabase(this.toDatabaseRow(t)));
  }

  /**
   * Delete all unused tokens for a user
   * Used when generating a new reset token (clears old unused ones)
   */
  async deleteUnusedByUserId(userId: number): Promise<number> {
    const result = await this.prisma.passwordResetToken.deleteMany({
      where: {
        userId,
        usedAt: null, // Only delete unused tokens
      },
    });
    return result.count;
  }

  /**
   * Helper: Transform Prisma result to PasswordResetTokenDatabaseRow
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // private toDatabaseRow(token: any): PasswordResetTokenDatabaseRow {
  //   return {
  //     id: token.id,
  //     userId: token.userId,
  //     tokenHash: token.tokenHash,
  //     expiresAt: token.expiresAt,
  //     usedAt: token.usedAt,
  //     createdAt: token.createdAt,
  //   };
  // }
}
