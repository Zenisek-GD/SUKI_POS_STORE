import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createDatabase, migrate, one } from '../pos_backend/models/database.js';
import { seed, DEMO_ACCOUNTS } from '../pos_backend/models/seed.js';
import { createApp } from '../pos_backend/app.js';
let db, app, admin, cashier, inventory, owner, boot, product;
async function login(role) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send(DEMO_ACCOUNTS[role]).expect(200);
  return { agent, csrf: res.body.csrf_token, user: res.body.user };
}
const send = (client, method, path, body) =>
  client.agent[method](path).set('x-csrf-token', client.csrf).send(body);
before(async () => {
  db = await createDatabase({ memory: true });
  await migrate(db);
  await seed(db, { demo: true });
  app = createApp(db, { demo: true, secret: 'test-session-secret-not-for-production' });
  admin = await login('admin');
  cashier = await login('cashier');
  inventory = await login('inventory');
  owner = admin.user;
  boot = (await admin.agent.get('/api/bootstrap').expect(200)).body;
});
after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await db.close();
});
test('authentication, CSRF, and server-side role boundaries', async () => {
  await request(app).get('/api/bootstrap').expect(401);
  await request(app)
    .post('/api/auth/login')
    .send({ email: DEMO_ACCOUNTS.admin.email, password: 'incorrect' })
    .expect(401);
  await admin.agent.post('/api/categories').send({ name: 'No CSRF' }).expect(403);
  await admin.agent
    .post('/api/categories')
    .set('Origin', 'https://attacker.example')
    .set('x-csrf-token', admin.csrf)
    .send({ name: 'Bad origin' })
    .expect(403);
  await cashier.agent.get('/api/reports?from=2026-01-01&to=2026-01-01').expect(403);
  await send(cashier, 'post', '/api/products', { name: 'Forbidden' }).expect(403);
  await inventory.agent.get('/api/sales').expect(403);
  const data = (await cashier.agent.get('/api/bootstrap').expect(200)).body;
  assert.equal(data.users, undefined);
  assert.equal(data.expenses, undefined);
  assert.equal(data.products[0].cost_price, undefined);
  const sales = (await cashier.agent.get('/api/sales').expect(200)).body;
  assert.ok(sales.every((s) => s.user_id === cashier.user.id));
});
test('create product and opening stock ledger, reject duplicate SKU', async () => {
  const body = {
    name: 'Integration test product',
    sku: 'TEST-001',
    category_id: boot.categories[0].id,
    supplier_id: boot.suppliers[0].id,
    price: 12345,
    cost_price: 8000,
    stock: 5,
    min_stock: 2,
    unit: 'pcs',
  };
  const res = await send(admin, 'post', '/api/products', body).expect(201);
  product = { ...body, id: res.body.id };
  await send(admin, 'post', '/api/products', body).expect(409);
  const movement = await one(db, 'SELECT * FROM inventory_transactions WHERE product_id=$1', [
    product.id,
  ]);
  assert.equal(movement.previous_quantity, 0);
  assert.equal(movement.new_quantity, 5);
});
test('checkout ignores client prices, rejects oversell and underpayment without side effects', async () => {
  const base = {
    items: [{ product_id: product.id, quantity: 1, unit_price: 1 }],
    payment_method: 'Cash',
    amount_received: 100,
    idempotency_key: randomUUID(),
  };
  await send(cashier, 'post', '/api/sales', base).expect(422);
  await send(cashier, 'post', '/api/sales', {
    ...base,
    items: [{ product_id: product.id, quantity: 6 }],
    amount_received: 100000,
    idempotency_key: randomUUID(),
  }).expect(409);
  await send(cashier, 'post', '/api/sales', {
    ...base,
    amount_received: 20000,
    discount_percent: 50,
    idempotency_key: randomUUID(),
  }).expect(403);
  await send(cashier, 'post', '/api/sales', {
    ...base,
    payment_method: 'Unknown',
    amount_received: 20000,
    idempotency_key: randomUUID(),
  }).expect(422);
  assert.equal((await one(db, 'SELECT stock FROM products WHERE id=$1', [product.id])).stock, 5);
});
test('concurrent retried checkout creates one sale; cancellation restores stock exactly once', async () => {
  const key = randomUUID(),
    body = {
      items: [{ product_id: product.id, quantity: 2 }],
      payment_method: 'Cash',
      amount_received: 30000,
      customer_id: boot.customers[0].id,
      idempotency_key: key,
    };
  const [a, b] = await Promise.all([
    send(cashier, 'post', '/api/sales', body),
    send(cashier, 'post', '/api/sales', body),
  ]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(a.body.id, b.body.id);
  assert.equal(a.body.subtotal, 24690);
  assert.equal(a.body.change, 5310);
  assert.equal(a.body.cost_total, undefined);
  assert.equal((await one(db, 'SELECT stock FROM products WHERE id=$1', [product.id])).stock, 3);
  assert.equal(
    Number((await one(db, 'SELECT COUNT(*) AS n FROM sales WHERE idempotency_key=$1', [key])).n),
    1,
  );
  await send(cashier, 'post', `/api/sales/${a.body.id}/cancel`, { reason: 'Cannot cancel' }).expect(
    403,
  );
  await send(admin, 'post', `/api/sales/${a.body.id}/cancel`, {
    reason: 'Customer returned all items',
  }).expect(200);
  await send(admin, 'post', `/api/sales/${a.body.id}/cancel`, {
    reason: 'Repeated request',
  }).expect(409);
  assert.equal((await one(db, 'SELECT stock FROM products WHERE id=$1', [product.id])).stock, 5);
});
test('two cashiers competing for the last unit cannot oversell', async () => {
  const last = await send(admin, 'post', '/api/products', {
    name: 'Last item',
    sku: 'LAST-ONE',
    price: 100,
    cost_price: 50,
    stock: 1,
  }).expect(201);
  const body = {
    items: [{ product_id: last.body.id, quantity: 1 }],
    payment_method: 'Cash',
    amount_received: 100,
  };
  const replies = await Promise.all([
    send(admin, 'post', '/api/sales', { ...body, idempotency_key: randomUUID() }),
    send(cashier, 'post', '/api/sales', { ...body, idempotency_key: randomUUID() }),
  ]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await one(db, 'SELECT stock FROM products WHERE id=$1', [last.body.id])).stock, 0);
});
test('purchase receiving and negative adjustments preserve a consistent stock ledger', async () => {
  const res = await send(inventory, 'post', '/api/purchases', {
    supplier_id: boot.suppliers[0].id,
    purchase_date: '2026-09-25',
    payment_status: 'unpaid',
    notes: 'Test',
    items: [{ product_id: product.id, quantity: 4, cost_price: 7500 }],
  }).expect(201);
  await send(inventory, 'post', `/api/purchases/${res.body.id}/receive`, {}).expect(200);
  await send(inventory, 'post', `/api/purchases/${res.body.id}/receive`, {}).expect(409);
  assert.equal((await one(db, 'SELECT stock FROM products WHERE id=$1', [product.id])).stock, 9);
  await send(inventory, 'post', '/api/inventory/adjust', {
    product_id: product.id,
    type: 'damaged',
    quantity: 2,
    reason: 'Damaged packaging',
  }).expect(200);
  await send(inventory, 'post', '/api/inventory/adjust', {
    product_id: product.id,
    type: 'stock_out',
    quantity: 99,
    reason: 'Excess quantity',
  }).expect(409);
  const ledger = (
    await db.query('SELECT * FROM inventory_transactions WHERE product_id=$1 ORDER BY created_at', [
      product.id,
    ])
  ).rows;
  assert.ok(ledger.every((m) => m.previous_quantity + m.quantity === m.new_quantity));
  assert.equal(ledger.at(-1).new_quantity, 7);
});
test('multi-store references and reads are isolated', async () => {
  const otherStore = randomUUID(),
    otherCategory = randomUUID();
  await db.query('INSERT INTO stores(id,name) VALUES($1,$2)', [otherStore, 'Other store']);
  await db.query('INSERT INTO categories(id,store_id,name) VALUES($1,$2,$3)', [
    otherCategory,
    otherStore,
    'Foreign category',
  ]);
  await send(admin, 'post', '/api/products', {
    name: 'Cross-store',
    sku: 'CROSS',
    price: 100,
    cost_price: 10,
    category_id: otherCategory,
  }).expect(422);
  const foreignSale = randomUUID();
  await admin.agent.get(`/api/sales/${foreignSale}`).expect(404);
  const bootstrap = (await admin.agent.get('/api/bootstrap').expect(200)).body;
  assert.ok(bootstrap.categories.every((c) => c.store_id === owner.store_id));
});
test('tax, discount, digital payments, receipts, and reports agree', async () => {
  const settings = {
    ...boot.settings,
    tax_rate: 12,
    tax_inclusive: false,
    cashier_discount_limit: Number(boot.settings.cashier_discount_limit),
  };
  await send(admin, 'put', '/api/settings', settings).expect(200);
  const body = {
    items: [{ product_id: product.id, quantity: 1 }],
    payment_method: 'GCash',
    discount_percent: 5,
    amount_received: 13135,
    idempotency_key: randomUUID(),
  };
  // 12345 - round(617.25) = 11728; tax round(1407.36) = 1407; total 13135.
  const sale = (await send(admin, 'post', '/api/sales', body).expect(201)).body;
  assert.equal(sale.discount, 617);
  assert.equal(sale.tax, 1407);
  assert.equal(sale.total, 13135);
  assert.equal(sale.receipt_store.name, boot.settings.name);
  await send(admin, 'post', '/api/sales', {
    ...body,
    amount_received: 14000,
    idempotency_key: randomUUID(),
  }).expect(422);
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const report = (await admin.agent.get(`/api/reports?from=${date}&to=${date}`).expect(200)).body;
  assert.equal(
    report.summary.sales,
    report.payments.reduce((sum, p) => sum + Number(p.total), 0),
  );
  assert.equal(
    report.summary.profit,
    report.summary.sales - report.summary.tax - report.summary.cost - report.summary.expenses,
  );
  assert.equal(
    report.transactions.reduce((sum, s) => sum + s.total, 0),
    report.summary.sales,
  );
  await send(admin, 'put', '/api/settings', { ...settings, currency: 'USD' }).expect(422);
  await admin.agent.get('/api/reports?from=2026-09-30&to=2026-09-01').expect(422);
});
test('disabled users lose sessions and password changes invalidate other sessions', async () => {
  const staff = await send(admin, 'post', '/api/users', {
    name: 'Temporary cashier',
    email: 'temporary@suki.store',
    password: 'Temporary2026!',
    role: 'cashier',
    active: true,
  }).expect(201);
  const agent = request.agent(app);
  await agent
    .post('/api/auth/login')
    .send({ email: 'temporary@suki.store', password: 'Temporary2026!' })
    .expect(200);
  await send(admin, 'put', `/api/users/${staff.body.id}`, {
    name: 'Temporary cashier',
    email: 'temporary@suki.store',
    role: 'cashier',
    active: false,
  }).expect(200);
  await agent.get('/api/bootstrap').expect(401);
  await send(admin, 'put', `/api/users/${owner.id}`, {
    name: owner.name,
    email: owner.email,
    role: 'cashier',
    active: true,
  }).expect(422);
  const second = await login('cashier');
  await send(cashier, 'post', '/api/auth/password', {
    current_password: DEMO_ACCOUNTS.cashier.password,
    password: 'NewCashierPass2026!',
  }).expect(200);
  await second.agent.get('/api/bootstrap').expect(401);
  await cashier.agent.get('/api/bootstrap').expect(200);
});
