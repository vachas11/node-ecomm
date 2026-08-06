/**
 * User Controller - HTTP handlers for user operations
 * Handles request/response transformation, delegates to UserService
 */

import { Request, Response } from 'express';
import { UserService } from '../services/user.service';
import { asyncHandler } from '../../../../shared/errors';

interface AuthenticatedRequest extends Request {
  user?: { userId: number; email: string; role: string };
}

export function createUserController(userService: UserService) {
  const getProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const user = await userService.getUserById(userId);

    res.json({
      success: true,
      data: { user: user.toJSON() }
    });
  });

  const updateProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const { firstName, lastName, email } = req.body;

    const user = await userService.updateProfile(userId, { firstName, lastName, email });

    res.json({
      success: true,
      data: { user: user.toJSON() }
    });
  });

  const changePassword = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const { currentPassword, newPassword } = req.body;

    await userService.changePassword({ userId, currentPassword, newPassword });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  });

  return { getProfile, updateProfile, changePassword };
}
