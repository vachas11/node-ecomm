import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { UnauthorizedError } from '../errors';

const JWT_SECRET = process.env.JWT_SECRET || '';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || '';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

interface TokenPayload {
  userId: number;
  email: string;
  role: string;
  jti?: string;
  tokenType?: string;
  iat?: number;
}

interface RefreshTokenPayload {
  userId: number;
  jti?: string;
  tokenType?: string;
  iat?: number;
}

interface ServiceTokenPayload {
  serviceId: string;
  permissions: string[];
  jti?: string;
  tokenType?: string;
  iat?: number;
}

interface UserForToken {
  id: number;
  email: string;
  role: string;
}

const JWT_ISSUER = process.env.JWT_ISSUER || 'api-gateway';

export const generateAccessToken = (payload: Partial<TokenPayload>, options: jwt.SignOptions = {}): string => {
  const tokenPayload = {
    ...payload,
    jti: uuidv4(),
    tokenType: 'access',
    iat: Math.floor(Date.now() / 1000)
  };

  return jwt.sign(tokenPayload, JWT_SECRET, {
    expiresIn: options.expiresIn || JWT_EXPIRES_IN,
    issuer: options.issuer || JWT_ISSUER,
    ...options
  });
};

export const generateRefreshToken = (payload: { userId: number }): string => {
  const tokenPayload = {
    userId: payload.userId,
    jti: uuidv4(),
    tokenType: 'refresh',
    iat: Math.floor(Date.now() / 1000)
  };

  return jwt.sign(tokenPayload, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
    issuer: JWT_ISSUER
  });
};

export const generateServiceToken = (serviceId: string, options: { permissions?: string[]; expiresIn?: string } = {}): string => {
  const tokenPayload = {
    serviceId,
    permissions: options.permissions || [],
    jti: uuidv4(),
    tokenType: 'service',
    iat: Math.floor(Date.now() / 1000)
  };

  return jwt.sign(tokenPayload, JWT_SECRET, {
    expiresIn: options.expiresIn || '1h',
    issuer: JWT_ISSUER
  });
};

export const verifyAccessToken = (token: string): TokenPayload & { jti: string; tokenType: string } => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload & { jti: string; tokenType: string };
    if (decoded.tokenType !== 'access') {
      throw new UnauthorizedError('Invalid token type');
    }
    return decoded;
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') throw new UnauthorizedError('Token expired');
    if (error.name === 'JsonWebTokenError') throw new UnauthorizedError('Invalid token');
    throw new UnauthorizedError('Token verification failed');
  }
};

export const verifyRefreshToken = (token: string): RefreshTokenPayload & { jti: string; tokenType: string } => {
  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET) as RefreshTokenPayload & { jti: string; tokenType: string };
    if (decoded.tokenType !== 'refresh') {
      throw new UnauthorizedError('Invalid token type');
    }
    return decoded;
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') throw new UnauthorizedError('Refresh token expired');
    if (error.name === 'JsonWebTokenError') throw new UnauthorizedError('Invalid refresh token');
    throw new UnauthorizedError('Refresh token verification failed');
  }
};

export const verifyServiceToken = (token: string): ServiceTokenPayload & { jti: string; tokenType: string } => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as ServiceTokenPayload & { jti: string; tokenType: string };
    if (decoded.tokenType !== 'service') {
      throw new UnauthorizedError('Invalid token type - service token required');
    }
    return decoded;
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') throw new UnauthorizedError('Service token expired');
    if (error.name === 'JsonWebTokenError') throw new UnauthorizedError('Invalid service token');
    throw new UnauthorizedError('Service token verification failed');
  }
};

export const generateTokenPair = (user: UserForToken): { accessToken: string; refreshToken: string } => {
  const payload = { userId: user.id, email: user.email, role: user.role };
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken({ userId: user.id })
  };
};

export const decodeTokenUnsafe = (token: string): jwt.JwtPayload | null => {
  try {
    return jwt.decode(token) as jwt.JwtPayload;
  } catch {
    return null;
  }
};

export const getTokenExpiry = (token: string): number | null => {
  const decoded = decodeTokenUnsafe(token);
  return decoded?.exp || null;
};

export const getTokenTTL = (token: string): number => {
  const expiry = getTokenExpiry(token);
  if (!expiry) return 0;
  const now = Math.floor(Date.now() / 1000);
  return Math.max(0, expiry - now);
};
