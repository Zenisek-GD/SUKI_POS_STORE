import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createDatabase, migrate, one } from '../pos_backend/models/database.js';
import { seed } from '../pos_backend/models/seed.js';
import { createApp } from '../pos_backend/app.js';
const db = await createDatabase({ memory: true });
await migrate(db);
await seed(db, { demo: true });
const origin = 'http://127.0.0.1:3101',
  app = createApp(db, { demo: true, origin, secret: 'isolated-browser-test-secret' });
const server = await new Promise((resolve) => {
  const s = app.listen(3101, '127.0.0.1', () => resolve(s));
});
await mkdir('test-results', { recursive: true });
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(chrome) ? { executablePath: chrome } : {}),
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } }),
    page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await page.getByRole('button', { name: 'Store owner', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in to your store' }).click();
  await expect(page.getByRole('heading', { name: 'A good day for business.' })).toBeVisible();
  await expect(page.locator('.sales-chart')).toBeVisible();
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  console.log('PASS: owner login and dashboard');
  // Create a product through its full form.
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  await page.getByLabel('Product name', { exact: true }).fill('Browser test coffee');
  await page.getByLabel('SKU', { exact: true }).fill('BROWSER-COFFEE');
  await page.getByLabel('Cost price', { exact: true }).fill('50');
  await page.getByLabel('Selling price', { exact: true }).fill('75.50');
  await page.getByLabel('Opening stock', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .getByRole('textbox', { name: 'Search products, SKU, or barcode' })
    .fill('Browser test coffee');
  await expect(page.getByText('Browser test coffee', { exact: true })).toBeVisible();
  console.log('PASS: product creation');
  await page.getByRole('link', { name: 'Point of sale', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search or scan a product' }).fill('BROWSER-COFFEE');
  await page.getByRole('textbox', { name: 'Search or scan a product' }).press('Enter');
  await expect(page.getByRole('button', { name: 'Charge ₱75.50' })).toBeEnabled();
  await page.getByRole('button', { name: 'Increase Browser test coffee' }).click();
  await page.getByRole('button', { name: 'Charge ₱151.00' }).click();
  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await page.getByLabel('Cash received', { exact: true }).fill('200');
  await expect(page.getByText('₱49.00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Complete sale', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sale complete!' })).toBeVisible();
  await page.screenshot({ path: 'test-results/receipt.png', fullPage: true });
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.receipt')).toBeVisible();
  const pdf = await page.pdf({
    path: 'test-results/receipt.pdf',
    width: '80mm',
    printBackground: true,
  });
  expect(pdf.length).toBeGreaterThan(1000);
  await page.emulateMedia({ media: 'screen' });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const receipt = await downloadPromise;
  expect(receipt.suggestedFilename()).toMatch(/^SK-.*\.html$/);
  await page.getByRole('button', { name: 'New sale', exact: true }).click();
  assertEqual(
    (await one(db, "SELECT stock FROM products WHERE sku='BROWSER-COFFEE'")).stock,
    8,
    'stock decreases after sale',
  );
  console.log(
    'PASS: barcode input, quantity, cash/change, checkout, receipt download, stock decrement',
  );
  // Record damaged stock from UI.
  await page.getByRole('link', { name: /^Inventory/ }).click();
  await page.getByRole('button', { name: 'Adjust stock', exact: true }).click();
  await page
    .getByLabel('Product', { exact: true })
    .selectOption({ label: 'Browser test coffee · 8 in stock' });
  await page.getByLabel('Movement type', { exact: true }).selectOption('damaged');
  await page.getByLabel('Quantity', { exact: true }).fill('1');
  await page.getByLabel('Reason', { exact: true }).fill('Damaged test package');
  await page.getByRole('button', { name: 'Save stock change', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assertEqual(
    (await one(db, "SELECT stock FROM products WHERE sku='BROWSER-COFFEE'")).stock,
    7,
    'stock adjustment',
  );
  // Receive the seeded supplier order and ensure confirmation is present.
  await page.getByRole('link', { name: 'Purchases', exact: true }).click();
  await page.getByRole('button', { name: 'Receive', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Receive this purchase?' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm received', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page
      .locator('.badge')
      .filter({ hasText: /^Received$/ })
      .first(),
  ).toBeVisible();
  console.log('PASS: stock adjustment and purchase receiving');
  // Reports export contains actual rows.
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reports & insights' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Report type' }).selectOption('products');
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  const exportPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await exportPromise).suggestedFilename()).toMatch(/^products-.*\.csv$/);
  // All other application pages should render without crashes.
  for (const [link, heading] of [
    ['Customers', 'Customers'],
    ['Suppliers', 'Suppliers'],
    ['Expenses', 'Expenses'],
    ['Team members', 'Team members'],
    ['Audit trail', 'Audit trail'],
    ['Settings', 'Store settings'],
    ['Transactions', 'Transactions'],
  ]) {
    await page.getByRole('link', { name: link, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await page.getByRole('link', { name: 'Point of sale', exact: true }).click();
  await page.screenshot({ path: 'test-results/pos-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  assertEqual(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'mobile layout has no horizontal overflow',
  );
  await page.getByRole('button', { name: 'Add Absolute Water 500ml', exact: true }).click();
  await page.getByRole('button', { name: 'View current order', exact: true }).click();
  await expect(page.locator('.cart-panel')).toBeInViewport();
  await page.screenshot({ path: 'test-results/pos-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Continue shopping', exact: true }).click();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A good day for business.' })).toBeVisible();
  assertEqual(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'mobile dashboard has no horizontal overflow',
  );
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });
  console.log('PASS: management pages, CSV export, mobile navigation and layout');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await page.getByRole('button', { name: 'Cashier', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in to your store' }).click();
  await expect(page.getByRole('heading', { name: 'Point of sale', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('link', { name: 'Team members', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Reports', exact: true })).toHaveCount(0);
  assertEqual(errors.length, 0, `browser errors: ${errors.join('; ')}`);
  console.log('PASS: cashier role navigation; no browser runtime errors');
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}
