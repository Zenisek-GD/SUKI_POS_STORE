import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { wrap } from '../utils.js';
import { authenticate, allow } from '../middleware/auth.js';
import { authController } from '../controllers/authController.js';
import { storeController } from '../controllers/storeController.js';
import { reportController } from '../controllers/reportController.js';
import { schemas, parseId } from '../validation.js';
import { completeSale, getSale, cancelSale } from '../services/sales.js';
import { adjustStock } from '../services/inventory.js';
import { createPurchase, receivePurchase } from '../services/purchases.js';
export default function api(db, options) {
  const r = Router(),
    auth = authController(db, options),
    store = storeController(db);
  const selling = allow('admin', 'manager', 'cashier'),
    managing = allow('admin', 'manager'),
    stocking = allow('admin', 'manager', 'inventory');
  r.get('/health', (_req, res) => res.json({ status: 'ok', framework: 'XianFire' }));
  r.get('/auth/info', auth.info);
  r.post(
    '/auth/login',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 30,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Too many sign-in attempts. Please try again in 15 minutes.' },
    }),
    wrap(auth.login),
  );
  r.use(authenticate(db));
  r.get('/auth/me', auth.me);
  r.post('/auth/logout', wrap(auth.logout));
  r.post('/auth/password', wrap(auth.password));
  r.get('/bootstrap', wrap(store.bootstrap));
  r.get('/sales', selling, wrap(store.sales));
  r.get(
    '/sales/:id',
    selling,
    wrap(async (req, res) => res.json(await getSale(db, req.user, parseId(req.params.id)))),
  );
  r.post(
    '/sales',
    selling,
    wrap(async (req, res) =>
      res.status(201).json(await completeSale(db, req.user, schemas.sale.parse(req.body))),
    ),
  );
  r.post(
    '/sales/:id/cancel',
    managing,
    wrap(async (req, res) =>
      res.json(
        await cancelSale(
          db,
          req.user,
          parseId(req.params.id),
          schemas.cancel.parse(req.body).reason,
        ),
      ),
    ),
  );
  r.get('/inventory/movements', stocking, wrap(store.movements));
  r.post(
    '/inventory/adjust',
    stocking,
    wrap(async (req, res) =>
      res.json(await adjustStock(db, req.user, schemas.movement.parse(req.body))),
    ),
  );
  r.post(
    '/purchases',
    stocking,
    wrap(async (req, res) =>
      res.status(201).json(await createPurchase(db, req.user, schemas.purchase.parse(req.body))),
    ),
  );
  r.get('/purchases/:id/items', stocking, wrap(store.purchaseItems));
  r.post(
    '/purchases/:id/receive',
    stocking,
    wrap(async (req, res) => res.json(await receivePurchase(db, req.user, parseId(req.params.id)))),
  );
  r.patch('/purchases/:id/payment', managing, wrap(store.purchasePayment));
  r.get('/reports', managing, wrap(reportController(db)));
  r.get('/audit', allow('admin'), wrap(store.audit));
  r.put('/settings', allow('admin'), wrap(store.settings));
  r.delete('/products/:id', managing, wrap(store.archive));
  r.post('/:entity', wrap(store.save));
  r.put('/:entity/:id', wrap(store.save));
  return r;
}
