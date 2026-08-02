const express = require('express');
const router = express.Router();
const { authenticateService, authorizeService } = require('../../../../shared/auth/middleware');
const { db } = require('../config/database');
const { asyncHandler } = require('../../../../shared/errors');
const { NotFoundError } = require('../../../../shared/errors');

/**
 * Internal API Routes
 *
 * These routes are intended for service-to-service communication only.
 * They require a service token (not a user token) for authentication.
 *
 * Example usage from another service:
 *
 * const { generateServiceToken } = require('../../../shared/auth/jwt');
 * const serviceToken = generateServiceToken('order-service', {
 *   permissions: ['read:users']
 * });
 *
 * const response = await axios.get('http://user-service:3001/api/internal/users/123', {
 *   headers: { 'Authorization': `Bearer ${serviceToken}` }
 * });
 */

// Get user by ID (for other services)
router.get(
  '/users/:id',
  authenticateService,
  authorizeService('read:users'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const result = await db.query(
      `SELECT id, email, first_name, last_name, role, is_active, email_verified, created_at
       FROM users WHERE id = $1`,
      [id]
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
          isActive: user.is_active,
          emailVerified: user.email_verified,
          createdAt: user.created_at
        }
      },
      requestedBy: req.service.serviceId
    });
  })
);

// Get multiple users by IDs (bulk operation)
router.post(
  '/users/bulk',
  authenticateService,
  authorizeService('read:users'),
  asyncHandler(async (req, res) => {
    const { userIds } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'userIds array is required',
          statusCode: 400
        }
      });
    }

    // Limit bulk requests to 100 users
    if (userIds.length > 100) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Maximum 100 users per bulk request',
          statusCode: 400
        }
      });
    }

    const result = await db.query(
      `SELECT id, email, first_name, last_name, role, is_active
       FROM users WHERE id = ANY($1::int[])`,
      [userIds]
    );

    const users = result.rows.map(user => ({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      isActive: user.is_active
    }));

    res.json({
      success: true,
      data: {
        users,
        count: users.length
      },
      requestedBy: req.service.serviceId
    });
  })
);

// Verify user exists and is active (lightweight check)
router.get(
  '/users/:id/verify',
  authenticateService,
  authorizeService('read:users', 'verify:users'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const result = await db.query(
      'SELECT id, is_active FROM users WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: {
          exists: false,
          isActive: false
        }
      });
    }

    const user = result.rows[0];

    res.json({
      success: true,
      data: {
        exists: true,
        isActive: user.is_active
      }
    });
  })
);

module.exports = router;
