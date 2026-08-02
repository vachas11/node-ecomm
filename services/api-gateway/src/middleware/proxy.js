const axios = require('axios');
const { getService } = require('../config/services');
const logger = require('../../../../shared/logger');

/**
 * HTTP Proxy Middleware
 *
 * Forwards requests to backend microservices and returns their responses.
 * Attaches user context from JWT to headers for downstream services.
 */

const proxy = (serviceName, pathRewrite) => {
  return async (req, res, next) => {
    try {
      // Get service configuration
      const service = getService(serviceName);

      // Build target URL
      let targetPath = req.path;
      if (pathRewrite) {
        // Allow path rewriting (e.g., /api/auth/login -> /auth/login)
        if (typeof pathRewrite === 'function') {
          targetPath = pathRewrite(req.path);
        } else if (typeof pathRewrite === 'string') {
          targetPath = pathRewrite;
        }
      }

      const targetUrl = `${service.url}${targetPath}`;

      logger.debug('Proxying request', {
        method: req.method,
        originalPath: req.path,
        targetUrl,
        service: serviceName
      });

      // Prepare headers
      const headers = {
        ...req.headers,
        'x-forwarded-for': req.ip,
        'x-forwarded-host': req.hostname,
        'x-forwarded-proto': req.protocol,
        'x-gateway': 'true',
        'x-request-id': req.id || req.headers['x-request-id']
      };

      // Attach user context if authenticated
      if (req.user) {
        headers['x-user-id'] = req.user.userId;
        headers['x-user-email'] = req.user.email;
        headers['x-user-role'] = req.user.role;
      }

      // Remove host header to avoid conflicts
      delete headers.host;

      // Make request to backend service
      const response = await axios({
        method: req.method,
        url: targetUrl,
        data: req.body,
        params: req.query,
        headers,
        timeout: 30000, // 30 second timeout
        validateStatus: () => true // Accept all status codes
      });

      // Forward response headers (except some)
      const excludeHeaders = ['transfer-encoding', 'connection', 'keep-alive'];
      Object.keys(response.headers).forEach(header => {
        if (!excludeHeaders.includes(header.toLowerCase())) {
          res.set(header, response.headers[header]);
        }
      });

      // Return response
      res.status(response.status).json(response.data);

    } catch (error) {
      // Handle network errors
      if (error.code === 'ECONNREFUSED') {
        logger.error('Service unavailable', {
          service: serviceName,
          error: 'Connection refused'
        });
        return res.status(503).json({
          success: false,
          error: {
            message: 'Service temporarily unavailable',
            statusCode: 503,
            service: serviceName
          }
        });
      }

      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        logger.error('Service timeout', {
          service: serviceName,
          error: error.message
        });
        return res.status(504).json({
          success: false,
          error: {
            message: 'Service request timeout',
            statusCode: 504,
            service: serviceName
          }
        });
      }

      // Log unexpected errors
      logger.error('Gateway proxy error', {
        service: serviceName,
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        success: false,
        error: {
          message: 'Gateway error',
          statusCode: 500
        }
      });
    }
  };
};

module.exports = proxy;
