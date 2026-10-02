import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createDatabase, migrate } from '../pos_backend/models/database.js';
import { seed } from '../pos_backend/models/seed.js';
import { createApp } from '../pos_backend/app.js';

// Desktop CDP does not reproduce Android browser chrome or its on-screen keyboard:
// setVisibleSize and the metrics viewport override leave visualViewport unchanged.
// Control the reported visual rectangle while preserving the larger layout viewport.
const db = await createDatabase({ memory: true });
let browser, server, page;
try {
  await migrate(db);
  await seed(db, { demo: true });
  const origin = 'http://127.0.0.1:3111';
  const app = createApp(db, { demo: true, origin, secret: 'pos-visual-viewport-browser-secret' });
  server = await new Promise((resolve) => {
    const running = app.listen(3111, '127.0.0.1', () => resolve(running));
  });
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(chrome) ? { executablePath: chrome } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 393, height: 780 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() => {
    const viewport = new EventTarget();
    Object.assign(viewport, {
      width: window.innerWidth,
      height: window.innerHeight,
      offsetTop: 0,
      offsetLeft: 0,
      pageTop: 0,
      pageLeft: 0,
      scale: 1,
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    window.setTestVisualViewport = (values, eventType = 'resize') => {
      Object.assign(viewport, values);
      viewport.dispatchEvent(new Event(eventType));
    };
  });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mkdir('test-results', { recursive: true });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Cashier', exact: true }).tap();
  await page.getByRole('button', { name: 'Sign in to your store', exact: true }).tap();

  async function visibleViewport(values, eventType = 'resize') {
    await page.evaluate(
      ({ values, eventType }) => window.setTestVisualViewport(values, eventType),
      { values, eventType },
    );
  }
  async function fullyVisible(locator, label, checkHitTarget = false) {
    await expect(locator).toBeVisible();
    await expect
      .poll(
        () =>
          locator.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const viewport = window.visualViewport;
            return {
              top: bounds.top >= viewport.offsetTop - 1,
              bottom: bounds.bottom <= viewport.offsetTop + viewport.height + 1,
              left: bounds.left >= viewport.offsetLeft - 1,
              right: bounds.right <= viewport.offsetLeft + viewport.width + 1,
            };
          }),
        { message: `${label} must fit completely inside the visible screen` },
      )
      .toEqual({ top: true, bottom: true, left: true, right: true });
    if (checkHitTarget)
      expect(
        await locator.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return element.contains(
            document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
          );
        }),
        `${label} must be reachable by touch`,
      ).toBe(true);
  }

  await visibleViewport({ width: 393, height: 780 });
  await page.locator('.product-card:not(:disabled)').first().tap();
  const viewOrder = page.getByRole('button', { name: 'View current order', exact: true });
  const dock = page.locator('.pos-mobile-checkout');
  await fullyVisible(dock, 'Order dock');
  await fullyVisible(viewOrder, 'View order', true);

  // Browser controls obscure the lower 80px without resizing document layout.
  await visibleViewport({ height: 700 });
  expect(await page.evaluate(() => innerHeight)).toBe(780);
  await fullyVisible(dock, 'Order dock with browser controls');
  await fullyVisible(viewOrder, 'View order with browser controls', true);
  await page.screenshot({ path: 'test-results/pos-viewport-browser-controls.png' });
  await viewOrder.tap();
  const order = page.getByRole('dialog', { name: 'Current order', exact: true });
  const charge = order.getByRole('button', { name: /^Charge / });
  const close = order.getByRole('button', { name: 'Close dialog', exact: true });
  await expect(order.locator('.pos-order-line')).toHaveCount(1);
  await fullyVisible(order, 'Order sheet with browser controls');
  await fullyVisible(charge, 'Charge with browser controls', true);
  await page.screenshot({ path: 'test-results/pos-viewport-single-item-order.png' });

  // Resizing and then panning the visual viewport must update the already-open sheet.
  await visibleViewport({ height: 650 });
  await fullyVisible(charge, 'Charge after visible-height change', true);
  await visibleViewport({ offsetTop: 30 }, 'scroll');
  await fullyVisible(order, 'Order sheet after visual viewport scroll');
  await fullyVisible(close, 'Close order after visual viewport scroll', true);
  await fullyVisible(charge, 'Charge after visual viewport scroll', true);

  // Numeric entry can leave a short visual viewport inside a tall layout viewport.
  await order.locator('.pos-line-stepper input').focus();
  await visibleViewport({ height: 380, offsetTop: 100 });
  await fullyVisible(order, 'Order sheet above the keyboard');
  await fullyVisible(close, 'Close order above the keyboard', true);
  const orderQuantity = order.locator('.pos-line-stepper input');
  await orderQuantity.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await fullyVisible(orderQuantity, 'Quantity above the keyboard', true);
  await fullyVisible(charge, 'Charge above the keyboard', true);
  await page.screenshot({ path: 'test-results/pos-viewport-keyboard.png' });
  await charge.tap();
  const payment = page.getByRole('dialog', { name: 'Complete payment', exact: true });
  await payment.getByLabel('Cash received', { exact: true }).fill('10000');
  const completeSale = payment.getByRole('button', { name: 'Complete sale', exact: true });
  await expect(completeSale).toBeEnabled();
  await fullyVisible(payment, 'Payment dialog above the keyboard');
  await fullyVisible(completeSale, 'Complete sale above the keyboard', true);
  await page.screenshot({ path: 'test-results/pos-viewport-payment-keyboard.png' });
  await payment.getByRole('button', { name: 'Back to order', exact: true }).tap();
  await expect(payment).toHaveCount(0);
  await fullyVisible(charge, 'Charge after closing payment', true);

  await visibleViewport({ height: 780, offsetTop: 0 });
  await fullyVisible(order, 'Order sheet after restoring the viewport');
  await fullyVisible(charge, 'Charge after restoring the viewport', true);
  await close.tap();
  await fullyVisible(dock, 'Order dock after restoring the viewport');
  await fullyVisible(viewOrder, 'View order after restoring the viewport', true);

  await page.setViewportSize({ width: 844, height: 390 });
  await visibleViewport({ width: 844, height: 330, offsetTop: 20 });
  await fullyVisible(dock, 'Landscape order dock');
  await fullyVisible(viewOrder, 'Landscape View order', true);
  await viewOrder.tap();
  await fullyVisible(order, 'Landscape order sheet');
  await fullyVisible(close, 'Landscape close order', true);
  await orderQuantity.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await fullyVisible(orderQuantity, 'Landscape quantity', true);
  await fullyVisible(charge, 'Landscape Charge', true);
  await page.screenshot({ path: 'test-results/pos-viewport-landscape.png' });
  expect(errors).toEqual([]);
  console.log(
    'PASS: full mobile order and payment controls remain visible through browser controls, visual viewport scrolling, keyboard resize, restoration, and landscape',
  );
} catch (error) {
  if (page)
    await page.screenshot({ path: 'test-results/pos-viewport-failure.png' }).catch(() => {});
  throw error;
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.close();
}
