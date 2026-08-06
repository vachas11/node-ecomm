/**
 * Token Repository - Data access layer for refresh_tokens table
 * Located in API Gateway (handles authentication concerns)
 */

import { RefreshToken, RefreshTokenDatabaseRow } from '../models/RefreshToken';

// Database pool interface
interface DatabasePool {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }>;
}

export class TokenRepository {
  constructor(private readonly db: DatabasePool) {}

  async createRefreshToken(userId: number, tokenHash: string, expiresAt: Date): Promise<RefreshToken | null> {
    const result = await this.db.query<RefreshTokenDatabaseRow>(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, tokenHash, expiresAt]
    );
    return RefreshToken.fromDatabase(result.rows[0]);
  }

  async findRefreshToken(tokenHash: string): Promise<RefreshToken | null> {
    const result = await this.db.query<RefreshTokenDatabaseRow>(
      `SELECT * FROM refresh_tokens WHERE token_hash = $1 AND expires_at > NOW()`,
      [tokenHash]
    );
    return RefreshToken.fromDatabase(result.rows[0] || null);
  }

  async findUserTokens(userId: number): Promise<RefreshToken[]> {
    const result = await this.db.query<RefreshTokenDatabaseRow>(
      `SELECT * FROM refresh_tokens WHERE user_id = $1 AND expires_at > NOW() ORDER BY created_at DESC`,
      [userId]
    );
    return RefreshToken.fromDatabaseArray(result.rows);
  }

  async deleteRefreshToken(tokenHash: string): Promise<boolean> {
    const result = await this.db.query(
      'DELETE FROM refresh_tokens WHERE token_hash = $1',
      [tokenHash]
    );
    return result.rowCount > 0;
  }

  async deleteAllUserTokens(userId: number): Promise<number> {
    const result = await this.db.query(
      'DELETE FROM refresh_tokens WHERE user_id = $1',
      [userId]
    );
    return result.rowCount;
  }

  async cleanupExpiredTokens(): Promise<number> {
    const result = await this.db.query(
      'DELETE FROM refresh_tokens WHERE expires_at <= NOW()'
    );
    return result.rowCount;
  }

  async countUserTokens(userId: number): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM refresh_tokens WHERE user_id = $1 AND expires_at > NOW()`,
      [userId]
    );
    return parseInt(result.rows[0].count, 10);
  }

  async exists(tokenHash: string): Promise<boolean> {
    const result = await this.db.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM refresh_tokens WHERE token_hash = $1 AND expires_at > NOW())',
      [tokenHash]
    );
    return result.rows[0].exists;
  }
}
