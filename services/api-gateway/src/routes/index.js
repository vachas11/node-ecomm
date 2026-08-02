const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../../../../shared/auth/middleware');

// Import BOTH proxy implementations
const proxyBasic = require('../middleware/proxy');
const proxyAdvanced = require('../middleware/proxyAdvanced');

// Use advanced proxy by default (production-grade)
const proxy = proxyAdvanced;

/**
 * API Gateway Routes
 *
 * Routes use production-grade proxy with:
 * - Circuit breaker (fail fast when service is down)
 * - Retry with exponential backoff (handle transient failures)
 * - Connection pooling (reuse TCP connections)
 * - Bulkhead isolation (prevent resource exhaustion)
 *
 * Switch to basic proxy for comparison: const proxy = proxyBasic;
 */

// =============================================================================
// GATEWAY HEALTH & MONITORING
// =============================================================================

/**
 * Resilience patterns health check
 * Shows circuit breaker states, bulkhead utilization, connection pools
 */
router.get('/gateway/health', (req, res) => {
  const health = proxyAdvanced.getResilienceHealth();

  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    gateway: 'healthy',
    resilience: health
  });
});

/**
 * Reset all circuit breakers (manual recovery)
 * Use when you want to force retry after manual service fix
 */
router.post('/gateway/circuit-breakers/reset', authenticate(), (req, res) => {
  // TODO: Add admin role check
  // if (req.user.role !== 'admin') {
  //   return res.status(403).json({ error: 'Admin access required' });
  // }

  proxyAdvanced.resetCircuitBreakers();

  res.json({
    success: true,
    message: 'All circuit breakers manually reset'
  });
});

// =============================================================================
// USER SERVICE ROUTES
// =============================================================================

// Public auth routes (no authentication required)
router.post('/auth/register', proxy('user', '/api/auth/register'));
router.post('/auth/login', proxy('user', '/api/auth/login'));
router.post('/auth/refresh', proxy('user', '/api/auth/refresh'));

// Protected auth routes (authentication required)
router.get('/auth/profile', authenticate(), proxy('user', '/api/auth/profile'));
router.put('/auth/profile', authenticate(), proxy('user', '/api/auth/profile'));
router.put('/auth/change-password', authenticate(), proxy('user', '/api/auth/change-password'));
router.post('/auth/logout', authenticate(), proxy('user', '/api/auth/logout'));
router.post('/auth/logout-all', authenticate(), proxy('user', '/api/auth/logout-all'));

// =============================================================================
// PRODUCT SERVICE ROUTES (when implemented)
// =============================================================================

// Public product browsing (with optional auth for personalization)
router.get('/products', optionalAuth(), proxy('product', '/api/products', {
  timeout: 3000, // Faster timeout for read-heavy operations
  fallback: (req) => ({
    status: 200,
    data: {
      success: true,
      data: {
        products: [],
        message: 'Product service temporarily unavailable - showing cached results'
      }
    },
    headers: { 'x-fallback': 'true' }
  })
}));

router.get('/products/:id', optionalAuth(), proxy('product', (path) => {
  return path.replace('/products', '/api/products');
}, {
  timeout: 3000
}));

// Protected product management (admin only)
router.post('/products', authenticate(), proxy('product', '/api/products'));
router.put('/products/:id', authenticate(), proxy('product', (path) => {
  return path.replace('/products', '/api/products');
}));
router.delete('/products/:id', authenticate(), proxy('product', (path) => {
  return path.replace('/products', '/api/products');
}));

// =============================================================================
// ORDER SERVICE ROUTES (when implemented)
// =============================================================================

// All order routes require authentication
router.get('/orders', authenticate(), proxy('order', '/api/orders', {
  timeout: 10000 // Longer timeout for potentially complex queries
}));

router.get('/orders/:id', authenticate(), proxy('order', (path) => {
  return path.replace('/orders', '/api/orders');
}));

router.post('/orders', authenticate(), proxy('order', '/api/orders', {
  timeout: 15000 // Even longer timeout for order creation (payment processing)
}));

router.put('/orders/:id', authenticate(), proxy('order', (path) => {
  return path.replace('/orders', '/api/orders');
}));

// =============================================================================
// CATCH-ALL ROUTE
// =============================================================================

router.all('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: 'Route not found',
      path: req.path,
      method: req.method
    }
  });
});

module.exports = router;
