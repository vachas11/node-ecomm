import { PrismaClient } from '../generated/prisma-client';
import { EmailVerificationToken } from '../models/EmailVerificationToken';

// interface DatabasePool {
//   // eslint-disable-next-line @typescript-eslint/no-explicit-any
//   query<T = any>(
//     sql: string,
//     params?: any[]
//   ): Promise<{ rows: T[]; rowCount: number | null | any }>;
// }

export class EmailVerificationTokenRepository {
  constructor(
    private readonly prisma: PrismaClient
    // private readonly db: DatabasePool
  ) {}

  /**
   * Create a new email verification token
   */
  async create(data: {
    userId: number;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<EmailVerificationToken | any> {
    const token = await this.prisma.emailVerificationToken.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
      },
    });
    return token;
    // return EmailVerificationToken.fromDatabase(this.toDatabaseRow(token));
  }

  /**
   * Find token by hash
   */
  async findByTokenHash(tokenHash: string): Promise<EmailVerificationToken | null | any> {
    const token = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });
    return token;
    // return token ? EmailVerificationToken.fromDatabase(this.toDatabaseRow(token)) : null;
  }

  /**
   * Find valid (non-expired) token for a user
   */
  async findValidByUserId(userId: number): Promise<EmailVerificationToken | null | any> {
    const token = await this.prisma.emailVerificationToken.findFirst({
      where: {
        userId,
        expiresAt: {
          gt: new Date(), // Greater than current time = not expired
        },
      },
      orderBy: {
        createdAt: 'desc', // Get the most recent one
      },
    });
    return token ?? null;
    // return token ? EmailVerificationToken.fromDatabase(this.toDatabaseRow(token)) : null;
  }

  /**
   * Delete all tokens for a user
   * Used after successful verification or when generating new token
   */
  async deleteByUserId(userId: number): Promise<number> {
    const result = await this.prisma.emailVerificationToken.deleteMany({
      where: { userId },
    });
    return result.count;
  }

  /**
   * Delete all expired tokens (cleanup job)
   * Run this periodically to keep the table clean
   */
  async deleteExpired(): Promise<number> {
    const result = await this.prisma.emailVerificationToken.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(), // Less than current time = expired
        },
      },
    });
    return result.count;
  }

  /**
   * Helper: Transform Prisma result to EmailVerificationTokenDatabaseRow
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // private toDatabaseRow(token: any): EmailVerificationTokenDatabaseRow {
  //   return {
  //     id: token.id,
  //     userId: token.userId,
  //     tokenHash: token.tokenHash,
  //     expiresAt: token.expiresAt,
  //     createdAt: token.createdAt,
  //   };
  // }
}
