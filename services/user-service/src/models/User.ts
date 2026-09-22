/**
 * User Entity Model
 *
 * Domain model with TypeScript type safety.
 * Maps PostgreSQL snake_case to JavaScript camelCase.
 */

// Database row shape from PostgreSQL
export interface UserDatabaseRow {
  id: number;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: 'admin' | 'customer' | 'vendor';
  is_active: boolean;
  email_verified: boolean;
  avatar: string | null;
  created_at: Date;
  updated_at: Date;
}

// Public API response shape
export interface UserPublicData {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  emailVerified: boolean;
  avatar: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class User {
  public readonly id: number;
  public readonly email: string;
  public readonly firstName: string;
  public readonly lastName: string;
  public readonly role: string;
  public readonly isActive: boolean;
  public readonly emailVerified: boolean;
  public readonly avatar: string | null;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(data: UserDatabaseRow) {
    this.id = data.id;
    this.email = data.email;
    this.firstName = data.first_name;
    this.lastName = data.last_name;
    this.role = data.role;
    this.isActive = data.is_active;
    this.emailVerified = data.email_verified;
    this.avatar = data.avatar;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  toJSON(): UserPublicData {
    return {
      id: this.id,
      email: this.email,
      firstName: this.firstName,
      lastName: this.lastName,
      role: this.role,
      isActive: this.isActive,
      emailVerified: this.emailVerified,
      avatar: this.avatar,
      avatarUrl: this.getAvatarUrl(),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  getFullName(): string {
    return `${this.firstName} ${this.lastName}`.trim();
  }

  isAdmin(): boolean {
    return this.role === 'admin';
  }

  isCustomer(): boolean {
    return this.role === 'customer';
  }

  canAccess(requiredRole: string): boolean {
    const roleHierarchy: Record<string, number> = {
      'customer': 1,
      'vendor': 2,
      'admin': 3
    };
    return (roleHierarchy[this.role] || 0) >= (roleHierarchy[requiredRole] || 0);
  }

  /**
   * Get full avatar URL for API responses
   * Returns null if no avatar is set
   */
  getAvatarUrl(): string | null {
    if (!this.avatar) return null;
    const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
    return `${baseUrl}/uploads/avatars/${this.avatar}`;
  }

  static fromDatabase(row: UserDatabaseRow | null): User | null {
    if (!row) return null;
    return new User(row);
  }

  static fromDatabaseArray(rows: UserDatabaseRow[]): User[] {
    return rows.map(row => User.fromDatabase(row)).filter((u): u is User => u !== null);
  }
}
