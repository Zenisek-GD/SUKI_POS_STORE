import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createDatabase, migrate, one } from '../pos_backend/models/database.js';
import { seed } from '../pos_backend/models/seed.js';
import { createApp } from '../pos_backend/app.js';
import { id } from '../pos_backend/utils.js';
import { moveStock } from '../pos_backend/services/inventory.js';
import { completeSale } from '../pos_backend/services/sales.js';

const db = await createDatabase({ memory: true });
let server, browser;
try {
  await migrate(db);
  const credentials = { email: 'owner@suki.store', password: 'BrowserOwner2026!' };
  await seed(db, { demo: false, ...credentials, name: 'Gerald' });
  const owner = await one(db, 'SELECT * FROM users');
  const productId = id();
  await db.query(
    'INSERT INTO products(id,store_id,name,sku,cost_price,price) VALUES($1,$2,$3,$4,1500,2500)',
    [productId, owner.store_id, 'Return test sardines', 'RETURN-SARDINES'],
  );
  await db.transaction((tx) => moveStock(tx, owner, productId, 100, 'opening', 'Initial stock'));
  const sale = await completeSale(db, owner, {
    items: [{ product_id: productId, quantity: 5 }],
    customer_id: null,
    discount_percent: 10,
    payment_method: 'Cash',
    amount_received: 15000,
    notes: '',
    idempotency_key: id(),
  });
  const origin = 'http://127.0.0.1:3103';
  const app = createApp(db, { origin, secret: 'isolated-store-operations-browser-secret' });
  server = await new Promise((resolve) => {
    const s = app.listen(3103, '127.0.0.1', () => resolve(s));
  });
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(chrome) ? { executablePath: chrome } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByLabel('Email address').fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in to your store' }).click();
  await expect(page.getByRole('heading', { name: 'A good day for business.' })).toBeVisible();
  await page.getByRole('link', { name: 'Transactions', exact: true }).click();
  await page.getByRole('button', { name: 'Find sale for return', exact: true }).click();
  await page.getByLabel('Receipt or transaction number').fill(sale.number);
  await page.getByRole('button', { name: 'Find sale', exact: true }).click();
  let modal = page.getByRole('dialog');
  await expect(modal.getByRole('heading', { name: 'Return products' })).toBeVisible();
  await page.getByLabel('Return quantity for Return test sardines').fill('2');
  await page.getByLabel('Condition for Return test sardines').selectOption('unused_unopened');
  await page.getByLabel('Return reason', { exact: true }).fill('Customer bought two extra cans');
  await page.getByRole('checkbox', { name: /I have inspected/ }).check();
  await expect(modal.locator('.return-total')).toContainText('₱45.00');
  await page.getByRole('button', { name: 'Record return', exact: true }).click();
  await expect(modal.getByRole('heading', { name: 'Return recorded' })).toBeVisible();
  assert.equal((await one(db, 'SELECT stock FROM products WHERE id=$1', [productId])).stock, 97);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: `Return ${sale.number}`, exact: true }).click();
  await page.getByLabel('Return quantity for Return test sardines').fill('1');
  await page.getByLabel('Condition for Return test sardines').selectOption('damaged');
  await page.getByLabel('Return reason', { exact: true }).fill('One can is dented and leaking');
  await page.getByRole('checkbox', { name: /I have inspected/ }).check();
  await page.getByRole('button', { name: 'Record return', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Return recorded' })).toBeVisible();
  assert.deepEqual(
    await one(db, 'SELECT stock,non_sellable_stock FROM products WHERE id=$1', [productId]),
    { stock: 97, non_sellable_stock: 1 },
  );
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('link', { name: 'Inventory', exact: true }).click();
  await page.getByRole('row').filter({ hasText: 'Return test sardines' }).click();
  modal = page.getByRole('dialog');
  await expect(
    modal.getByRole('heading', { name: 'Return test sardines stock history' }),
  ).toBeVisible();
  await expect(modal.getByRole('cell', { name: 'Customer return', exact: true })).toBeVisible();
  await expect(modal.getByRole('cell', { name: 'Damaged stock', exact: true })).toBeVisible();
  await page.getByLabel('History movement type').selectOption('sale');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(modal.getByRole('cell', { name: 'Sale', exact: true })).toBeVisible();
  await expect(modal.getByRole('cell', { name: 'Customer return', exact: true })).toHaveCount(0);
  assert.ok((await modal.boundingBox()).width >= 1100, 'desktop stock history uses a wide dialog');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/product-stock-history.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'mobile history must fit viewport',
  );
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Product return policy' }).click();
  await page.getByRole('checkbox', { name: /Unused, unopened, intact packaging/ }).uncheck();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toContainText('Store settings saved');
  await page.getByRole('link', { name: 'Transactions', exact: true }).click();
  await page.getByRole('button', { name: `Return ${sale.number}`, exact: true }).click();
  await expect(
    page
      .getByLabel('Condition for Return test sardines')
      .locator('option[value="unused_unopened"]'),
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Previous returns' })).toBeVisible();
  assert.ok(
    (await page.getByRole('dialog').boundingBox()).width >= 1100,
    'desktop return table uses a wide dialog',
  );
  await page.screenshot({ path: 'test-results/product-return.png', fullPage: true });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await db.query("UPDATE sales SET created_at=now()-interval '25 hours' WHERE id=$1", [sale.id]);
  await page.getByRole('button', { name: `Return ${sale.number}`, exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('24-hour return window has expired');
  await expect(page.getByRole('button', { name: 'Record return', exact: true })).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: receipt lookup, discounted partial returns, damaged stock, history filters, mobile modal, owner policy, expired-return explanation',
  );
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.close();
}
