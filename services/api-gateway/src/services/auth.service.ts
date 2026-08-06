/**
 * Auth Service - Business logic for authentication (API Gateway)
 * Owns: login, logout, token refresh, session management
 * Delegates: user validation to user-service via HTTP
 */

import crypto from 'crypto';
import axios from 'axios';
import { TokenRepository } from '../repositories/token.repository';
import { generateTokenPair, verifyRefreshToken, decodeTokenUnsafe, getTokenTTL } from '../../../../shared/auth/jwt';
import { addToBlacklist } from '../../../../shared/auth/blacklist';
import { UnauthorizedError, ServiceUnavailableError } from '../../../../shared/errors';
import logger from '../../../../shared/logger';
import config from '../config';

interface UserCredentials {
  email: string;
  password: string;
}

interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

interface UserData {
  id: number;
  email: string;
  role: string;
  firstName?: string;
  lastName?: string;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface AuthResult {
  user: UserData;
  tokens: TokenPair;
}

export class AuthService {
  private readonly userServiceUrl: string;

  constructor(private readonly tokenRepository: TokenRepository) {
    this.userServiceUrl = config.services.user.url;
  }

  async register(data: RegisterData): Promise<AuthResult> {
    const user = await this.callUserService<UserData>('POST', '/api/internal/users', {
      email: data.email,
      password: data.password,
      firstName: data.firstName,
      lastName: data.lastName
    });

    const tokens = generateTokenPair({ id: user.id, email: user.email, role: user.role });
    await this.storeRefreshToken(user.id, tokens.refreshToken);

    logger.info('User registered via gateway', { userId: user.id, email: user.email });
    return { user, tokens };
  }

  async login(credentials: UserCredentials): Promise<AuthResult> {
    const user = await this.callUserService<UserData>('POST', '/api/internal/users/validate', {
      email: credentials.email,
      password: credentials.password
    });

    const tokens = generateTokenPair({ id: user.id, email: user.email, role: user.role });
    await this.storeRefreshToken(user.id, tokens.refreshToken);

    logger.info('User logged in via gateway', { userId: user.id, email: user.email });
    return { user, tokens };
  }

  async refreshTokens(refreshToken: string): Promise<AuthResult> {
    let decoded: { userId: number };
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    const tokenHash = this.hashToken(refreshToken);
    const tokenRecord = await this.tokenRepository.findRefreshToken(tokenHash);
    if (!tokenRecord) {
      throw new UnauthorizedError('Refresh token not found or expired');
    }

    const user = await this.callUserService<UserData>('GET', `/api/internal/users/${decoded.userId}`);
    if (!user) {
      throw new UnauthorizedError('User not found or deactivated');
    }

    const tokens = generateTokenPair({ id: user.id, email: user.email, role: user.role });

    await this.tokenRepository.deleteRefreshToken(tokenHash);
    await this.storeRefreshToken(user.id, tokens.refreshToken);

    logger.info('Tokens refreshed via gateway', { userId: user.id });
    return { user, tokens };
  }

  async logout(userId: number, accessToken: string): Promise<boolean> {
    const ttl = getTokenTTL(accessToken);
    if (ttl > 0) {
      await addToBlacklist(decodeTokenUnsafe(accessToken)?.jti || '', ttl);
    }
    logger.info('User logged out', { userId });
    return true;
  }

  async logoutAllSessions(userId: number): Promise<number> {
    const deletedCount = await this.tokenRepository.deleteAllUserTokens(userId);
    logger.info('User logged out from all sessions', { userId, sessionsRevoked: deletedCount });
    return deletedCount;
  }

  async cleanupExpiredTokens(): Promise<number> {
    const count = await this.tokenRepository.cleanupExpiredTokens();
    logger.info('Expired tokens cleaned up', { count });
    return count;
  }

  private async storeRefreshToken(userId: number, refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    const decoded = decodeTokenUnsafe(refreshToken);
    if (!decoded?.exp) {
      throw new Error('Invalid refresh token - no expiry');
    }
    const expiresAt = new Date(decoded.exp * 1000);
    await this.tokenRepository.createRefreshToken(userId, tokenHash, expiresAt);
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async callUserService<T>(method: string, path: string, data?: any): Promise<T> {
    try {
      const response = await axios({
        method,
        url: `${this.userServiceUrl}${path}`,
        data,
        timeout: config.services.user.timeout,
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Name': 'api-gateway'
        }
      });

      if (!response.data.success) {
        throw new UnauthorizedError(response.data.error?.message || 'User service error');
      }

      return response.data.data;
    } catch (error: any) {
      if (error instanceof UnauthorizedError) {
        throw error;
      }
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          throw new UnauthorizedError(error.response.data?.error?.message || 'Invalid credentials');
        }
        if (error.response?.status === 404) {
          throw new UnauthorizedError('User not found');
        }
        if (error.response?.status === 409) {
          throw new UnauthorizedError(error.response.data?.error?.message || 'User already exists');
        }
        logger.error('User service call failed', {
          path,
          status: error.response?.status,
          message: error.message
        });
      }
      throw new ServiceUnavailableError('User service unavailable');
    }
  }
}
