import { Router } from 'express';
import { createAuthController } from '../controllers/auth.controller';
import { AuthService } from '../services/auth.service';
import { TokenRepository } from '../repositories/token.repository';
import { authenticate } from '../../../../shared/auth/middleware';
import { loginRateLimiter, registerRateLimiter, refreshRateLimiter } from '../../../../shared/auth/rateLimiter';
import { validate, schemas } from '../middleware/validator';
import { db } from '../config/database';

const router = Router();

const tokenRepository = new TokenRepository(db);
const authService = new AuthService(tokenRepository);
const authController = createAuthController(authService);

router.post('/register', registerRateLimiter, validate(schemas.register), authController.register);
router.post('/login', loginRateLimiter, validate(schemas.login), authController.login);
router.post('/refresh', refreshRateLimiter, validate(schemas.refresh), authController.refresh);
router.post('/logout', authenticate(), authController.logout);
router.post('/logout-all', authenticate(), authController.logoutAll);

export default router;
