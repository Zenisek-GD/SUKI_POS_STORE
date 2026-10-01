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
    { width: 768, height: 1024 },
    { width: 844, height: 390 },
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
        const cards = records.locator('.mobile-records');
        if (viewport.width <= 590 && path !== '/reports') {
          await expect(cards).toBeVisible();
          await expect(records.locator('table')).toHaveCount(0);
          const firstCard = cards.getByRole('listitem').first();
          if (await firstCard.count()) {
            await firstCard.scrollIntoViewIfNeeded();
            const cardBounds = await firstCard.boundingBox();
            expect(cardBounds.x, `${label}: card left edge`).toBeGreaterThanOrEqual(0);
            expect(
              cardBounds.x + cardBounds.width,
              `${label}: card right edge`,
            ).toBeLessThanOrEqual(viewport.width);
            await expect(firstCard.locator('.mobile-record-title')).toBeVisible();
            const details = firstCard.locator('.mobile-record-details');
            if (await details.count()) {
              await details.locator(':scope > summary').click();
              await expect(details).toHaveAttribute('open', '');
              await expect(details.locator('dd').first()).toBeVisible();
              await assertNoOverflow(`${label}: expanded record details`);
              await details.locator(':scope > summary').click();
            }
            for (const action of await firstCard.locator('.mobile-record-actions button').all()) {
              await action.scrollIntoViewIfNeeded();
              await assertInsideViewport(action, `${label}: record action`);
              const actionBounds = await action.boundingBox();
              expect(actionBounds.width, `${label}: touch target width`).toBeGreaterThanOrEqual(44);
              expect(actionBounds.height, `${label}: touch target height`).toBeGreaterThanOrEqual(
                44,
              );
            }
          }
          await records.locator('.table-footer').first().scrollIntoViewIfNeeded();
          await assertInsideViewport(
            records.locator('.table-footer').first(),
            `${label}: pagination`,
          );
          await page.evaluate(() => window.scrollTo(0, 0));
        } else {
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

  // Drawer navigation must work with touch and keyboards without leaving hidden links tabbable.
  await visit('/products', 'Products');
  const sidebar = page.locator('.sidebar');
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  expect(await sidebar.evaluate((node) => node.inert)).toBe(true);
  await sidebar
    .locator('a')
    .first()
    .evaluate((node) => node.focus());
  expect(await sidebar.evaluate((node) => node.contains(document.activeElement))).toBe(false);
  await menu.click();
  await expect(sidebar).toHaveClass(/open/);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  expect(await sidebar.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  for (let index = 0; index < 25; index += 1) {
    await page.keyboard.press('Tab');
    expect(await sidebar.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(sidebar).not.toHaveClass(/open/);
  await expect(menu).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await menu.click();
  await sidebar.locator('a[href="/inventory"]').click();
  await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible();
  await expect(sidebar).not.toHaveClass(/open/);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await menu.click();
  await page.setViewportSize({ width: 1280, height: 650 });
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  expect(await sidebar.evaluate((node) => node.inert)).toBe(false);
  await page.setViewportSize({ width: 320, height: 640 });
  await expect.poll(() => sidebar.evaluate((node) => node.inert)).toBe(true);
  console.log(
    'PASS: mobile navigation traps focus, closes with Escape and links, and unlocks after desktop resize',
  );

  // Pagination retains its position when a phone card list becomes a tablet table.
  await visit('/products', 'Products');
  const productCards = page.locator('.mobile-record-card');
  const firstProduct = await productCards.first().locator('.mobile-record-title').innerText();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.locator('.table-footer')).toContainText('Page 2 of 2');
  const nextProduct = await productCards.first().locator('.mobile-record-title').innerText();
  expect(nextProduct).not.toBe(firstProduct);
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.locator('.records-panel table')).toBeVisible();
  await expect(page.locator('.table-footer')).toContainText('Page 2 of 2');
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(productCards.first().locator('.mobile-record-title')).toHaveText(nextProduct, {
    useInnerText: true,
  });
  await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  await expect(productCards.first().locator('.mobile-record-title')).toHaveText(firstProduct, {
    useInnerText: true,
  });
  await page
    .getByRole('textbox', { name: 'Search products, SKU, or barcode' })
    .fill('No matching mobile product');
  await expect(page.getByRole('heading', { name: 'No records found' })).toBeVisible();
  await expect(productCards).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(productCards).toHaveCount(10);

  // Editing and stock history are reachable directly from cards, without sideways scrolling.
  for (const [path, heading, title, field, value, save] of [
    [
      '/products',
      'Products',
      'Edit product',
      'Description',
      'Edited from a phone card.',
      'Save product',
    ],
    [
      '/customers',
      'Customers',
      'Edit customer',
      'Address',
      'Updated from a phone card.',
      'Save customer',
    ],
  ]) {
    await visit(path, heading);
    const edit = page
      .locator('.mobile-record-card')
      .first()
      .getByRole('button', { name: /^Edit / });
    await edit.scrollIntoViewIfNeeded();
    await assertInsideViewport(edit, `${title}: card action`);
    await edit.click();
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    await dialog.getByLabel(field, { exact: true }).fill(value);
    await dialog.getByRole('button', { name: save, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await edit.click();
    await expect(dialog.getByLabel(field, { exact: true })).toHaveValue(value);
    await assertNoOverflow(title);
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  }
  await visit('/inventory', 'Inventory');
  const historyAction = page
    .locator('.mobile-record-card')
    .first()
    .locator('.mobile-record-title button');
  await historyAction.scrollIntoViewIfNeeded();
  await assertInsideViewport(historyAction, 'Inventory stock history action');
  await historyAction.click();
  const history = page.getByRole('dialog', { name: /stock history$/ });
  await expect(history).toBeVisible();
  await expect(history.locator('.loading')).toHaveCount(0);
  const balanceHeader = history.locator('th').filter({ hasText: 'Available balance' });
  await balanceHeader.scrollIntoViewIfNeeded();
  await assertInsideViewport(balanceHeader, 'Inventory running balance column');
  await assertNoOverflow('Inventory stock history');
  await history.getByRole('button', { name: 'Done', exact: true }).click();
  console.log(
    'PASS: mobile cards support pagination, empty results, persisted editing and stock history',
  );

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
  await page
    .locator('.mobile-record-card')
    .first()
    .getByText('More details', { exact: true })
    .click();
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
