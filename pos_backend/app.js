/* Adapted from the XianFire-generated application. See LICENSE-XIANFIRE. */
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import hbs from 'hbs';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { token } from './utils.js';
import { DatabaseSessionStore } from './middleware/sessionStore.js';
import api from './routes/index.js';
export function createApp(
  db,
  {
    demo = false,
    production = false,
    origin = process.env.APP_ORIGIN || 'http://127.0.0.1:5173',
    secret = process.env.SESSION_SECRET || token(),
  } = {},
) {
  const app = express();
  app.disable('x-powered-by');
  if (production) app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          imgSrc: ["'self'", 'data:', 'https:', 'http:'],
          upgradeInsecureRequests: production ? [] : null,
        },
      },
      strictTransportSecurity: production ? undefined : false,
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(
    session({
      name: 'suki.sid',
      secret,
      store: new DatabaseSessionStore(db),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: production,
        sameSite: 'strict',
        maxAge: 12 * 60 * 60 * 1000,
      },
    }),
  );
  app.use(
    '/api',
    (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      const source = req.get('origin');
      const allowed = production
        ? [origin]
        : [
            origin,
            'http://localhost:5173',
            'http://127.0.0.1:5173',
            'http://localhost:3000',
            'http://127.0.0.1:3000',
          ];
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && source && !allowed.includes(source))
        return res.status(403).json({ error: 'Request origin is not allowed.' });
      if (req.get('sec-fetch-site') === 'cross-site')
        return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
      next();
    },
    api(db, { demo, production }),
  );
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  // Retain the generated .xian view engine; React handles the application screens.
  const views = fileURLToPath(new URL('./views', import.meta.url));
  app.engine('xian', hbs.__express);
  app.set('views', views);
  app.set('view engine', 'xian');
  for (const file of readdirSync(`${views}/partials`))
    if (file.endsWith('.xian'))
      hbs.registerPartial(
        file.replace('.xian', ''),
        readFileSync(`${views}/partials/${file}`, 'utf8'),
      );
  app.get('/xianfire', (_req, res) => res.render('home', { title: 'XianFire · Suki POS' }));
  const frontend = fileURLToPath(new URL('../pos_frontend/dist', import.meta.url));
  if (existsSync(frontend)) {
    app.use(express.static(frontend));
    app.get('*', (_req, res) => res.sendFile(`${frontend}/index.html`));
  }
  app.use((error, _req, res, _next) => {
    if (error instanceof ZodError)
      return res
        .status(422)
        .json({
          error: error.issues.map((i) => `${i.path.join('.') || 'Input'}: ${i.message}`).join('; '),
        });
    if (error.code === '23505')
      return res
        .status(409)
        .json({ error: 'This email, SKU, barcode, or category name already exists.' });
    if (error.code === '23503')
      return res.status(422).json({ error: 'One of the selected records is not available.' });
    if (error.type === 'entity.parse.failed')
      return res.status(400).json({ error: 'Invalid JSON request.' });
    if (!error.status) console.error(error);
    res
      .status(error.status || 500)
      .json({ error: error.status ? error.message : 'Something went wrong. Please try again.' });
  });
  return app;
}
