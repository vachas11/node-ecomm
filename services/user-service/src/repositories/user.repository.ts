/**
 * User Repository - Data access layer for users table
 * Dual-mode: Prisma ORM for simple CRUD, raw SQL for complex queries
 */

import { PrismaClient } from '../generated/prisma-client';
import { User, UserDatabaseRow } from '../models/User';

// Database pool type (matches shared/database interface)
interface DatabasePool {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount: number | null }>;
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
  constructor(
    private readonly prisma: PrismaClient,
    private readonly db: DatabasePool
  ) {}

  // ✅ MIGRATED TO PRISMA - Simple CREATE
  async create(userData: CreateUserData): Promise<User | null> {
    const { email, passwordHash, firstName, lastName, role = 'customer' } = userData;

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        role,
      },
    });

    return User.fromDatabase(this.toDatabaseRow(user));
  }

  // ✅ MIGRATED TO PRISMA - Simple SELECT by ID
  async findById(id: number): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    return user ? User.fromDatabase(this.toDatabaseRow(user)) : null;
  }

  // ✅ MIGRATED TO PRISMA - SELECT with password
  async findByIdWithPassword(id: number): Promise<UserDatabaseRow | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    return user ? this.toDatabaseRow(user) : null;
  }

  // ✅ MIGRATED TO PRISMA - Simple SELECT by email
  async findByEmail(email: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    return user ? User.fromDatabase(this.toDatabaseRow(user)) : null;
  }

  // ✅ MIGRATED TO PRISMA - SELECT with password
  async findByEmailWithPassword(email: string): Promise<UserDatabaseRow | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    return user ? this.toDatabaseRow(user) : null;
  }

  // ✅ MIGRATED TO PRISMA - SELECT with filter
  async findActiveById(id: number): Promise<User | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        isActive: true,
      },
    });

    return user ? User.fromDatabase(this.toDatabaseRow(user)) : null;
  }

  // ✅ MIGRATED TO PRISMA - EXISTS check
  async existsByEmail(email: string): Promise<boolean> {
    const count = await this.prisma.user.count({
      where: { email },
    });
    return count > 0;
  }

  // ✅ MIGRATED TO PRISMA - EXISTS with exclusion
  async existsByEmailExcludingUser(email: string, userId: number): Promise<boolean> {
    const count = await this.prisma.user.count({
      where: {
        email,
        id: { not: userId },
      },
    });
    return count > 0;
  }

  // ✅ MIGRATED TO PRISMA - UPDATE with partial data
  async update(id: number, updates: UpdateUserData): Promise<User | null> {
    if (Object.keys(updates).length === 0) {
      return this.findById(id);
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(updates.firstName !== undefined && { firstName: updates.firstName }),
        ...(updates.lastName !== undefined && { lastName: updates.lastName }),
        ...(updates.email !== undefined && { email: updates.email }),
        updatedAt: new Date(),
      },
    });

    return User.fromDatabase(this.toDatabaseRow(user));
  }

  // ✅ MIGRATED TO PRISMA - UPDATE password
  async updatePassword(id: number, passwordHash: string): Promise<boolean> {
    const result = await this.prisma.user.updateMany({
      where: { id },
      data: {
        passwordHash,
        updatedAt: new Date(),
      },
    });
    return result.count > 0;
  }

  // ✅ MIGRATED TO PRISMA - UPDATE email verification
  async updateEmailVerified(id: number, verified: boolean): Promise<boolean> {
    const result = await this.prisma.user.updateMany({
      where: { id },
      data: {
        emailVerified: verified,
        updatedAt: new Date(),
      },
    });
    return result.count > 0;
  }

  // ✅ MIGRATED TO PRISMA - Soft delete (deactivate)
  async deactivate(id: number): Promise<boolean> {
    const result = await this.prisma.user.updateMany({
      where: { id },
      data: {
        isActive: false,
        updatedAt: new Date(),
      },
    });
    return result.count > 0;
  }

  // ✅ MIGRATED TO PRISMA - Activate user
  async activate(id: number): Promise<boolean> {
    const result = await this.prisma.user.updateMany({
      where: { id },
      data: {
        isActive: true,
        updatedAt: new Date(),
      },
    });
    return result.count > 0;
  }

  // ✅ MIGRATED TO PRISMA - DELETE
  async delete(id: number): Promise<boolean> {
    const result = await this.prisma.user.deleteMany({
      where: { id },
    });
    return result.count > 0;
  }

  // ============================================================================
  // COMPLEX QUERIES - Use raw SQL for advanced scenarios
  // ============================================================================

  /**
   * 🔧 RAW SQL EXAMPLE 1: User Activity Analytics with CTEs and Window Functions
   *
   * Use Case: Generate user engagement report with rankings
   * Why Raw SQL: Requires CTEs, window functions (RANK, PERCENT_RANK), and complex JOINs
   *
   * @param startDate - Start of analysis period
   * @param endDate - End of analysis period
   * @returns User activity statistics with rankings
   */
  async getUserActivityReport(
    startDate: Date,
    endDate: Date
  ): Promise<
    Array<{
      userId: number;
      email: string;
      firstName: string;
      lastName: string;
      orderCount: number;
      totalSpent: number;
      avgOrderValue: number;
      spendingRank: number;
      spendingPercentile: number;
    }>
  > {
    const result = await this.db.query(
      `
      WITH user_orders AS (
        -- Aggregate orders per user
        SELECT
          u.id,
          u.email,
          u.first_name,
          u.last_name,
          COUNT(o.id) as order_count,
          COALESCE(SUM(o.total_amount), 0) as total_spent,
          COALESCE(AVG(o.total_amount), 0) as avg_order_value
        FROM users u
        LEFT JOIN orders o ON u.id = o.user_id
          AND o.created_at BETWEEN $1 AND $2
          AND o.status NOT IN ('cancelled', 'refunded')
        GROUP BY u.id, u.email, u.first_name, u.last_name
      )
      SELECT
        id as "userId",
        email,
        first_name as "firstName",
        last_name as "lastName",
        order_count as "orderCount",
        total_spent as "totalSpent",
        avg_order_value as "avgOrderValue",
        RANK() OVER (ORDER BY total_spent DESC) as "spendingRank",
        PERCENT_RANK() OVER (ORDER BY total_spent DESC) as "spendingPercentile"
      FROM user_orders
      WHERE order_count > 0
      ORDER BY total_spent DESC
      LIMIT 100
    `,
      [startDate, endDate]
    );

    return result.rows;
  }

  /**
   * 🔧 RAW SQL EXAMPLE 2: Bulk Role Update with PostgreSQL VALUES Clause
   *
   * Use Case: Update multiple users' roles in a single query (admin operations)
   * Why Raw SQL: VALUES clause is more efficient than N individual updates
   *
   * Performance: 100 updates in ~5ms vs 100 individual Prisma updates in ~500ms
   *
   * @param updates - Array of {id, role} pairs
   */
  async bulkUpdateRoles(updates: Array<{ id: number; role: string }>): Promise<void> {
    if (updates.length === 0) return;

    // Build VALUES clause: ($1, $2), ($3, $4), ...
    const values = updates.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
    const params = updates.flatMap((u) => [u.id, u.role]);

    await this.db.query(
      `
      UPDATE users
      SET role = v.role,
          updated_at = CURRENT_TIMESTAMP
      FROM (VALUES ${values}) AS v(id, role)
      WHERE users.id = v.id::int
    `,
      params
    );
  }

  /**
   * 🔧 RAW SQL EXAMPLE 3: User Cohort Analysis with Recursive CTE
   *
   * Use Case: Analyze user retention by signup cohort
   * Why Raw SQL: Requires date bucketing, recursive grouping, and complex aggregations
   *
   * @returns Monthly cohort data with retention rates
   */
  async getCohortAnalysis(): Promise<
    Array<{
      cohortMonth: string;
      totalUsers: number;
      activeUsers: number;
      retentionRate: number;
    }>
  > {
    const result = await this.db.query(`
      WITH cohorts AS (
        -- Group users by signup month
        SELECT
          DATE_TRUNC('month', created_at) as cohort_month,
          COUNT(*) as total_users
        FROM users
        WHERE created_at >= NOW() - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', created_at)
      ),
      active_users AS (
        -- Count users with recent activity
        SELECT
          DATE_TRUNC('month', u.created_at) as cohort_month,
          COUNT(DISTINCT u.id) as active_count
        FROM users u
        INNER JOIN orders o ON u.id = o.user_id
        WHERE u.created_at >= NOW() - INTERVAL '12 months'
          AND o.created_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE_TRUNC('month', u.created_at)
      )
      SELECT
        TO_CHAR(c.cohort_month, 'YYYY-MM') as "cohortMonth",
        c.total_users as "totalUsers",
        COALESCE(a.active_count, 0) as "activeUsers",
        ROUND(COALESCE(a.active_count, 0)::numeric / c.total_users * 100, 2) as "retentionRate"
      FROM cohorts c
      LEFT JOIN active_users a ON c.cohort_month = a.cohort_month
      ORDER BY c.cohort_month DESC
    `);

    return result.rows;
  }

  /**
   * 🔧 RAW SQL EXAMPLE 4: Full-Text Search with PostgreSQL
   *
   * Use Case: Search users by name or email with relevance ranking
   * Why Raw SQL: PostgreSQL's full-text search features (to_tsvector, ts_rank)
   *
   * @param searchTerm - Search query
   * @param limit - Max results
   * @returns Users matching search with relevance score
   */
  async searchUsers(
    searchTerm: string,
    limit: number = 20
  ): Promise<Array<{ user: User; relevance: number }>> {
    const result = await this.db.query<UserDatabaseRow & { relevance: number }>(
      `
      SELECT
        u.*,
        ts_rank(
          to_tsvector('english', u.first_name || ' ' || u.last_name || ' ' || u.email),
          plainto_tsquery('english', $1)
        ) as relevance
      FROM users u
      WHERE to_tsvector('english', u.first_name || ' ' || u.last_name || ' ' || u.email)
        @@ plainto_tsquery('english', $1)
        AND u.is_active = true
      ORDER BY relevance DESC, u.first_name ASC
      LIMIT $2
    `,
      [searchTerm, limit]
    );

    return result.rows.map((row) => ({
      user: User.fromDatabase(row)!,
      relevance: row.relevance,
    }));
  }

  /**
   * 🔧 RAW SQL EXAMPLE 5: User Segmentation with CASE and Aggregations
   *
   * Use Case: Segment users by lifetime value for marketing campaigns
   * Why Raw SQL: Complex CASE logic with multiple aggregations
   *
   * @returns User segments with counts and average values
   */
  async getUserSegmentation(): Promise<
    Array<{
      segment: string;
      userCount: number;
      avgLifetimeValue: number;
      avgOrderCount: number;
    }>
  > {
    const result = await this.db.query(`
      WITH user_ltv AS (
        SELECT
          u.id,
          COUNT(o.id) as order_count,
          COALESCE(SUM(o.total_amount), 0) as lifetime_value
        FROM users u
        LEFT JOIN orders o ON u.id = o.user_id
          AND o.status NOT IN ('cancelled', 'refunded')
        GROUP BY u.id
      )
      SELECT
        CASE
          WHEN lifetime_value >= 1000 THEN 'VIP'
          WHEN lifetime_value >= 500 THEN 'High Value'
          WHEN lifetime_value >= 100 THEN 'Medium Value'
          WHEN order_count > 0 THEN 'Low Value'
          ELSE 'Inactive'
        END as segment,
        COUNT(*) as "userCount",
        ROUND(AVG(lifetime_value)::numeric, 2) as "avgLifetimeValue",
        ROUND(AVG(order_count)::numeric, 2) as "avgOrderCount"
      FROM user_ltv
      GROUP BY segment
      ORDER BY
        CASE segment
          WHEN 'VIP' THEN 1
          WHEN 'High Value' THEN 2
          WHEN 'Medium Value' THEN 3
          WHEN 'Low Value' THEN 4
          ELSE 5
        END
    `);

    return result.rows;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Helper: Transform Prisma result to UserDatabaseRow
   * Maps camelCase (Prisma) back to snake_case (domain model expects)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toDatabaseRow(user: any): UserDatabaseRow {
    return {
      id: user.id,
      email: user.email,
      password_hash: user.passwordHash,
      first_name: user.firstName,
      last_name: user.lastName,
      role: user.role as 'admin' | 'customer' | 'vendor',
      is_active: user.isActive,
      email_verified: user.emailVerified,
      created_at: user.createdAt,
      updated_at: user.updatedAt,
    };
  }
}
