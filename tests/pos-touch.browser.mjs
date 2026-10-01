import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createDatabase, migrate, one } from '../pos_backend/models/database.js';
import { seed } from '../pos_backend/models/seed.js';
import { createApp } from '../pos_backend/app.js';

// Exercise the built UI using touch events and an isolated, disposable database.
const db = await createDatabase({ memory: true });
let browser, server, page;
try {
  await migrate(db);
  await seed(db, { demo: true });
  const store = await one(db, 'SELECT id FROM stores LIMIT 1');
  const sardinesId = randomUUID(),
    flourId = randomUUID();
  await db.query(
    `INSERT INTO products(id,store_id,name,sku,barcode,cost_price,price,stock,unit)
     VALUES($1,$3,'Touch Sardines','TOUCH-SAR','4899988877766',2000,2500,200,'can'),
           ($2,$3,'Touch Flour','TOUCH-FLOUR',NULL,3000,4000,20,'pack')`,
    [sardinesId, flourId, store.id],
  );
  const origin = 'http://127.0.0.1:3106';
  const app = createApp(db, {
    demo: true,
    origin,
    secret: 'isolated-touch-checkout-browser-secret',
  });
  server = await new Promise((resolve) => {
    const running = app.listen(3106, '127.0.0.1', () => resolve(running));
  });
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(chrome) ? { executablePath: chrome } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    hasTouch: true,
  });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mkdir('test-results', { recursive: true });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Store owner', exact: true }).tap();
  await page.getByRole('button', { name: 'Sign in to your store' }).tap();
  await page.getByRole('link', { name: 'Point of sale', exact: true }).tap();

  const quantity = page.getByLabel('Quantity before adding', { exact: true });
  const sardinesQuantity = page.getByLabel('Quantity for Touch Sardines', { exact: true });
  const flourQuantity = page.getByLabel('Quantity for Touch Flour', { exact: true });
  const scan = page.getByRole('textbox', { name: 'Search or scan a product' });
  const keypad = (title = 'Set quantity') => page.getByRole('dialog', { name: title, exact: true });
  async function digits(dialog, value) {
    for (const digit of String(value))
      await dialog.getByRole('button', { name: `Quantity digit ${digit}`, exact: true }).tap();
  }
  async function applyQuantity(dialog) {
    await dialog.getByRole('button', { name: 'Use quantity', exact: true }).tap();
    await expect(dialog).toHaveCount(0);
  }
  async function assertNoOverflow() {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  async function assertFullyVisible(locator, container) {
    const [item, bounds] = await Promise.all([locator.boundingBox(), container.boundingBox()]);
    expect(item).not.toBeNull();
    expect(bounds).not.toBeNull();
    const viewport = page.viewportSize();
    expect(item.y).toBeGreaterThanOrEqual(Math.max(0, bounds.y) - 1);
    expect(item.y + item.height).toBeLessThanOrEqual(
      Math.min(viewport.height, bounds.y + bounds.height) + 1,
    );
    expect(item.x).toBeGreaterThanOrEqual(Math.max(0, bounds.x) - 1);
    expect(item.x + item.width).toBeLessThanOrEqual(
      Math.min(viewport.width, bounds.x + bounds.width) + 1,
    );
  }
  async function assertCompactSpace() {
    const dimensions = await page.evaluate(() => {
      const height = (selector) => document.querySelector(selector).getBoundingClientRect().height;
      return {
        workspace: height('.touch-pos'),
        products: height('.pos-catalog-products'),
        order: height('.cart-panel'),
        lines: height('.pos-order-lines'),
      };
    });
    expect(dimensions.products).toBeGreaterThanOrEqual(dimensions.workspace * 0.55);
    expect(dimensions.lines).toBeGreaterThanOrEqual(dimensions.order * 0.45);
    expect(dimensions.products).toBeGreaterThanOrEqual(240);
    expect(dimensions.lines).toBeGreaterThanOrEqual(230);
  }

  await expect(quantity).toHaveValue('1');
  await page.getByRole('button', { name: 'Open quantity keypad', exact: true }).tap();
  await digits(keypad(), 5);
  await page.screenshot({ path: 'test-results/pos-touch-keypad.png', fullPage: true });
  await applyQuantity(keypad());
  await expect(quantity).toHaveValue('5');
  await page.getByRole('button', { name: 'Add Touch Sardines', exact: true }).tap();
  await expect(sardinesQuantity).toHaveValue('5');
  await expect(quantity).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Dismiss notification', exact: true })).toHaveCount(
    0,
  );

  // A newly added item's name, price and controls must fit together on a short desktop.
  // This catches the original layout where focus scrolled the product name out of view.
  await page.setViewportSize({ width: 1280, height: 650 });
  await assertCompactSpace();
  await assertFullyVisible(
    page.locator('.pos-order-line').first(),
    page.locator('.pos-order-lines'),
  );
  await assertFullyVisible(
    page.locator('.pos-order-line').first().getByRole('heading', { name: 'Touch Sardines' }),
    page.locator('.pos-order-lines'),
  );
  await page.setViewportSize({ width: 1440, height: 900 });

  // Opening a keypad starts a replacement; later digits append, and delete removes one digit.
  await page.getByRole('button', { name: 'Open quantity keypad', exact: true }).tap();
  await digits(keypad(), 123);
  await keypad().getByRole('button', { name: 'Delete last digit', exact: true }).tap();
  await applyQuantity(keypad());
  await expect(quantity).toHaveValue('12');
  await page.getByRole('button', { name: 'Open quantity keypad', exact: true }).tap();
  await keypad().getByRole('button', { name: 'Clear quantity', exact: true }).tap();
  await expect(keypad().getByRole('button', { name: 'Use quantity', exact: true })).toBeDisabled();
  await digits(keypad(), 0);
  await expect(keypad().getByRole('button', { name: 'Use quantity', exact: true })).toBeDisabled();
  await keypad().getByRole('button', { name: 'Clear quantity', exact: true }).tap();
  await digits(keypad(), 7);
  await applyQuantity(keypad());
  await expect(quantity).toHaveValue('7');
  for (const value of [1, 2, 5, 10]) {
    await page.getByRole('button', { name: `Set quantity to ${value}`, exact: true }).tap();
    await expect(quantity).toHaveValue(String(value));
  }
  await quantity.fill('2'); // Physical keyboard entry remains available alongside touch controls.
  await scan.fill('4899988877766');
  await scan.press('Enter');
  await expect(sardinesQuantity).toHaveValue('7');
  await expect(quantity).toHaveValue('1');
  console.log(
    'PASS: touch quantity entry, first-digit replacement, multiple digits, delete, clear, presets, and scanning',
  );

  await page.getByRole('button', { name: 'Edit quantity for Touch Sardines', exact: true }).tap();
  await digits(keypad('Edit quantity'), 15);
  await applyQuantity(keypad('Edit quantity'));
  await expect(sardinesQuantity).toHaveValue('15');
  await page.getByRole('button', { name: 'Edit quantity for Touch Sardines', exact: true }).tap();
  await digits(keypad('Edit quantity'), 201);
  await expect(
    keypad('Edit quantity').getByRole('button', { name: 'Use quantity', exact: true }),
  ).toBeDisabled();
  await keypad('Edit quantity').getByRole('button', { name: 'Close dialog', exact: true }).tap();
  await expect(sardinesQuantity).toHaveValue('15');

  await page.getByRole('button', { name: 'Find Product', exact: true }).tap();
  const findDialog = page.getByRole('dialog', { name: 'Find Product', exact: true });
  await findDialog
    .getByRole('textbox', { name: 'Search name, SKU, product code, or barcode' })
    .fill('Touch Flour');
  await findDialog.getByRole('button', { name: 'Open quantity keypad', exact: true }).tap();
  await digits(keypad(), 5);
  await applyQuantity(keypad());
  await expect(findDialog.getByLabel('Quantity to add', { exact: true })).toHaveValue('5');
  await findDialog.getByRole('button', { name: 'Add Touch Flour to order', exact: true }).tap();
  await expect(findDialog.getByLabel('Quantity to add', { exact: true })).toHaveValue('1');
  await findDialog.getByRole('button', { name: 'Back to order', exact: true }).tap();
  await expect(flourQuantity).toHaveValue('5');
  const selectedCustomer = await one(
    db,
    'SELECT id FROM customers WHERE store_id=$1 ORDER BY name LIMIT 1',
    [store.id],
  );
  await page.getByLabel('Customer', { exact: true }).selectOption(selectedCustomer.id);
  await page.locator('.pos-order-discount > summary').tap();
  await page.getByLabel('Custom discount percent', { exact: true }).fill('5');
  await page.locator('.pos-order-discount > summary').tap();
  const details = page.locator('.pos-order-details');
  const linesHeight = await page
    .locator('.pos-order-lines')
    .evaluate((element) => element.clientHeight);
  await details.locator(':scope > summary').tap();
  await expect(details.getByText('Subtotal', { exact: true })).toBeVisible();
  await expect(details.getByText('Discount (5%)', { exact: true })).toBeVisible();
  expect(await page.locator('.pos-order-lines').evaluate((element) => element.clientHeight)).toBe(
    linesHeight,
  );
  await details.locator(':scope > summary').tap();
  await expect(details.getByText('Subtotal', { exact: true })).toBeHidden();
  console.log(
    'PASS: current-order quantity editing, stock-bound rejection, and Find Product keypad',
  );

  // Fill a realistic long order so the footer must remain reachable independently of line scroll.
  const extraProducts = (
    await db.query(
      'SELECT name FROM products WHERE store_id=$1 AND active=true AND stock>0 AND id NOT IN ($2,$3) ORDER BY name LIMIT 12',
      [store.id, sardinesId, flourId],
    )
  ).rows;
  expect(extraProducts.length).toBe(12);
  for (const product of extraProducts)
    await page.getByRole('button', { name: `Add ${product.name}`, exact: true }).tap();
  const cart = page.locator('.cart-panel');
  const lines = cart.locator('.pos-order-lines');
  const charge = cart.getByRole('button', { name: /^Charge / });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 1280, height: 650 },
    { width: 1100, height: 620 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(
      page.getByRole('button', { name: 'Open quantity keypad', exact: true }),
    ).toBeInViewport();
    await expect(scan).toBeInViewport();
    await expect(charge).toBeInViewport();
    await assertCompactSpace();
    await page.locator('.pos-catalog-products').evaluate((element) => {
      element.scrollTop = 0;
    });
    await assertFullyVisible(
      page.locator('.product-card').first(),
      page.locator('.pos-catalog-products'),
    );
    await expect
      .poll(() => lines.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);
    await lines.evaluate((element) => {
      element.scrollTop = 0;
    });
    await assertFullyVisible(lines.locator('.pos-order-line').first(), lines);
    if (viewport.width === 1280)
      await page.screenshot({ path: 'test-results/pos-compact-desktop.png', fullPage: false });
    await lines.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => lines.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await assertFullyVisible(lines.locator('.pos-order-line').last(), lines);
    await expect(charge).toBeInViewport();
    await assertNoOverflow();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.pos-catalog-products').evaluate((element) => {
    element.scrollTop = 0;
  });
  await lines.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: 'test-results/pos-touch-desktop.png', fullPage: false });
  console.log(
    'PASS: short desktop product space, complete cards, and complete first/last order rows',
  );

  const viewOrder = page.getByRole('button', { name: 'View current order', exact: true });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(viewOrder).toBeInViewport();
    await expect
      .poll(() =>
        page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().right),
      )
      .toBeLessThanOrEqual(0);
    await assertNoOverflow();
    if (viewport.width === 390)
      await page.screenshot({ path: 'test-results/pos-compact-mobile.png', fullPage: false });
    await page.getByRole('button', { name: 'Open quantity keypad', exact: true }).tap();
    await expect(
      keypad().getByRole('button', { name: 'Quantity digit 1', exact: true }),
    ).toBeInViewport();
    await expect(
      keypad().getByRole('button', { name: 'Quantity digit 0', exact: true }),
    ).toBeInViewport();
    await expect(
      keypad().getByRole('button', { name: 'Use quantity', exact: true }),
    ).toBeInViewport();
    await assertNoOverflow();
    if (viewport.width === 320)
      await page.screenshot({ path: 'test-results/pos-touch-mobile-keypad.png', fullPage: false });
    await keypad().getByRole('button', { name: 'Close dialog', exact: true }).tap();
    await viewOrder.tap();
    const orderDialog = page.locator('dialog.cart-panel');
    await expect(orderDialog).toBeVisible();
    await expect(sardinesQuantity).toHaveValue('15');
    await expect(flourQuantity).toHaveValue('5');
    await expect(page.getByLabel('Customer', { exact: true })).toHaveValue(selectedCustomer.id);
    await expect(page.getByLabel('Custom discount percent', { exact: true })).toHaveValue('5');
    await expect(charge).toBeInViewport();
    await assertNoOverflow();
    await lines.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(charge).toBeInViewport();
    if (viewport.width === 390)
      await page.screenshot({ path: 'test-results/pos-touch-mobile-order.png', fullPage: false });
    await orderDialog.getByRole('button', { name: 'Continue shopping', exact: true }).tap();
    await expect(orderDialog).toHaveCount(0);
    await expect(viewOrder).toBeInViewport();
    await viewOrder.tap();
    await expect(sardinesQuantity).toHaveValue('15');
    await expect(flourQuantity).toHaveValue('5');
    await orderDialog.getByRole('button', { name: 'Close dialog', exact: true }).tap();
    await expect(orderDialog).toHaveCount(0);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await viewOrder.tap();
  await page.getByRole('button', { name: 'Edit quantity for Touch Flour', exact: true }).tap();
  await digits(keypad('Edit quantity'), 6);
  await applyQuantity(keypad('Edit quantity'));
  await expect(flourQuantity).toHaveValue('6');
  // Resizing while an order is open must not duplicate or discard the basket.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('dialog.cart-panel')).toHaveCount(0);
  await expect(cart).toHaveCount(1);
  await expect(flourQuantity).toHaveValue('6');
  await expect(sardinesQuantity).toHaveValue('15');
  await expect(page.getByLabel('Customer', { exact: true })).toHaveValue(selectedCustomer.id);
  await expect(page.getByLabel('Custom discount percent', { exact: true })).toHaveValue('5');
  await expect(charge).toBeInViewport();
  expect(await page.locator('.pos-order-line').count()).toBe(14);
  // Resizing must not remount the order above an already-open keypad or payment dialog.
  await page.setViewportSize({ width: 390, height: 844 });
  await viewOrder.tap();
  await page.getByRole('button', { name: 'Edit quantity for Touch Flour', exact: true }).tap();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('dialog.cart-panel')).toHaveCount(0);
  await digits(keypad('Edit quantity'), 7);
  await applyQuantity(keypad('Edit quantity'));
  await viewOrder.tap();
  await expect(flourQuantity).toHaveValue('7');
  await charge.tap();
  const payment = page.getByRole('dialog', { name: 'Complete payment', exact: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('dialog.cart-panel')).toHaveCount(0);
  await payment.getByRole('button', { name: 'Back to order', exact: true }).tap();
  await viewOrder.tap();
  await expect(flourQuantity).toHaveValue('7');
  await expect(page.getByLabel('Customer', { exact: true })).toHaveValue(selectedCustomer.id);
  await expect(page.getByLabel('Custom discount percent', { exact: true })).toHaveValue('5');
  expect((await one(db, 'SELECT stock FROM products WHERE id=$1', [sardinesId])).stock).toBe(200);
  expect((await one(db, 'SELECT stock FROM products WHERE id=$1', [flourId])).stock).toBe(20);
  expect(errors).toEqual([]);
  console.log(
    'PASS: independently scrolling order, visible payment footer, mobile order dialog, touch editing, responsive persistence, and overflow checks',
  );
} catch (error) {
  if (page)
    await page
      .screenshot({ path: 'test-results/pos-touch-failure.png', fullPage: false })
      .catch(() => {});
  throw error;
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.close();
}
