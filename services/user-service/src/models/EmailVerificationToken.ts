interface EmailVerificationTokenDataBaseRow {
  id: number;
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

export class EmailVerificationToken {
  public readonly id: number;
  public readonly userId: number;
  public readonly tokenHash: string;
  public readonly expiresAt: Date;
  public readonly createdAt: Date;

  constructor(data: EmailVerificationTokenDataBaseRow) {
    this.id = data.id;
    this.userId = data.userId;
    this.tokenHash = data.tokenHash;
    this.expiresAt = data.expiresAt;
    this.createdAt = data.createdAt;
  }
  isExpired(): boolean {
    return this.expiresAt.getTime() < Date.now();
  }
  isValid(): boolean {
    return this.expiresAt.getTime() > Date.now();
  }
  getRemainingTTL(): number {
    return this.expiresAt.getTime() - Date.now();
  }
}
