const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { UnauthorizedError } = require('../errors');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m'; // Changed from 24h to 15m
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

// Validate JWT secrets on startup
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long');
}

if (!JWT_REFRESH_SECRET || JWT_REFRESH_SECRET.length < 32) {
  throw new Error('JWT_REFRESH_SECRET must be at least 32 characters long');
}

if (JWT_SECRET === JWT_REFRESH_SECRET) {
  throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be different');
}

// Generate access token
const generateAccessToken = (payload, options = {}) => {
  const tokenPayload = {
    ...payload,
    jti: uuidv4(), // JWT ID for revocation tracking
    tokenType: 'access',
    iat: Math.floor(Date.now() / 1000)
  };

  return jwt.sign(tokenPayload, JWT_SECRET, {
    expiresIn: options.expiresIn || JWT_EXPIRES_IN,
    issuer: options.issuer || 'user-service',
    ...options
  });
};

// Generate refresh token
const generateRefreshToken = (payload) => {
  const tokenPayload = {
    userId: payload.userId, // Only userId for refresh tokens
    jti: uuidv4(),
    tokenType: 'refresh',
    iat: Math.floor(Date.now() / 1000)
  };

  return jwt.sign(tokenPayload, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
    issuer: 'user-service'
  });
};

// Generate service token (for service-to-service authentication)
const generateServiceToken = (serviceId, options = {}) => {
  const tokenPayload = {
    serviceId,
    permissions: options.permissions || [],
    jti: uuidv4(),
    tokenType: 'service',
    iat: Math.floor(Date.now() / 1000)
  };

  return jwt.sign(tokenPayload, JWT_SECRET, {
    expiresIn: options.expiresIn || '1h',
    issuer: 'auth-service',
    ...options
  });
};

// Verify access token
const verifyAccessToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.tokenType !== 'access') {
      throw new UnauthorizedError('Invalid token type');
    }

    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new UnauthorizedError('Token expired');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new UnauthorizedError('Invalid token');
    }
    throw new UnauthorizedError('Token verification failed');
  }
};

// Verify refresh token
const verifyRefreshToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET);

    if (decoded.tokenType !== 'refresh') {
      throw new UnauthorizedError('Invalid token type');
    }

    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new UnauthorizedError('Refresh token expired');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new UnauthorizedError('Invalid refresh token');
    }
    throw new UnauthorizedError('Refresh token verification failed');
  }
};

// Verify service token
const verifyServiceToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.tokenType !== 'service') {
      throw new UnauthorizedError('Invalid token type - service token required');
    }

    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new UnauthorizedError('Service token expired');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new UnauthorizedError('Invalid service token');
    }
    throw new UnauthorizedError('Service token verification failed');
  }
};

// Generate token pair (access + refresh)
const generateTokenPair = (user) => {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role
  };

  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken({ userId: user.id })
  };
};

// Decode token without verification (useful for getting jti before validation)
const decodeTokenUnsafe = (token) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    return null;
  }
};

// Get token expiry timestamp
const getTokenExpiry = (token) => {
  const decoded = decodeTokenUnsafe(token);
  return decoded ? decoded.exp : null;
};

// Get remaining time in seconds
const getTokenTTL = (token) => {
  const expiry = getTokenExpiry(token);
  if (!expiry) return 0;

  const now = Math.floor(Date.now() / 1000);
  return Math.max(0, expiry - now);
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generateServiceToken,
  verifyAccessToken,
  verifyRefreshToken,
  verifyServiceToken,
  generateTokenPair,
  decodeTokenUnsafe,
  getTokenExpiry,
  getTokenTTL
};
