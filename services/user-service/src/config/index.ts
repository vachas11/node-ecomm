/**
 * User Service Configuration - Environment + defaults
 */

interface ServerConfig {
  port: number;
  host: string;
  env: string;
}

interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string | undefined;
  pool: {
    min: number;
    max: number;
    idleTimeoutMillis: number;
  };
}

interface JwtConfig {
  secret: string | undefined;
  expiresIn: string;
  refreshSecret: string | undefined;
  refreshExpiresIn: string;
}

interface RedisConfig {
  host: string;
  port: number;
  password: string | undefined;
}

interface SecurityConfig {
  bcryptRounds: number;
  passwordMinLength: number;
  passwordRequireUppercase: boolean;
  passwordRequireLowercase: boolean;
  passwordRequireNumbers: boolean;
  passwordRequireSpecialChars: boolean;
  tokenBlacklistTTL: number;
}

interface RateLimitConfig {
  windowMs: number;
  max: number;
}

interface RateLimitsConfig {
  global: RateLimitConfig;
  login: RateLimitConfig;
  register: RateLimitConfig;
  passwordChange: RateLimitConfig;
  refresh: RateLimitConfig;
}

interface LoggingConfig {
  level: string;
  pretty: boolean;
}

interface Config {
  server: ServerConfig;
  database: DatabaseConfig;
  jwt: JwtConfig;
  redis: RedisConfig;
  security: SecurityConfig;
  rateLimits: RateLimitsConfig;
  logging: LoggingConfig;
}

const config: Config = {
  server: {
    port: parseInt(process.env.PORT || '3001', 10),
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development'
  },

  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'user_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    pool: {
      min: parseInt(process.env.DB_POOL_MIN || '5', 10),
      max: parseInt(process.env.DB_POOL_MAX || '20', 10),
      idleTimeoutMillis: 30000
    }
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined
  },

  security: {
    bcryptRounds: 10,
    passwordMinLength: 8,
    passwordRequireUppercase: true,
    passwordRequireLowercase: true,
    passwordRequireNumbers: true,
    passwordRequireSpecialChars: true,
    tokenBlacklistTTL: 900
  },

  rateLimits: {
    global: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
      max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10)
    },
    login: { windowMs: 900000, max: 5 },
    register: { windowMs: 3600000, max: 3 },
    passwordChange: { windowMs: 3600000, max: 5 },
    refresh: { windowMs: 900000, max: 10 }
  },

  logging: {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    pretty: process.env.NODE_ENV !== 'production'
  }
};

function validateConfig(): void {
  const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long');
  }

  if (process.env.JWT_REFRESH_SECRET && process.env.JWT_REFRESH_SECRET.length < 32) {
    throw new Error('JWT_REFRESH_SECRET must be at least 32 characters long');
  }
}

if (process.env.NODE_ENV !== 'test') {
  validateConfig();
}

export default config;
