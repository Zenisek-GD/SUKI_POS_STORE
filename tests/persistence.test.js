import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createDatabase, migrate } from '../pos_backend/models/database.js';
import { seed } from '../pos_backend/models/seed.js';
import { createApp } from '../pos_backend/app.js';
test('store records and database-backed sessions survive a complete restart', async () => {
  const root = resolve('test-results');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(`${root}${sep}persistence-`);
  let db;
  try {
    const secret = 'stable-secret-used-only-in-persistence-test';
    db = await createDatabase({ url: '', directory });
    await migrate(db);
    await seed(db, { demo: false, email: 'persist@suki.store', password: 'PersistentOwner2026!' });
    let app = createApp(db, { secret });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'persist@suki.store', password: 'PersistentOwner2026!' })
      .expect(200);
    const cookie = login.headers['set-cookie'].map((c) => c.split(';')[0]).join('; '),
      csrf = login.body.csrf_token;
    const created = await request(app)
      .post('/api/products')
      .set('Cookie', cookie)
      .set('x-csrf-token', csrf)
      .send({
        name: 'Saved after restart',
        sku: 'PERSIST-1',
        price: 5000,
        cost_price: 2000,
        stock: 3,
      })
      .expect(201);
    await db.close();
    db = null;
    db = await createDatabase({ url: '', directory });
    await migrate(db);
    await seed(db, { demo: false, email: 'ignored@suki.store', password: 'UnusedPassword2026!' });
    app = createApp(db, { secret });
    const restored = await request(app).get('/api/bootstrap').set('Cookie', cookie).expect(200);
    assert.equal(restored.body.user.email, 'persist@suki.store');
    assert.equal(restored.body.products.length, 1);
    assert.equal(restored.body.products[0].id, created.body.id);
    assert.equal(restored.body.products[0].stock, 3);
  } finally {
    if (db) await db.close();
    const target = resolve(directory);
    assert.ok(
      target.startsWith(root + sep) && target !== root,
      'Cleanup must stay inside the test output directory',
    );
    await rm(target, { recursive: true, force: true });
  }
});
