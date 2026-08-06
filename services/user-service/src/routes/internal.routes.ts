/**
 * Internal Routes - Service-to-service communication
 * These endpoints are called by api-gateway, NOT exposed publicly
 * Security: Network-level isolation (Docker network) + X-Service-Name header check
 *
 * IMPORTANT: All routes go through UserService (proper layered architecture)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { UserService } from '../services/user.service';
import { UserRepository } from '../repositories/user.repository';
import { db } from '../config/database';
import { asyncHandler, ValidationError } from '../../../../shared/errors';
import logger from '../../../../shared/logger';

const router = Router();

const userRepository = new UserRepository(db);
const userService = new UserService(userRepository);

const verifyInternalService = (req: Request, res: Response, next: NextFunction): void => {
  const serviceName = req.headers['x-service-name'];
  const allowedServices = ['api-gateway', 'order-service', 'product-service'];

  if (!serviceName || !allowedServices.includes(serviceName as string)) {
    logger.warn('Unauthorized internal service call', { serviceName, path: req.path, ip: req.ip });
    res.status(403).json({ success: false, error: { message: 'Forbidden', statusCode: 403 } });
    return;
  }

  next();
};

router.use(verifyInternalService);

router.post(
  '/users',
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password, firstName, lastName } = req.body;

    const user = await userService.createUser({ email, password, firstName, lastName });

    res.status(201).json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName
      }
    });
  })
);

router.post(
  '/users/validate',
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;

    const result = await userService.validateCredentials(email, password);

    res.json({
      success: true,
      data: result
    });
  })
);

router.get(
  '/users/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = parseInt(req.params.id, 10);

    const user = await userService.getActiveUserById(userId);

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName
      }
    });
  })
);

router.put(
  '/users/:id/password',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = parseInt(req.params.id, 10);
    const { currentPassword, newPassword } = req.body;

    await userService.changePassword({ userId, currentPassword, newPassword });

    res.json({ success: true, message: 'Password changed successfully' });
  })
);

router.post(
  '/users/bulk',
  asyncHandler(async (req: Request, res: Response) => {
    const { userIds } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new ValidationError('userIds array is required');
    }

    const users = await userService.getUsersById(userIds);

    res.json({
      success: true,
      data: {
        users: users.map(u => ({
          id: u.id,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
          isActive: u.isActive
        })),
        count: users.length
      }
    });
  })
);

export default router;
