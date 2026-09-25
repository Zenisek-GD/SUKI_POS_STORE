import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { createDatabase, migrate, one } from '../pos_backend/models/database.js';
import { seed } from '../pos_backend/models/seed.js';
import { createApp } from '../pos_backend/app.js';

test('production configuration normalizes the frontend origin and rejects invalid settings', () => {
  const check = (overrides = {}) =>
    spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import './pos_backend/config.js'; console.log(process.env.APP_ORIGIN)",
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://unused:unused@localhost/unused',
          SESSION_SECRET: 'deployment-test-secret-not-for-real-use',
          DEMO_MODE: 'false',
          APP_ORIGIN: 'https://suki-test.vercel.app/',
          ...overrides,
        },
      },
    );
  const valid = check();
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stdout.trim(), 'https://suki-test.vercel.app');
  for (const origin of [
    'http://suki-test.vercel.app',
    'https://suki-test.vercel.app/login',
    'https://suki-test.vercel.app?preview=1',
    'https://user:password@suki-test.vercel.app',
  ]) {
    const result = check({ APP_ORIGIN: origin });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /APP_ORIGIN must be your HTTPS frontend origin/);
  }
  for (const invalid of [{ DATABASE_URL: '' }, { SESSION_SECRET: '' }, { DEMO_MODE: 'true' }]) {
    const result = check(invalid);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Production requires/);
  }
});

test('HTTPS proxy login retains secure sessions, CSRF protection, and a fresh owner-only store', async () => {
  const db = await createDatabase({ memory: true });
  try {
    await migrate(db);
    const credentials = { email: 'owner@suki.store', password: 'ProductionTest2026!' };
    await seed(db, { ...credentials, demo: false, name: 'Gerald' });
    const origin = 'https://suki-test.vercel.app';
    const app = createApp(db, {
      production: true,
      origin,
      secret: 'stable-deployment-test-secret-not-for-real-use',
    });
    const info = await request(app).get('/api/auth/info').expect(200);
    assert.equal(info.body.demo, false);
    const login = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-Proto', 'https')
      .set('Origin', origin)
      .set('Sec-Fetch-Site', 'same-origin')
      .send(credentials)
      .expect(200);
    const setCookie = login.headers['set-cookie'][0];
    assert.match(setCookie, /; Secure/);
    assert.match(setCookie, /; HttpOnly/);
    assert.match(setCookie, /; SameSite=Strict/);
    assert.doesNotMatch(setCookie, /; Domain=/i);
    const cookie = setCookie.split(';')[0];
    const boot = await request(app)
      .get('/api/bootstrap')
      .set('X-Forwarded-Proto', 'https')
      .set('Cookie', cookie)
      .expect(200);
    assert.equal(boot.body.user.name, 'Gerald');
    assert.equal(boot.body.user.email, credentials.email);
    assert.equal(boot.body.users.length, 1);
    assert.equal(boot.body.products.length, 0);
    assert.equal(boot.headers['cache-control'], 'no-store');
    const write = () =>
      request(app)
        .post('/api/categories')
        .set('X-Forwarded-Proto', 'https')
        .set('Cookie', cookie)
        .set('Origin', origin);
    await write().send({ name: 'Missing CSRF' }).expect(403);
    await write()
      .set('x-csrf-token', login.body.csrf_token)
      .set('Origin', 'https://different-project.vercel.app')
      .send({ name: 'Untrusted origin' })
      .expect(403);
    await write()
      .set('x-csrf-token', login.body.csrf_token)
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ name: 'Cross-site request' })
      .expect(403);
    await write()
      .set('x-csrf-token', login.body.csrf_token)
      .set('Sec-Fetch-Site', 'same-origin')
      .send({ name: 'Saved through the frontend proxy' })
      .expect(201);
    // A later deploy must retain the existing owner's name and credentials.
    await seed(db, {
      demo: false,
      email: 'different@suki.store',
      password: 'UnusedPassword2026!',
      name: 'Other',
    });
    const owner = await one(db, 'SELECT name,email FROM users');
    assert.deepEqual(owner, { name: 'Gerald', email: credentials.email });
    await request(app)
      .post('/api/auth/logout')
      .set('X-Forwarded-Proto', 'https')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('x-csrf-token', login.body.csrf_token)
      .expect(200);
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);
  } finally {
    await db.close();
  }
});
