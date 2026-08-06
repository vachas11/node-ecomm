/**
 * RefreshToken Entity Model
 *
 * Located in API Gateway (not User Service) because:
 * - Refresh tokens are AUTHENTICATION concerns
 * - API Gateway handles auth flow (login, logout, token refresh)
 * - User Service only manages user profile data
 */

export interface RefreshTokenDatabaseRow {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
}

export interface RefreshTokenPublicData {
  id: number;
  userId: number;
  expiresAt: Date;
  createdAt: Date;
  isExpired: boolean;
  remainingTTL: number;
}

export class RefreshToken {
  public readonly id: number;
  public readonly userId: number;
  public readonly expiresAt: Date;
  public readonly createdAt: Date;
  private readonly tokenHash: string;

  constructor(data: RefreshTokenDatabaseRow) {
    this.id = data.id;
    this.userId = data.user_id;
    this.tokenHash = data.token_hash;
    this.expiresAt = data.expires_at;
    this.createdAt = data.created_at;
  }

  isExpired(): boolean {
    return new Date() > new Date(this.expiresAt);
  }

  isValid(): boolean {
    return !this.isExpired();
  }

  getRemainingTTL(): number {
    const now = Date.now();
    const expiresAt = new Date(this.expiresAt).getTime();
    return Math.max(0, expiresAt - now);
  }

  getRemainingTTLSeconds(): number {
    return Math.floor(this.getRemainingTTL() / 1000);
  }

  getTokenHash(): string {
    return this.tokenHash;
  }

  toJSON(): RefreshTokenPublicData {
    return {
      id: this.id,
      userId: this.userId,
      expiresAt: this.expiresAt,
      createdAt: this.createdAt,
      isExpired: this.isExpired(),
      remainingTTL: this.getRemainingTTLSeconds()
    };
  }

  static fromDatabase(row: RefreshTokenDatabaseRow | null): RefreshToken | null {
    if (!row) return null;
    return new RefreshToken(row);
  }

  static fromDatabaseArray(rows: RefreshTokenDatabaseRow[]): RefreshToken[] {
    return rows.map(row => RefreshToken.fromDatabase(row)).filter((t): t is RefreshToken => t !== null);
  }
}
