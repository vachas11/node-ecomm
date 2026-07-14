const { db } = require('../config/database');
const { hashPassword, comparePassword, validatePasswordStrength } = require('../utils/password');
const { generateTokenPair } = require('../utils/jwt');
const {
  ValidationError,
  UnauthorizedError,
  ConflictError,
  NotFoundError
} = require('../../../../shared/errors');
const { asyncHandler } = require('../../../../shared/errors');
const logger = require('../../../../shared/logger');

// Register new user
const register = asyncHandler(async (req, res) => {
  const { email, password, firstName, lastName } = req.body;

  // Validate password strength
  const passwordValidation = validatePasswordStrength(password);
  if (!passwordValidation.isValid) {
    throw new ValidationError('Password validation failed', passwordValidation.errors);
  }

  // Check if user already exists
  const existingUser = await db.query(
    'SELECT id FROM users WHERE email = $1',
    [email]
  );

  if (existingUser.rows.length > 0) {
    throw new ConflictError('User with this email already exists');
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Insert user
  const result = await db.query(
    `INSERT INTO users (email, password_hash, first_name, last_name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, first_name, last_name, role, created_at`,
    [email, passwordHash, firstName, lastName]
  );

  const user = result.rows[0];

  // Generate tokens
  const tokens = generateTokenPair(user);

  logger.info('User registered successfully', { userId: user.id, email: user.email });

  res.status(201).json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role
      },
      tokens
    }
  });
});

// Login user
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Find user
  const result = await db.query(
    `SELECT id, email, password_hash, first_name, last_name, role, is_active
     FROM users WHERE email = $1`,
    [email]
  );

  if (result.rows.length === 0) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const user = result.rows[0];

  // Check if account is active
  if (!user.is_active) {
    throw new UnauthorizedError('Account is deactivated');
  }

  // Verify password
  const isPasswordValid = await comparePassword(password, user.password_hash);
  if (!isPasswordValid) {
    throw new UnauthorizedError('Invalid email or password');
  }

  // Generate tokens
  const tokens = generateTokenPair(user);

  logger.info('User logged in successfully', { userId: user.id, email: user.email });

  res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role
      },
      tokens
    }
  });
});

// Get current user profile
const getProfile = asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  const result = await db.query(
    `SELECT id, email, first_name, last_name, role, email_verified, created_at
     FROM users WHERE id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('User not found');
  }

  const user = result.rows[0];

  res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        emailVerified: user.email_verified,
        createdAt: user.created_at
      }
    }
  });
});

// Update user profile
const updateProfile = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const { firstName, lastName, email } = req.body;

  // Check if new email already exists (if email is being changed)
  if (email) {
    const existingUser = await db.query(
      'SELECT id FROM users WHERE email = $1 AND id != $2',
      [email, userId]
    );

    if (existingUser.rows.length > 0) {
      throw new ConflictError('Email already in use');
    }
  }

  // Build dynamic update query
  const updates = [];
  const values = [];
  let paramCount = 1;

  if (firstName !== undefined) {
    updates.push(`first_name = $${paramCount}`);
    values.push(firstName);
    paramCount++;
  }
  if (lastName !== undefined) {
    updates.push(`last_name = $${paramCount}`);
    values.push(lastName);
    paramCount++;
  }
  if (email !== undefined) {
    updates.push(`email = $${paramCount}`);
    values.push(email);
    paramCount++;
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(userId);

  const result = await db.query(
    `UPDATE users SET ${updates.join(', ')}
     WHERE id = $${paramCount}
     RETURNING id, email, first_name, last_name, role`,
    values
  );

  const user = result.rows[0];

  logger.info('User profile updated', { userId: user.id });

  res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role
      }
    }
  });
});

// Change password
const changePassword = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const { currentPassword, newPassword } = req.body;

  // Validate new password strength
  const passwordValidation = validatePasswordStrength(newPassword);
  if (!passwordValidation.isValid) {
    throw new ValidationError('New password validation failed', passwordValidation.errors);
  }

  // Get current password hash
  const result = await db.query(
    'SELECT password_hash FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('User not found');
  }

  const user = result.rows[0];

  // Verify current password
  const isCurrentPasswordValid = await comparePassword(currentPassword, user.password_hash);
  if (!isCurrentPasswordValid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  // Hash new password
  const newPasswordHash = await hashPassword(newPassword);

  // Update password
  await db.query(
    'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [newPasswordHash, userId]
  );

  logger.info('User password changed', { userId });

  res.json({
    success: true,
    message: 'Password changed successfully'
  });
});

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  changePassword
};
