import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createDatabase, migrate, one } from '../pos_backend/models/database.js';
import { seed } from '../pos_backend/models/seed.js';
import { createApp } from '../pos_backend/app.js';

// Built frontend + isolated in-memory database. This never opens the store's saved database.
const db = await createDatabase({ memory: true });
let browser, server;
try {
  await migrate(db);
  await seed(db, { demo: true });
  const store = await one(db, 'SELECT id FROM stores LIMIT 1');
  const sardinesId = randomUUID(),
    flourId = randomUUID();
  await db.query(
    `INSERT INTO products(id,store_id,name,sku,barcode,cost_price,price,stock,unit)
     VALUES($1,$3,'Quantity Sardines','QTY-SAR','4899911122233',2000,2500,12,'can'),
           ($2,$3,'Manual Flour','QTY-FLOUR',NULL,3000,4000,9,'pack')`,
    [sardinesId, flourId, store.id],
  );
  const flour = await one(db, 'SELECT product_code FROM products WHERE id=$1', [flourId]);
  expect(flour.product_code).toBeTruthy();
  const origin = 'http://127.0.0.1:3104';
  const app = createApp(db, {
    demo: true,
    origin,
    secret: 'isolated-quantity-browser-test-secret',
  });
  server = await new Promise((resolve) => {
    const running = app.listen(3104, '127.0.0.1', () => resolve(running));
  });
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(chrome) ? { executablePath: chrome } : {}),
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole('button', { name: 'Store owner', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in to your store' }).click();
  await page.getByRole('link', { name: 'Point of sale', exact: true }).click();
  const quantity = page.getByLabel('Quantity before adding', { exact: true });
  const scan = page.getByRole('textbox', { name: 'Search or scan a product' });
  const sardinesQuantity = page.getByLabel('Quantity for Quantity Sardines', { exact: true });
  await expect(quantity).toHaveValue('1');
  await quantity.fill('5');
  await scan.fill('4899911122233');
  await scan.press('Enter');
  await expect(sardinesQuantity).toHaveValue('5');
  await expect(quantity).toHaveValue('1');
  await quantity.fill('3');
  await scan.fill('4899911122233');
  await scan.press('Enter');
  await expect(sardinesQuantity).toHaveValue('8');
  await quantity.fill('4');
  await scan.fill('4899911122'); // Exactly one filtered match must still not be accepted.
  await scan.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Product not found');
  await expect(quantity).toHaveValue('4');
  await expect(sardinesQuantity).toHaveValue('8');
  await scan.fill('4899911122233');
  await scan.press('Enter');
  await expect(sardinesQuantity).toHaveValue('12');
  await expect(quantity).toHaveValue('1');
  await quantity.fill('2');
  await scan.fill('4899911122233');
  await scan.press('Enter');
  await expect(page.getByRole('alert')).toContainText('you can add 0 more');
  await expect(quantity).toHaveValue('2');
  await expect(sardinesQuantity).toHaveValue('12');
  console.log('PASS: scan quantity 5, merge, unknown barcode retry, and total stock validation');

  async function voidOrder() {
    await page.getByRole('button', { name: 'Void current order' }).click();
    await page.getByRole('button', { name: 'Void order', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await voidOrder();
  expect((await one(db, 'SELECT stock FROM products WHERE id=$1', [sardinesId])).stock).toBe(12);
  await scan.fill('');
  await quantity.fill('5');
  await page.getByRole('button', { name: 'Find Product', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const find = dialog.getByRole('textbox', { name: 'Search name, SKU, product code, or barcode' });
  for (const term of ['Manual Flour', 'QTY-FLOUR', flour.product_code]) {
    await find.fill(term);
    await expect(dialog.getByRole('button', { name: 'Add Manual Flour to order' })).toBeVisible();
  }
  await find.fill('4899911122233');
  await expect(
    dialog.getByRole('button', { name: 'Add Quantity Sardines to order' }),
  ).toBeVisible();
  await find.fill('Manual Flour');
  await dialog.getByRole('button', { name: 'Favorite Manual Flour', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add Manual Flour to order' }).click();
  await expect(dialog.getByLabel('Quantity to add', { exact: true })).toHaveValue('1');
  await expect(dialog.getByText('5 in order', { exact: true })).toBeVisible();
  await dialog.getByLabel('Quantity to add', { exact: true }).fill('5');
  await dialog.getByRole('button', { name: 'Add Manual Flour to order' }).click();
  await expect(dialog.getByRole('alert')).toContainText('you can add 4 more');
  await expect(dialog.getByLabel('Quantity to add', { exact: true })).toHaveValue('5');
  await dialog.getByLabel('Quantity to add', { exact: true }).fill('1.5');
  await dialog.getByRole('button', { name: 'Add Manual Flour to order' }).click();
  await expect(dialog.getByRole('alert')).toContainText('positive whole-number');
  await dialog.getByLabel('Quantity to add', { exact: true }).fill('1');
  await dialog.getByRole('button', { name: 'Add Manual Flour to order' }).click();
  await dialog.getByRole('button', { name: 'Back to order', exact: true }).click();
  await expect(page.getByLabel('Quantity for Manual Flour')).toHaveValue('6');
  await expect(page.getByRole('button', { name: 'Add favorite Manual Flour' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add favorite Manual Flour' })).toBeVisible();
  await expect(page.getByLabel('Quantity for Manual Flour')).toHaveValue('6');
  await page.getByRole('button', { name: 'Void Manual Flour', exact: true }).click();
  await page.getByRole('button', { name: 'Void item', exact: true }).click();
  await expect(page.getByLabel('Quantity for Manual Flour')).toHaveCount(0);
  expect((await one(db, 'SELECT stock FROM products WHERE id=$1', [flourId])).stock).toBe(9);
  console.log(
    'PASS: manual quantity 5, search fields, stock validation, favorites, and pre-checkout void',
  );

  await quantity.fill('5');
  await scan.fill(flour.product_code);
  await scan.press('Enter');
  await expect(page.getByLabel('Quantity for Manual Flour')).toHaveValue('5');
  await page.getByLabel('Quantity for Manual Flour').fill('4');
  await expect(page.getByRole('button', { name: /Charge.*160\.00/ })).toBeEnabled();
  await quantity.fill('1');
  await page.getByRole('button', { name: 'Add favorite Manual Flour' }).click();
  await expect(page.getByLabel('Quantity for Manual Flour')).toHaveValue('5');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Find Product', exact: true }).click();
  await find.fill('Manual Flour');
  await expect(dialog.getByRole('button', { name: 'Add Manual Flour to order' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Back to order', exact: true }).click();
  await page.getByRole('button', { name: 'View current order', exact: true }).click();
  await expect(page.locator('.cart-panel')).toBeInViewport();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/checkout-quantity-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/checkout-quantity-desktop.png', fullPage: true });

  // Simulate another register consuming stock after this cart was prepared.
  await db.query('UPDATE products SET stock=4 WHERE id=$1', [flourId]);
  const before = await one(db, 'SELECT COUNT(*)::int AS count FROM sales');
  await page.getByRole('button', { name: /Charge.*200\.00/ }).click();
  await dialog.getByRole('button', { name: 'Cash', exact: true }).click();
  await dialog.getByLabel('Cash received', { exact: true }).fill('200');
  await dialog.getByRole('button', { name: 'Complete sale', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(/stock|available/i);
  expect((await one(db, 'SELECT COUNT(*)::int AS count FROM sales')).count).toBe(before.count);
  expect((await one(db, 'SELECT stock FROM products WHERE id=$1', [flourId])).stock).toBe(4);
  expect(errors).toEqual([]);
  console.log(
    'PASS: code entry without barcode, immediate totals, mobile UI, and checkout stock revalidation',
  );
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.close();
}
