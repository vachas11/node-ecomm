/**
 * Auth Controller - HTTP handlers for authentication (API Gateway)
 */

import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { asyncHandler } from '../../../../shared/errors';

interface AuthenticatedRequest extends Request {
  user?: { userId: number; email: string; role: string; jti: string };
  token?: string;
}

export function createAuthController(authService: AuthService) {
  const register = asyncHandler(async (req: Request, res: Response) => {
    const { email, password, firstName, lastName } = req.body;
    const result = await authService.register({ email, password, firstName, lastName });

    res.status(201).json({
      success: true,
      data: {
        user: result.user,
        tokens: result.tokens
      }
    });
  });

  const login = asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const result = await authService.login({ email, password });

    res.json({
      success: true,
      data: {
        user: result.user,
        tokens: result.tokens
      }
    });
  });

  const refresh = asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = req.body;
    const result = await authService.refreshTokens(refreshToken);

    res.json({
      success: true,
      data: { tokens: result.tokens }
    });
  });

  const logout = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const accessToken = req.token!;
    await authService.logout(userId, accessToken);

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  });

  const logoutAll = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const deletedCount = await authService.logoutAllSessions(userId);

    res.json({
      success: true,
      message: `Logged out from all devices (${deletedCount} sessions)`,
      data: { sessionsRevoked: deletedCount }
    });
  });

  return { register, login, refresh, logout, logoutAll };
}
