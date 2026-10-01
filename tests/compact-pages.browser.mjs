import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createDatabase, migrate } from '../pos_backend/models/database.js';
import { seed } from '../pos_backend/models/seed.js';
import { createApp } from '../pos_backend/app.js';

// Layout checks use the built frontend and a disposable database, never store data.
const db = await createDatabase({ memory: true });
let browser, server, page;
try {
  await migrate(db);
  await seed(db, { demo: true });
  const origin = 'http://127.0.0.1:3107';
  const app = createApp(db, { demo: true, origin, secret: 'compact-pages-browser-secret' });
  server = await new Promise((resolve) => {
    const running = app.listen(3107, '127.0.0.1', () => resolve(running));
  });
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(chrome) ? { executablePath: chrome } : {}),
  });
  page = await browser.newPage({ viewport: { width: 1280, height: 650 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mkdir('test-results', { recursive: true });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Store owner', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in to your store' }).click();
  await expect(page.getByRole('heading', { name: 'A good day for business.' })).toBeVisible();

  const routes = [
    ['/', 'A good day for business.'],
    ['/pos', 'Point of sale'],
    ['/products', 'Products'],
    ['/inventory', 'Inventory'],
    ['/sales', 'Transactions'],
    ['/customers', 'Customers'],
    ['/suppliers', 'Suppliers'],
    ['/purchases', 'Purchases'],
    ['/expenses', 'Expenses'],
    ['/team', 'Team members'],
    ['/audit', 'Audit trail'],
    ['/reports', 'Reports & insights'],
    ['/settings', 'Store settings'],
    ['/account', 'My account'],
  ];
  async function visit(path, heading) {
    await page.goto(`${origin}${path}`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.locator('.loading')).toHaveCount(0);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(document.getAnimations().map((animation) => animation.finished));
    });
  }
  async function assertNoOverflow(label) {
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `${label}: page must not scroll horizontally`,
    ).toBe(true);
  }
  async function assertInsideViewport(locator, label) {
    const bounds = await locator.boundingBox();
    expect(bounds, label).not.toBeNull();
    const viewport = page.viewportSize();
    expect(bounds.x, `${label}: left edge`).toBeGreaterThanOrEqual(-1);
    expect(bounds.x + bounds.width, `${label}: right edge`).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds.y, `${label}: top edge`).toBeGreaterThanOrEqual(-1);
    expect(bounds.y + bounds.height, `${label}: bottom edge`).toBeLessThanOrEqual(
      viewport.height + 1,
    );
  }
  for (const viewport of [
    { width: 1280, height: 650 },
    { width: 390, height: 844 },
    { width: 320, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    for (const [path, heading] of routes) {
      const label = `${path} at ${viewport.width}px`;
      await visit(path, heading);
      await assertNoOverflow(label);
      // POS deliberately uses a visually hidden title; its toolbar is tested separately.
      if (path !== '/pos') {
        await assertInsideViewport(
          page.getByRole('heading', { name: heading, exact: true }),
          label,
        );
        const header = page.locator('.page-heading');
        const headerBounds = await header.boundingBox();
        expect(headerBounds.height, `${label}: compact page header`).toBeLessThanOrEqual(
          viewport.width > 900 ? 70 : 180,
        );
        for (const action of await header.getByRole('button').all()) {
          await assertInsideViewport(action, `${label}: page action`);
        }
      }

      const records = page.locator('.records-panel').first();
      if (await records.count()) {
        const scroll = records.locator('.table-scroll').first();
        await expect(scroll).toBeVisible();
        const firstHeader = scroll.locator('th').first();
        await assertInsideViewport(firstHeader, `${label}: first table column`);
        // Wide tables keep horizontal scrolling inside the list on narrow screens.
        await scroll.evaluate((element) => {
          element.scrollLeft = element.scrollWidth;
        });
        const lastHeader = scroll.locator('th').last();
        const [lastBounds, scrollBounds] = await Promise.all([
          lastHeader.boundingBox(),
          scroll.boundingBox(),
        ]);
        expect(
          lastBounds.x + lastBounds.width,
          `${label}: last column is reachable`,
        ).toBeLessThanOrEqual(scrollBounds.x + scrollBounds.width + 1);
        await scroll.evaluate((element) => {
          element.scrollLeft = 0;
        });
        if (viewport.width > 900) {
          await assertInsideViewport(
            records.locator('.toolbar').first(),
            `${label}: list controls`,
          );
          await assertInsideViewport(
            records.locator('.table-footer').first(),
            `${label}: pagination`,
          );
          const firstRow = scroll.locator('tbody tr').first();
          if (await firstRow.count()) {
            const [rowBounds, containerBounds] = await Promise.all([
              firstRow.boundingBox(),
              scroll.boundingBox(),
            ]);
            expect(
              rowBounds.y + rowBounds.height,
              `${label}: first record is visible`,
            ).toBeLessThanOrEqual(containerBounds.y + containerBounds.height + 1);
            await scroll.evaluate((element) => {
              element.scrollTop = element.scrollHeight;
            });
            const lastRow = await scroll.locator('tbody tr').last().boundingBox();
            expect(
              lastRow.y + lastRow.height,
              `${label}: last record is reachable`,
            ).toBeLessThanOrEqual(containerBounds.y + containerBounds.height + 1);
            await scroll.evaluate((element) => {
              element.scrollTop = 0;
            });
          }
        }
        await assertNoOverflow(label);
      }
      if (
        ['/', '/products', '/inventory', '/sales', '/reports', '/settings'].includes(path) &&
        viewport.width !== 390
      ) {
        await page.screenshot({
          path: `test-results/compact-${path.slice(1) || 'dashboard'}-${viewport.width}.png`,
        });
      }
    }
    console.log(
      `PASS: every authenticated page fits ${viewport.width}×${viewport.height}; table columns remain reachable`,
    );
  }

  // Long forms must remain usable even on the smallest supported phone viewport.
  for (const [path, heading, open, title, save] of [
    ['/products', 'Products', 'Add product', 'Add product', 'Save product'],
    ['/inventory', 'Inventory', 'Adjust stock', 'Adjust inventory', 'Save stock change'],
    ['/customers', 'Customers', 'Add customer', 'Add customer', 'Save customer'],
    ['/suppliers', 'Suppliers', 'Add supplier', 'Add supplier', 'Save supplier'],
    ['/expenses', 'Expenses', 'Record expense', 'Add expense', 'Save expense'],
    ['/purchases', 'Purchases', 'New purchase', 'New purchase order', 'Create purchase'],
    ['/team', 'Team members', 'Add team member', 'Add team member', 'Save team member'],
  ]) {
    await visit(path, heading);
    await page.getByRole('button', { name: open, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    await expect(dialog).toBeVisible();
    const inputs = dialog.locator('input:not([type="checkbox"]), select, textarea');
    for (const field of await inputs.all()) {
      await field.scrollIntoViewIfNeeded();
      await assertInsideViewport(field, `${title}: form field`);
    }
    const primary = dialog.getByRole('button', { name: save, exact: true });
    await primary.scrollIntoViewIfNeeded();
    await assertInsideViewport(primary, `${title}: primary action`);
    await expect(primary).toBeEnabled();
    await assertNoOverflow(title);
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  console.log(
    'PASS: product, stock, customer, supplier, expense, purchase and team forms fit 320px phones',
  );

  await visit('/settings', 'Store settings');
  await expect(page.getByLabel('Store name', { exact: true })).toBeVisible();
  const taxSection = page
    .locator('details')
    .filter({ has: page.getByRole('heading', { name: 'Tax & receipts', exact: true }) });
  await taxSection.locator(':scope > summary').click();
  const tax = page.getByLabel('Tax rate (%)', { exact: true });
  await tax.fill('101');
  await taxSection.locator(':scope > summary').click();
  await expect(tax).not.toBeVisible();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(tax).toBeVisible();
  await expect(tax).toBeFocused();
  await assertNoOverflow('settings validation');
  await tax.fill('0');
  console.log('PASS: saving invalid settings expands the hidden section and focuses its field');
  await visit('/products', 'Products');
  const code = page.locator('.record-code').first();
  await code.locator('summary').click();
  await expect(code.locator('code')).toBeVisible();
  await assertNoOverflow('expanded product code');

  await visit('/reports', 'Reports & insights');
  const reportTable = page.locator('.report-results');
  await assertInsideViewport(reportTable.locator('th').first(), 'mobile report records');
  await page.locator('.report-custom-dates > summary').click();
  const reportStart = page.getByLabel('Report start date', { exact: true });
  const reportEnd = page.getByLabel('Report end date', { exact: true });
  const end = await reportEnd.inputValue();
  await reportStart.fill(end);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('.loading')).toHaveCount(0);
  await expect(reportTable.locator('tbody tr')).toHaveCount(1);
  await assertNoOverflow('custom report dates');
  console.log('PASS: product codes and custom report dates expand on demand');
  expect(errors, 'browser runtime errors').toEqual([]);
} catch (error) {
  if (page) await page.screenshot({ path: 'test-results/compact-pages-failure.png' });
  throw error;
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.close();
}
