// isExpired()`, `isUsed()`, `canBeUsed()`, `markAsUsed()
interface PasswordResetTokenDatabaseRow {
  id: number;
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export class PasswordResetToken {
  public readonly id: number;
  public readonly userId: number;
  public readonly tokenHash: string;
  public readonly expiresAt: Date;
  public readonly usedAt: Date | null;
  public readonly createdAt: Date;

  constructor(data: PasswordResetTokenDatabaseRow) {
    this.createdAt = data.createdAt;
    this.usedAt = data.usedAt;
    this.expiresAt = data.expiresAt;
    this.tokenHash = data.tokenHash;
    this.userId = data.userId;
    this.id = data.id;
  }

  isExpired(): boolean {
    return this.expiresAt.getTime() < Date.now();
  }
  isUsed(): boolean {
    return !!this.usedAt;
  }
  canBeUsed(): boolean {
    return !this.isExpired() && !this.isUsed();
  }
}
