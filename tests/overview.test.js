import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createDatabase, migrate } from '../pos_backend/models/database.js';
import { salesOverview, percentageChange } from '../pos_backend/services/salesOverview.js';
import { reportController } from '../pos_backend/controllers/reportController.js';
import { createApp } from '../pos_backend/app.js';
import { hashPassword } from '../pos_backend/utils.js';
import { allocatePaidAmounts } from '../pos_backend/services/returns.js';

let db;
before(async () => {
  db = await createDatabase({ memory: true });
  await migrate(db);
});
after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  await db.close();
});

async function fixture(start = '2021-01-01T00:00:00+08:00', timezone = 'Asia/Manila') {
  const store = randomUUID(),
    user = randomUUID(),
    product = randomUUID();
  await db.query('INSERT INTO stores(id,name,created_at) VALUES($1,$2,$3)', [
    store,
    'Overview test',
    start,
  ]);
  await db.query('INSERT INTO store_settings(store_id,timezone) VALUES($1,$2)', [store, timezone]);
  await db.query(
    'INSERT INTO users(id,store_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5,$6)',
    [user, store, 'Reporting owner', `${user}@suki.store`, 'unused', 'admin'],
  );
  await db.query(
    'INSERT INTO products(id,store_id,name,sku,cost_price,price) VALUES($1,$2,$3,$4,0,100)',
    [product, store, 'Reporting product', 'REPORT'],
  );
  return { store, user, product };
}
async function sale(f, at, total, options = {}) {
  const id = randomUUID(),
    item = randomUUID(),
    subtotal = options.subtotal ?? total,
    tax = options.tax ?? 0,
    discount = options.discount ?? 0,
    cost = options.cost ?? 0;
  await db.query(
    `INSERT INTO sales(id,store_id,number,user_id,subtotal,discount,tax,total,cost_total,amount_received,receipt_store,idempotency_key,created_at,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,'{}',$10,$11,$12)`,
    [
      id,
      f.store,
      `S-${id}`,
      f.user,
      subtotal,
      discount,
      tax,
      total,
      cost,
      randomUUID(),
      at,
      options.status ?? 'completed',
    ],
  );
  await db.query(
    `INSERT INTO sale_items(id,store_id,sale_id,product_id,name,sku,category_name,quantity,unit_price,cost_price,total)
    VALUES($1,$2,$3,$4,'Reporting product','REPORT','Test',1,$5,$6,$5)`,
    [item, f.store, id, f.product, subtotal, cost],
  );
  await db.query(
    `INSERT INTO payments(id,store_id,sale_id,method,amount,created_at) VALUES($1,$2,$3,'Cash',$4,$5)`,
    [randomUUID(), f.store, id, total, at],
  );
  return { id, item };
}
async function refund(f, original, at, total, { tax = 0, cost = 0, sellable = true } = {}) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO sales_returns(id,store_id,sale_id,number,user_id,reason,total,tax,cost_total,idempotency_key,request_hash,created_at)
    VALUES($1,$2,$3,$4,$5,'Test refund',$6,$7,$8,$9,'test',$10)`,
    [id, f.store, original.id, `R-${id}`, f.user, total, tax, cost, randomUUID(), at],
  );
  await db.query(
    `INSERT INTO return_items(id,store_id,return_id,sale_item_id,product_id,quantity,condition,condition_label,sellable,refund_amount,tax,cost_total)
    VALUES($1,$2,$3,$4,$5,1,'unused_unopened','Unused',$6,$7,$8,$9)`,
    [randomUUID(), f.store, id, original.item, f.product, sellable, total, tax, cost],
  );
}
const row = (result, key) => result.rows.find((r) => r.key === key);

test('percentage formula shows 900,000 to 780,000 as a 13.33% decrease', () => {
  assert.deepEqual(percentageChange(78000000, 90000000), {
    percent: -13.33,
    direction: 'decrease',
  });
  assert.deepEqual(percentageChange(120, 100), { percent: 20, direction: 'increase' });
  assert.deepEqual(percentageChange(100, 100), { percent: 0, direction: 'unchanged' });
  assert.deepEqual(percentageChange(100, 0), { percent: null, direction: 'unavailable' });
  assert.equal(percentageChange(100, 50, false).percent, null);
});

test('yearly totals exclude voided sales and compare the preceding calendar year', async () => {
  const f = await fixture();
  await sale(f, '2022-07-01T00:00:00Z', 90000000);
  await sale(f, '2023-07-01T00:00:00Z', 78000000);
  await sale(f, '2023-07-01T00:00:00Z', 100000000, { status: 'cancelled' });
  const overview = await salesOverview(db, f.store, {}, new Date('2024-01-01T12:00:00Z'));
  assert.equal(overview.level, 'years');
  assert.equal(row(overview, '2023').net_sales, 78000000);
  assert.equal(row(overview, '2023').change_percent, -13.33);
  assert.equal(row(overview, '2023').direction, 'decrease');
  assert.equal(row(overview, '2023').transactions, 1);
});

test('refund processing date, timezone, discounts, and year/month/day boundaries agree', async () => {
  const f = await fixture();
  const original = await sale(f, '2025-12-31T15:30:00Z', 20000);
  await refund(f, original, '2025-12-31T16:15:00Z', 2000);
  await sale(f, '2026-01-05T01:00:00Z', 8000, { subtotal: 10000, discount: 2000 });
  const asOf = new Date('2026-02-03T00:00:00Z');
  const years = await salesOverview(db, f.store, {}, asOf);
  assert.equal(row(years, '2025').net_sales, 20000);
  assert.equal(row(years, '2026').net_sales, 6000);
  const months = await salesOverview(db, f.store, { year: 2026 }, asOf);
  const january = row(months, '2026-01');
  assert.equal(january.gross_sales, 10000);
  assert.equal(january.discounts, 2000);
  assert.equal(january.refunds, 2000);
  assert.equal(january.net_sales, 6000);
  assert.equal(january.comparison.period, '2025-12');
  assert.equal(january.change_percent, -70);
  const days = await salesOverview(db, f.store, { year: 2026, month: 1 }, asOf);
  assert.equal(row(days, '2026-01-01').net_sales, -2000);
  assert.equal(row(days, '2026-01-01').comparison.period, '2025-12-31');
  assert.equal(row(days, '2026-01-01').change_percent, -110);
  assert.equal(row(days, '2026-01-05').net_sales, 8000);
});

test('confirmed zero periods differ from missing and partial history', async () => {
  const f = await fixture('2025-05-15T12:00:00+08:00');
  const result = await salesOverview(db, f.store, { year: 2025 }, new Date('2025-08-01T04:00:00Z'));
  assert.equal(row(result, '2025-04').availability, 'missing');
  assert.equal(row(result, '2025-04').net_sales, null);
  assert.equal(row(result, '2025-05').availability, 'partial');
  assert.equal(row(result, '2025-05').net_sales, 0);
  assert.equal(row(result, '2025-06').availability, 'complete');
  assert.equal(row(result, '2025-06').comparison.previous_net_sales, null);
  assert.equal(row(result, '2025-07').net_sales, 0);
  assert.equal(row(result, '2025-07').comparison.previous_net_sales, 0);
  assert.match(row(result, '2025-07').comparison.reason, /confirmed zero/);
  assert.equal(row(result, '2025-07').change_percent, null);
  assert.equal(row(result, '2025-08').in_progress, true);
  assert.equal(row(result, '2025-09').availability, 'future');
});

test('in-progress years, months, and days compare equivalent local calendar cutoffs', async () => {
  const f = await fixture();
  const asOf = new Date('2026-03-02T04:00:00Z'); // March 2, noon Manila.
  await sale(f, '2026-03-02T03:00:00Z', 150);
  await sale(f, '2026-03-01T03:00:00Z', 100);
  await sale(f, '2026-03-01T05:00:00Z', 1000);
  await sale(f, '2026-02-02T03:00:00Z', 500);
  await sale(f, '2026-02-02T05:00:00Z', 10000);
  await sale(f, '2025-03-02T03:00:00Z', 2000);
  await sale(f, '2025-03-02T05:00:00Z', 99999);
  const today = row(await salesOverview(db, f.store, { year: 2026, month: 3 }, asOf), '2026-03-02');
  assert.equal(today.net_sales, 150);
  assert.equal(today.comparison.previous_net_sales, 100);
  assert.equal(today.change_percent, 50);
  assert.equal(today.in_progress, true);
  const month = row(await salesOverview(db, f.store, { year: 2026 }, asOf), '2026-03');
  assert.equal(month.net_sales, 1250);
  assert.equal(month.comparison.previous_net_sales, 500);
  assert.equal(month.change_percent, 150);
  const year = row(await salesOverview(db, f.store, {}, asOf), '2026');
  assert.equal(year.net_sales, 11750);
  assert.equal(year.comparison.previous_net_sales, 2000);
  assert.equal(year.change_percent, 487.5);
});

test('short previous months and leap years use documented comparison cutoffs', async () => {
  const f = await fixture();
  await sale(f, '2026-02-27T01:00:00Z', 100);
  await sale(f, '2026-03-27T01:00:00Z', 150);
  await sale(f, '2026-03-30T01:00:00Z', 9999);
  const result = await salesOverview(db, f.store, { year: 2026 }, new Date('2026-03-31T04:00:00Z'));
  assert.equal(row(result, '2026-03').comparison.previous_to, '2026-03-01 00:00:00.000');
  assert.equal(row(result, '2026-03').comparison.current_to, '2026-03-29 00:00:00.000');
  assert.equal(row(result, '2026-03').net_sales, 10149);
  assert.equal(row(result, '2026-03').comparison.current_net_sales, 150);
  assert.equal(row(result, '2026-03').change_percent, 50);
  const leap = await salesOverview(db, f.store, {}, new Date('2024-02-29T04:00:00Z'));
  assert.equal(row(leap, '2024').comparison.previous_to, '2023-02-28 12:00:00.000');
  assert.equal(row(leap, '2024').comparison.current_to, '2024-02-28 12:00:00.000');
});

test('store timezone honors daylight-saving day boundaries', async () => {
  const f = await fixture('2024-01-01T00:00:00-05:00', 'America/New_York');
  await sale(f, '2025-03-09T04:59:00Z', 10); // March 8, 23:59 EST.
  await sale(f, '2025-03-09T05:00:00Z', 20); // March 9 midnight EST.
  await sale(f, '2025-03-10T03:59:00Z', 30); // March 9, 23:59 EDT.
  await sale(f, '2025-03-10T04:00:00Z', 40); // March 10 midnight EDT.
  const days = await salesOverview(
    db,
    f.store,
    { year: 2025, month: 3 },
    new Date('2025-04-01T12:00:00Z'),
  );
  assert.equal(row(days, '2025-03-08').net_sales, 10);
  assert.equal(row(days, '2025-03-09').net_sales, 50);
  assert.equal(row(days, '2025-03-10').net_sales, 40);
});

test('in-progress totals use the actual instant during a repeated daylight-saving hour', async () => {
  const f = await fixture('2024-01-01T00:00:00-05:00', 'America/New_York');
  await sale(f, '2025-11-02T05:00:00Z', 10); // First local 1am, before report time.
  await sale(f, '2025-11-02T06:00:00Z', 20); // Repeated local 1am, after report time.
  const days = await salesOverview(
    db,
    f.store,
    { year: 2025, month: 11 },
    new Date('2025-11-02T05:30:00Z'),
  );
  assert.equal(row(days, '2025-11-02').net_sales, 10);
});

test('existing reports reconcile processed refunds, net tax, and recovered sellable cost', async () => {
  const f = await fixture();
  const original = await sale(f, '2026-04-01T15:30:00Z', 9000, {
    subtotal: 10000,
    discount: 2000,
    tax: 1000,
    cost: 3000,
  });
  await refund(f, original, '2026-04-01T16:00:00Z', 4500, { tax: 500, cost: 1500 });
  let result;
  await reportController(db)(
    { user: { store_id: f.store }, query: { from: '2026-04-02', to: '2026-04-02' } },
    {
      json: (body) => {
        result = body;
      },
    },
  );
  assert.equal(result.summary.sales, -4500);
  assert.equal(result.summary.refunds, 4500);
  assert.equal(result.summary.tax, -500);
  assert.equal(result.summary.cost, -1500);
  assert.equal(result.summary.profit, -2500);
  assert.equal(result.daily[0].date, '2026-04-02');
  assert.equal(Number(result.daily[0].total), -4500);
  assert.equal(Number(result.payments[0].total), -4500);
  assert.equal(Number(result.categories[0].total), -4000);
  assert.equal(Number(result.products[0].total), -4000);
  assert.equal(Number(result.cashiers[0].total), -4500);
  assert.equal(result.transactions.length, 0);
  assert.equal(result.returns.length, 1);
});

test('product and category reports allocate residual cents exactly like original paid refunds', async () => {
  for (const inclusive of [false, true]) {
    const f = await fixture();
    const original = await sale(f, '2026-04-01T01:00:00Z', inclusive ? 298 : 334, {
      subtotal: 300,
      discount: 2,
      tax: 36,
    });
    await db.query('UPDATE sales SET receipt_store=$1 WHERE id=$2', [
      JSON.stringify({ tax_inclusive: inclusive }),
      original.id,
    ]);
    await db.query('UPDATE sale_items SET unit_price=100,total=100,category_name=$1 WHERE id=$2', [
      'One',
      original.item,
    ]);
    for (const name of ['Two', 'Three']) {
      await db.query(
        `INSERT INTO sale_items(id,store_id,sale_id,product_id,name,sku,category_name,quantity,unit_price,cost_price,total)
        VALUES($1,$2,$3,$4,$5,'REPORT',$5,1,100,0,100)`,
        [randomUUID(), f.store, original.id, f.product, name],
      );
    }
    const saleRow = (await db.query('SELECT * FROM sales WHERE id=$1', [original.id])).rows[0];
    const items = (await db.query('SELECT * FROM sale_items WHERE sale_id=$1', [original.id])).rows;
    const allocated = allocatePaidAmounts(saleRow, items);
    const returned = randomUUID();
    await db.query(
      `INSERT INTO sales_returns(id,store_id,sale_id,number,user_id,reason,total,tax,cost_total,idempotency_key,request_hash,created_at)
      VALUES($1,$2,$3,$4,$5,'Full return',$6,36,0,$7,'test','2026-04-01T02:00:00Z')`,
      [returned, f.store, original.id, `R-${returned}`, f.user, saleRow.total, randomUUID()],
    );
    for (const item of allocated) {
      await db.query(
        `INSERT INTO return_items(id,store_id,return_id,sale_item_id,product_id,quantity,condition,condition_label,sellable,refund_amount,tax,cost_total)
        VALUES($1,$2,$3,$4,$5,1,'unused_unopened','Unused',true,$6,$7,0)`,
        [randomUUID(), f.store, returned, item.id, f.product, item.paid_total, item.tax_total],
      );
    }
    let result;
    await reportController(db)(
      { user: { store_id: f.store }, query: { from: '2026-04-01', to: '2026-04-01' } },
      {
        json: (body) => {
          result = body;
        },
      },
    );
    assert.equal(result.summary.sales, 0);
    assert.equal(result.summary.tax, 0);
    assert.ok(result.categories.every((category) => category.total === 0));
    assert.ok(result.products.every((product) => product.total === 0));
  }
});

test('overview route validates calendar selection and protects financial data', async () => {
  const f = await fixture();
  await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [
    await hashPassword('ReportingTest2026!'),
    f.user,
  ]);
  const app = createApp(db, { secret: 'overview-tests-only-session-secret', demo: true });
  await request(app).get('/api/reports/overview').expect(401);
  const agent = request.agent(app);
  await agent
    .post('/api/auth/login')
    .send({ email: `${f.user}@suki.store`, password: 'ReportingTest2026!' })
    .expect(200);
  const result = (await agent.get('/api/reports/overview?year=2026&month=1').expect(200)).body;
  assert.equal(result.level, 'days');
  assert.equal(result.rows.length, 31);
  await agent.get('/api/reports/overview?month=2').expect(422);
  await agent.get('/api/reports/overview?year=2026&month=13').expect(422);
  await agent.get('/api/reports/overview?year=not-a-year').expect(422);
  await db.query("UPDATE users SET role='cashier' WHERE id=$1", [f.user]);
  await agent.get('/api/reports/overview').expect(403);
});
