export interface ServiceConfig {
  url: string;
  name: string;
  healthCheck: string;
}

interface ServiceRegistry {
  [key: string]: ServiceConfig;
}

const services: ServiceRegistry = {
  user: {
    url: process.env.USER_SERVICE_URL || 'http://localhost:3001',
    name: 'user-service',
    healthCheck: '/health'
  },
  product: {
    url: process.env.PRODUCT_SERVICE_URL || 'http://localhost:3002',
    name: 'product-service',
    healthCheck: '/health'
  },
  order: {
    url: process.env.ORDER_SERVICE_URL || 'http://localhost:3003',
    name: 'order-service',
    healthCheck: '/health'
  }
};

export const getService = (serviceName: string): ServiceConfig => {
  const service = services[serviceName];
  if (!service) {
    throw new Error(`Service '${serviceName}' not found in registry`);
  }
  return service;
};

export const getAllServices = (): ServiceConfig[] => {
  return Object.values(services);
};

export const hasService = (serviceName: string): boolean => {
  return serviceName in services;
};

export { services };
