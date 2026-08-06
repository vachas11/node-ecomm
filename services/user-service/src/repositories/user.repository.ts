/**
 * User Repository - Data access layer for users table
 */

import { User, UserDatabaseRow } from '../models/User';

// Database pool type (matches shared/database.js interface)
interface DatabasePool {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }>;
}

export interface CreateUserData {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role?: 'admin' | 'customer' | 'vendor';
}

export interface UpdateUserData {
  firstName?: string;
  lastName?: string;
  email?: string;
}

export class UserRepository {
  constructor(private readonly db: DatabasePool) {}

  async create(userData: CreateUserData): Promise<User | null> {
    const { email, passwordHash, firstName, lastName, role = 'customer' } = userData;

    const result = await this.db.query<UserDatabaseRow>(
      `INSERT INTO users (email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [email, passwordHash, firstName, lastName, role]
    );

    return User.fromDatabase(result.rows[0]);
  }

  async findById(id: number): Promise<User | null> {
    const result = await this.db.query<UserDatabaseRow>(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
    return User.fromDatabase(result.rows[0] || null);
  }

  async findByIdWithPassword(id: number): Promise<UserDatabaseRow | null> {
    const result = await this.db.query<UserDatabaseRow>(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const result = await this.db.query<UserDatabaseRow>(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    return User.fromDatabase(result.rows[0] || null);
  }

  async findByEmailWithPassword(email: string): Promise<UserDatabaseRow | null> {
    const result = await this.db.query<UserDatabaseRow>(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    return result.rows[0] || null;
  }

  async findActiveById(id: number): Promise<User | null> {
    const result = await this.db.query<UserDatabaseRow>(
      'SELECT * FROM users WHERE id = $1 AND is_active = true',
      [id]
    );
    return User.fromDatabase(result.rows[0] || null);
  }

  async existsByEmail(email: string): Promise<boolean> {
    const result = await this.db.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)',
      [email]
    );
    return result.rows[0].exists;
  }

  async existsByEmailExcludingUser(email: string, userId: number): Promise<boolean> {
    const result = await this.db.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM users WHERE email = $1 AND id != $2)',
      [email, userId]
    );
    return result.rows[0].exists;
  }

  async update(id: number, updates: UpdateUserData): Promise<User | null> {
    const fields: string[] = [];
    const values: (string | number)[] = [];
    let paramCount = 1;

    if (updates.firstName !== undefined) {
      fields.push(`first_name = $${paramCount++}`);
      values.push(updates.firstName);
    }
    if (updates.lastName !== undefined) {
      fields.push(`last_name = $${paramCount++}`);
      values.push(updates.lastName);
    }
    if (updates.email !== undefined) {
      fields.push(`email = $${paramCount++}`);
      values.push(updates.email);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const result = await this.db.query<UserDatabaseRow>(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );

    return User.fromDatabase(result.rows[0] || null);
  }

  async updatePassword(id: number, passwordHash: string): Promise<boolean> {
    const result = await this.db.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [passwordHash, id]
    );
    return result.rowCount > 0;
  }

  async updateEmailVerified(id: number, verified: boolean): Promise<boolean> {
    const result = await this.db.query(
      'UPDATE users SET email_verified = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [verified, id]
    );
    return result.rowCount > 0;
  }

  async deactivate(id: number): Promise<boolean> {
    const result = await this.db.query(
      'UPDATE users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );
    return result.rowCount > 0;
  }

  async activate(id: number): Promise<boolean> {
    const result = await this.db.query(
      'UPDATE users SET is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );
    return result.rowCount > 0;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.query(
      'DELETE FROM users WHERE id = $1',
      [id]
    );
    return result.rowCount > 0;
  }
}
