import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { createDatabase, migrate, one } from '../pos_backend/models/database.js';
import { seed } from '../pos_backend/models/seed.js';
import { createApp } from '../pos_backend/app.js';
import { completeSale } from '../pos_backend/services/sales.js';
import { processReturn } from '../pos_backend/services/returns.js';

let db, app, agent, csrf, owner;
const send = (method, path, data) => agent[method](path).set('x-csrf-token', csrf).send(data);
before(async () => {
  db = await createDatabase({ memory: true });
  await migrate(db);
  await seed(db, {
    demo: false,
    email: 'returns@suki.store',
    password: 'ReturnTest2026!',
    name: 'Gerald',
  });
  app = createApp(db, { secret: 'isolated-returns-test-secret' });
  agent = request.agent(app);
  const response = await agent
    .post('/api/auth/login')
    .send({ email: 'returns@suki.store', password: 'ReturnTest2026!' })
    .expect(200);
  csrf = response.body.csrf_token;
  owner = response.body.user;
});
after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await db.close();
});

async function product(stock = 100, price = 101) {
  const response = await send('post', '/api/products', {
    name: 'Return test product',
    sku: randomUUID(),
    price,
    cost_price: 60,
    stock,
  }).expect(201);
  return response.body.id;
}
async function sale(productId, quantity = 3, at = new Date()) {
  return completeSale(
    db,
    owner,
    {
      items: [{ product_id: productId, quantity }],
      customer_id: null,
      discount_percent: 10,
      payment_method: 'Cash',
      amount_received: 10000000,
      idempotency_key: randomUUID(),
    },
    at,
  );
}
function body(sale, quantity = 1, condition = 'unused_unopened') {
  return {
    items: [{ sale_item_id: sale.items[0].id, quantity, condition }],
    reason: 'Customer changed their mind; seal intact',
    idempotency_key: randomUUID(),
  };
}

test('partial sellable and damaged returns preserve original sale and exact discounted cents', async () => {
  const pid = await product();
  const original = await sale(pid);
  assert.equal(original.total, 273); // 303 - rounded 10% discount 30.
  const first = (
    await send('post', `/api/sales/${original.id}/returns`, body(original)).expect(201)
  ).body;
  assert.equal(first.total, 91);
  assert.equal((await one(db, 'SELECT stock FROM products WHERE id=$1', [pid])).stock, 98);
  const damaged = (
    await send('post', `/api/sales/${original.id}/returns`, body(original, 1, 'damaged')).expect(
      201,
    )
  ).body;
  assert.equal(damaged.total, 91);
  assert.equal(damaged.cost_total, 0);
  const p = await one(db, 'SELECT stock,non_sellable_stock FROM products WHERE id=$1', [pid]);
  assert.deepEqual(p, { stock: 98, non_sellable_stock: 1 });
  const last = (await send('post', `/api/sales/${original.id}/returns`, body(original)).expect(201))
    .body;
  assert.equal(first.total + damaged.total + last.total, original.total);
  const retrieved = (await agent.get(`/api/sales/${original.id}`).expect(200)).body;
  assert.equal(retrieved.status, 'completed');
  assert.equal(retrieved.total, original.total);
  assert.equal(retrieved.items[0].returnable_quantity, 0);
  assert.equal(retrieved.items[0].refunded_amount, original.total);
  assert.equal(retrieved.return_policy.eligible, false);
  assert.equal(retrieved.returns.length, 3);
  await send('post', `/api/sales/${original.id}/returns`, body(original)).expect(422);
});

test('return window rejects expired purchases and permits exactly 24 hours', async () => {
  const pid = await product();
  const at = new Date(Date.now() - 25 * 3600000);
  const original = await sale(pid, 3, at);
  const response = await send('post', `/api/sales/${original.id}/returns`, body(original)).expect(
    422,
  );
  assert.match(response.body.error, /24-hour return window/);
  const accepted = await processReturn(
    db,
    owner,
    original.id,
    body(original),
    new Date(at.getTime() + 24 * 3600000),
  );
  assert.equal(accepted.total, 91);
  await assert.rejects(
    processReturn(
      db,
      owner,
      original.id,
      body(original),
      new Date(at.getTime() + 24 * 3600000 + 1),
    ),
    /24-hour/,
  );
});

test('invalid reason, unknown condition, excessive quantity and foreign item reject atomically', async () => {
  const pid = await product(),
    original = await sale(pid);
  await send('post', `/api/sales/${original.id}/returns`, {
    ...body(original),
    reason: ' ',
  }).expect(422);
  await send('post', `/api/sales/${original.id}/returns`, body(original, 1, 'opened_used')).expect(
    422,
  );
  await send('post', `/api/sales/${original.id}/returns`, body(original, 4)).expect(422);
  const invalid = body(original);
  invalid.items.push({ sale_item_id: randomUUID(), quantity: 1, condition: 'unused_unopened' });
  await send('post', `/api/sales/${original.id}/returns`, invalid).expect(422);
  assert.equal((await one(db, 'SELECT stock FROM products WHERE id=$1', [pid])).stock, 97);
  assert.equal(
    (
      await one(db, 'SELECT COUNT(*)::int AS count FROM sales_returns WHERE sale_id=$1', [
        original.id,
      ])
    ).count,
    0,
  );
  await send('post', '/api/inventory/adjust', {
    product_id: pid,
    quantity: 1,
    type: 'return',
    reason: 'Bypass return policy',
  }).expect(422);
});

test('concurrent duplicate returns create one refund and stock movement; changed payload is rejected', async () => {
  const pid = await product(),
    original = await sale(pid),
    payload = body(original);
  const results = await Promise.all([
    send('post', `/api/sales/${original.id}/returns`, payload),
    send('post', `/api/sales/${original.id}/returns`, payload),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [201, 201],
  );
  assert.equal(results[0].body.id, results[1].body.id);
  assert.equal((await one(db, 'SELECT stock FROM products WHERE id=$1', [pid])).stock, 98);
  assert.equal(
    (
      await one(
        db,
        "SELECT COUNT(*)::int AS count FROM inventory_transactions WHERE product_id=$1 AND type='return'",
        [pid],
      )
    ).count,
    1,
  );
  await send('post', `/api/sales/${original.id}/returns`, {
    ...payload,
    reason: 'A different refund',
  }).expect(409);
  // A successful retry remains idempotent even once the return window closes.
  const retried = await processReturn(
    db,
    owner,
    original.id,
    payload,
    new Date(Date.now() + 48 * 3600000),
  );
  assert.equal(retried.id, results[0].body.id);
  const competing = await Promise.all([
    send('post', `/api/sales/${original.id}/returns`, body(original, 2)),
    send('post', `/api/sales/${original.id}/returns`, body(original, 2)),
  ]);
  assert.deepEqual(competing.map((r) => r.status).sort(), [201, 422]);
});

test('original tax and discount allocations sum exactly over partial returns', async () => {
  const boot = (await agent.get('/api/bootstrap').expect(200)).body;
  for (const inclusive of [false, true]) {
    await send('put', '/api/settings', {
      ...boot.settings,
      tax_rate: 12,
      cashier_discount_limit: 10,
      tax_inclusive: inclusive,
    }).expect(200);
    const firstId = await product(10, 113),
      secondId = await product(10, 107);
    const original = await completeSale(db, owner, {
      items: [
        { product_id: firstId, quantity: 3 },
        { product_id: secondId, quantity: 2 },
      ],
      customer_id: null,
      discount_percent: 7,
      payment_method: 'Cash',
      amount_received: 10000,
      idempotency_key: randomUUID(),
    });
    let total = 0,
      tax = 0;
    for (const item of original.items)
      for (let q = 0; q < item.quantity; q++) {
        const refunded = (
          await send('post', `/api/sales/${original.id}/returns`, {
            reason: 'Unopened return',
            idempotency_key: randomUUID(),
            items: [{ sale_item_id: item.id, quantity: 1, condition: 'unused_unopened' }],
          }).expect(201)
        ).body;
        total += refunded.total;
        tax += refunded.tax;
      }
    assert.equal(total, original.total);
    assert.equal(tax, original.tax);
  }
  await send('put', '/api/settings', {
    ...boot.settings,
    tax_rate: 0,
    cashier_discount_limit: 10,
    tax_inclusive: false,
  }).expect(200);
});

test('owner return condition configuration enforces non-sellable damaged stock', async () => {
  const boot = (await agent.get('/api/bootstrap').expect(200)).body;
  const settings = {
    ...boot.settings,
    tax_rate: Number(boot.settings.tax_rate),
    cashier_discount_limit: 10,
  };
  await send('put', '/api/settings', {
    ...settings,
    return_conditions: settings.return_conditions.map((c) => ({ ...c, sellable: true })),
  }).expect(422);
  const disabled = settings.return_conditions.map((c) => ({
    ...c,
    enabled: c.code !== 'unused_unopened',
  }));
  await send('put', '/api/settings', { ...settings, return_conditions: disabled }).expect(200);
  const original = await sale(await product());
  await send('post', `/api/sales/${original.id}/returns`, body(original)).expect(422);
  await send('put', '/api/settings', settings).expect(200);
});

test('product ledger has stable balances, reference, timezone filters and pagination', async () => {
  const pid = await product();
  await sale(pid, 2);
  await sale(pid, 3);
  await send('post', '/api/inventory/adjust', {
    product_id: pid,
    quantity: 20,
    type: 'stock_in',
    reason: 'Market replenishment',
  }).expect(200);
  await send('post', '/api/inventory/adjust', {
    product_id: pid,
    quantity: 1,
    type: 'adjustment',
    reason: '',
  }).expect(422);
  const ledger = (await agent.get(`/api/inventory/products/${pid}/movements`).expect(200)).body;
  assert.deepEqual(ledger.rows.map((row) => row.balance_after).reverse(), [100, 98, 95, 115]);
  assert.ok(ledger.rows.every((row) => row.previous_quantity + row.quantity === row.new_quantity));
  assert.ok(
    ledger.rows
      .filter((row) => row.type === 'sale')
      .every((row) => row.reference.startsWith('SK-')),
  );
  const page = (
    await agent.get(`/api/inventory/products/${pid}/movements?page=2&page_size=2`).expect(200)
  ).body;
  assert.equal(page.total, 4);
  assert.equal(page.rows.length, 2);
  assert.equal(page.page, 2);
  const filtered = (
    await agent.get(`/api/inventory/products/${pid}/movements?type=sale`).expect(200)
  ).body;
  assert.equal(filtered.total, 2);
  const empty = (
    await agent
      .get(`/api/inventory/products/${pid}/movements?from=2000-01-01&to=2000-01-02`)
      .expect(200)
  ).body;
  assert.equal(empty.total, 0);
  await agent.get(`/api/inventory/products/${pid}/movements?page=0`).expect(422);
  await agent
    .get(`/api/inventory/products/${pid}/movements?from=2026-10-02&to=2026-10-01`)
    .expect(422);
  // Equal timestamps retain the sequence assigned by the database insertion order.
  await db.query('UPDATE inventory_transactions SET created_at=$1 WHERE product_id=$2', [
    new Date(),
    pid,
  ]);
  const tied = (await agent.get(`/api/inventory/products/${pid}/movements`).expect(200)).body;
  assert.deepEqual(tied.rows.map((row) => row.balance_after).reverse(), [100, 98, 95, 115]);
  assert.match(tied.product.product_code, /^P-[A-F0-9]{32}$/);
  // An earlier-arriving request may acquire the product lock later. Sequence,
  // rather than its earlier request timestamp, must retain the actual balance chain.
  await db.query(
    "UPDATE inventory_transactions SET created_at=created_at-interval '1 second' WHERE id=$1",
    [tied.rows[0].id],
  );
  const inverted = (await agent.get(`/api/inventory/products/${pid}/movements`).expect(200)).body;
  assert.deepEqual(inverted.rows.map((row) => row.balance_after).reverse(), [100, 98, 95, 115]);
});

test('cashiers can look up another operator receipt within their store but not another store', async () => {
  await send('post', '/api/users', {
    name: 'Counter B',
    email: 'counter-b@suki.store',
    password: 'CounterB2026!',
    role: 'cashier',
  }).expect(201);
  const counter = request.agent(app);
  const login = await counter
    .post('/api/auth/login')
    .send({ email: 'counter-b@suki.store', password: 'CounterB2026!' })
    .expect(200);
  const original = await sale(await product());
  const lookup = (await counter.get(`/api/sales/lookup?number=${original.number}`).expect(200))
    .body;
  assert.equal(lookup.id, original.id);
  assert.equal(lookup.cost_total, undefined);
  assert.equal(lookup.items[0].cost_price, undefined);
  await counter
    .post(`/api/sales/${original.id}/returns`)
    .set('x-csrf-token', login.body.csrf_token)
    .send(body(original))
    .expect(201);
  await counter.get('/api/sales/lookup?number=NO-SUCH-RECEIPT').expect(404);
  const foreignStore = randomUUID();
  await db.query('INSERT INTO stores(id,name) VALUES($1,$2)', [foreignStore, 'Other store']);
  await assert.rejects(
    processReturn(db, { ...owner, store_id: foreignStore }, original.id, body(original)),
    /Sale not found/,
  );
});

test('additive migration backfills legacy products and retains movement balances on rerun', async () => {
  const legacy = await createDatabase({ memory: true });
  try {
    const source = await readFile(
      new URL('../pos_backend/models/schema.sql', import.meta.url),
      'utf8',
    );
    await legacy.transaction((tx) => tx.exec(source.split('-- Additive migration:')[0]));
    const store = randomUUID(),
      user = randomUUID(),
      pid = randomUUID(),
      movement = randomUUID(),
      saleId = randomUUID();
    await legacy.query('INSERT INTO stores(id,name) VALUES($1,$2)', [store, 'Existing store']);
    await legacy.query('INSERT INTO store_settings(store_id) VALUES($1)', [store]);
    await legacy.query(
      "INSERT INTO users(id,store_id,name,email,password_hash,role) VALUES($1,$2,'Owner','legacy@example.test','unused','admin')",
      [user, store],
    );
    await legacy.query(
      "INSERT INTO products(id,store_id,name,sku,cost_price,price,stock) VALUES($1,$2,'Existing item','OLD',100,150,100)",
      [pid, store],
    );
    await legacy.query(
      "INSERT INTO inventory_transactions(id,store_id,product_id,user_id,previous_quantity,quantity,new_quantity,type,reason) VALUES($1,$2,$3,$4,0,102,102,'opening','Original stock')",
      [movement, store, pid, user],
    );
    await legacy.query(
      `INSERT INTO sales(id,store_id,number,user_id,subtotal,discount,tax,total,cost_total,amount_received,receipt_store,idempotency_key)
      VALUES($1,$2,'LEGACY-RECEIPT',$3,300,30,0,270,200,300,'{"tax_inclusive":false}',$4)`,
      [saleId, store, user, randomUUID()],
    );
    await legacy.query(
      `INSERT INTO sale_items(id,store_id,sale_id,product_id,name,sku,category_name,quantity,unit_price,cost_price,total)
      VALUES($1,$2,$3,$4,'Existing item','OLD','Uncategorized',2,150,100,300)`,
      [randomUUID(), store, saleId, pid],
    );
    await legacy.query(
      `INSERT INTO inventory_transactions(id,store_id,product_id,user_id,previous_quantity,quantity,new_quantity,type,reason,reference_id)
      VALUES($1,$2,$3,$4,102,-2,100,'sale','LEGACY-RECEIPT',$5)`,
      [randomUUID(), store, pid, user, saleId],
    );
    const originalSale = await one(legacy, 'SELECT * FROM sales WHERE id=$1', [saleId]);
    await migrate(legacy);
    const first = await one(legacy, 'SELECT * FROM inventory_transactions WHERE id=$1', [movement]);
    await migrate(legacy);
    const second = await one(legacy, 'SELECT * FROM inventory_transactions WHERE id=$1', [
      movement,
    ]);
    assert.deepEqual(second, first);
    const retained = await one(
      legacy,
      'SELECT stock,product_code,non_sellable_stock FROM products WHERE id=$1',
      [pid],
    );
    assert.equal(retained.stock, 100);
    assert.equal(retained.non_sellable_stock, 0);
    assert.ok(retained.product_code.startsWith('P-'));
    assert.deepEqual(await one(legacy, 'SELECT * FROM sales WHERE id=$1', [saleId]), originalSale);
    assert.deepEqual(
      (
        await legacy.query(
          'SELECT new_quantity FROM inventory_transactions WHERE product_id=$1 ORDER BY sequence',
          [pid],
        )
      ).rows.map((row) => row.new_quantity),
      [102, 100],
    );
    const policy = await one(
      legacy,
      'SELECT return_conditions FROM store_settings WHERE store_id=$1',
      [store],
    );
    assert.equal(
      policy.return_conditions.find((item) => item.code === 'unused_unopened').sellable,
      true,
    );
    assert.equal(policy.return_conditions.find((item) => item.code === 'damaged').sellable, false);
  } finally {
    await legacy.close();
  }
});
