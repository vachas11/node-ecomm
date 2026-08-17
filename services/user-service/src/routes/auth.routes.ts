/**
 * Auth Routes - User profile and password operations
 * Note: Login, logout, refresh are handled by API Gateway
 */

import { Router } from 'express';
import { authenticate } from '../../../../shared/auth/middleware';
import { validate, schemas } from '../middleware/validator';
import { passwordChangeRateLimiter } from '../../../../shared/auth/rateLimiter';
import { createUserController } from '../controllers/user.controller';
import { UserService } from '../services/user.service';
import { UserRepository } from '../repositories/user.repository';
import { db, prisma } from '../config/database';

const router = Router();

// Initialize repository with dual-mode (Prisma + DatabasePool)
const userRepository = new UserRepository(prisma, db);
const userService = new UserService(userRepository);
const userController = createUserController(userService);

router.get('/profile', authenticate(), userController.getProfile);
router.put('/profile', authenticate(), validate(schemas.updateProfile), userController.updateProfile);
router.put('/change-password', authenticate(), passwordChangeRateLimiter, validate(schemas.changePassword), userController.changePassword);

export default router;
