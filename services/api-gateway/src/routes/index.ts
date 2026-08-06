import { Router, Request, Response } from 'express';
import { authenticate, optionalAuth } from '../../../../shared/auth/middleware';
import proxyAdvanced, { getResilienceHealth, resetCircuitBreakers } from '../middleware/proxyAdvanced';

const router = Router();
const proxy = proxyAdvanced;

router.get('/gateway/health', (_req: Request, res: Response) => {
  const health = getResilienceHealth();
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    gateway: 'healthy',
    resilience: health
  });
});

router.post('/gateway/circuit-breakers/reset', authenticate(), (_req: Request, res: Response) => {
  resetCircuitBreakers();
  res.json({ success: true, message: 'All circuit breakers manually reset' });
});

router.get('/users/profile', authenticate(), proxy('user', '/api/auth/profile'));
router.put('/users/profile', authenticate(), proxy('user', '/api/auth/profile'));
router.put('/users/change-password', authenticate(), proxy('user', '/api/auth/change-password'));

router.get('/products', optionalAuth(), proxy('product', '/api/products', {
  timeout: 3000,
  fallback: (_req: Request) => ({
    status: 200,
    data: { success: true, data: { products: [], message: 'Product service temporarily unavailable - showing cached results' } },
    headers: { 'x-fallback': 'true' }
  })
}));

router.get('/products/:id', optionalAuth(), proxy('product', (path: string) => path.replace('/products', '/api/products'), { timeout: 3000 }));
router.post('/products', authenticate(), proxy('product', '/api/products'));
router.put('/products/:id', authenticate(), proxy('product', (path: string) => path.replace('/products', '/api/products')));
router.delete('/products/:id', authenticate(), proxy('product', (path: string) => path.replace('/products', '/api/products')));

router.get('/orders', authenticate(), proxy('order', '/api/orders', { timeout: 10000 }));
router.get('/orders/:id', authenticate(), proxy('order', (path: string) => path.replace('/orders', '/api/orders')));
router.post('/orders', authenticate(), proxy('order', '/api/orders', { timeout: 15000 }));
router.put('/orders/:id', authenticate(), proxy('order', (path: string) => path.replace('/orders', '/api/orders')));

router.all('*', (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: { message: 'Route not found', path: req.path, method: req.method }
  });
});

export default router;
