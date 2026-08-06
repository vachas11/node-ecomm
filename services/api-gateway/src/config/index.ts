interface ServiceConfig {
  url: string;
  timeout: number;
}

interface BulkheadConfig {
  maxConcurrent: number;
  maxQueueDepth: number;
}

interface Config {
  server: {
    port: number;
    host: string;
    env: string;
  };
  services: {
    user: ServiceConfig;
    product: ServiceConfig;
    order: ServiceConfig;
  };
  jwt: {
    secret: string | undefined;
  };
  redis: {
    host: string;
    port: number;
    password: string | undefined;
  };
  resilience: {
    circuitBreaker: {
      failureThreshold: number;
      successThreshold: number;
      timeout: number;
      resetTimeout: number;
      volumeThreshold: number;
    };
    retry: {
      maxRetries: number;
      initialDelay: number;
      maxDelay: number;
      backoffFactor: number;
      jitter: boolean;
    };
    bulkhead: {
      user: BulkheadConfig;
      product: BulkheadConfig;
      order: BulkheadConfig;
      [key: string]: BulkheadConfig;
    };
    timeout: {
      user: number;
      product: number;
      order: number;
      [key: string]: number;
    };
  };
  rateLimits: {
    global: { windowMs: number; max: number };
    auth: { windowMs: number; max: number };
  };
  logging: {
    level: string;
    pretty: boolean;
  };
}

const config: Config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development'
  },

  services: {
    user: { url: process.env.USER_SERVICE_URL || 'http://localhost:3001', timeout: 5000 },
    product: { url: process.env.PRODUCT_SERVICE_URL || 'http://localhost:3002', timeout: 3000 },
    order: { url: process.env.ORDER_SERVICE_URL || 'http://localhost:3003', timeout: 10000 }
  },

  jwt: { secret: process.env.JWT_SECRET },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined
  },

  resilience: {
    circuitBreaker: {
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 5000,
      resetTimeout: 30000,
      volumeThreshold: 10
    },
    retry: {
      maxRetries: 3,
      initialDelay: 100,
      maxDelay: 2000,
      backoffFactor: 2,
      jitter: true
    },
    bulkhead: {
      user: { maxConcurrent: 50, maxQueueDepth: 100 },
      product: { maxConcurrent: 100, maxQueueDepth: 200 },
      order: { maxConcurrent: 30, maxQueueDepth: 50 }
    },
    timeout: { user: 5000, product: 3000, order: 10000 }
  },

  rateLimits: {
    global: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
      max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10)
    },
    auth: { windowMs: 900000, max: 20 }
  },

  logging: {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    pretty: process.env.NODE_ENV !== 'production'
  }
};

function validateConfig(): void {
  if (!process.env.JWT_SECRET) {
    throw new Error('Missing required environment variable: JWT_SECRET');
  }
  if (process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long');
  }
}

if (process.env.NODE_ENV !== 'test') {
  validateConfig();
}

export default config;
