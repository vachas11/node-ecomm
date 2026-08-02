/**
 * Service Registry
 *
 * Maps service names to their backend URLs.
 * In production, this could be replaced with service discovery
 * (Consul, Eureka, Kubernetes DNS, etc.)
 */

const services = {
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

// Get service configuration by name
const getService = (serviceName) => {
  const service = services[serviceName];
  if (!service) {
    throw new Error(`Service '${serviceName}' not found in registry`);
  }
  return service;
};

// Get all registered services
const getAllServices = () => {
  return Object.keys(services).map(key => ({
    name: key,
    ...services[key]
  }));
};

// Check if service exists
const hasService = (serviceName) => {
  return serviceName in services;
};

module.exports = {
  services,
  getService,
  getAllServices,
  hasService
};
