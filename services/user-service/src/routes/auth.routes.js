const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../../../../shared/auth/middleware');
const { validate, schemas } = require('../middleware/validator');
const {
  loginRateLimiter,
  registerRateLimiter,
  refreshRateLimiter,
  passwordChangeRateLimiter
} = require('../../../../shared/auth/rateLimiter');

// Public routes with rate limiting
router.post('/register', registerRateLimiter, validate(schemas.register), authController.register);
router.post('/login', loginRateLimiter, validate(schemas.login), authController.login);
router.post('/refresh', refreshRateLimiter, authController.refresh);

// Protected routes (require authentication)
router.get('/profile', authenticate(), authController.getProfile);
router.put('/profile', authenticate(), validate(schemas.updateProfile), authController.updateProfile);
router.put('/change-password', authenticate(), passwordChangeRateLimiter, validate(schemas.changePassword), authController.changePassword);

// Logout routes
router.post('/logout', authenticate(), authController.logout);
router.post('/logout-all', authenticate(), authController.logoutAll);

module.exports = router;
