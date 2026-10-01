import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createDatabase, migrate, one } from '../pos_backend/models/database.js';
import { seed } from '../pos_backend/models/seed.js';
import { createApp } from '../pos_backend/app.js';

const db = await createDatabase({ memory: true });
await migrate(db);
await seed(db, { demo: true });
const owner = await one(db, "SELECT * FROM users WHERE role='admin'");
await db.query("UPDATE stores SET created_at='2021-01-01T00:00:00+08:00' WHERE id=$1", [
  owner.store_id,
]);
for (const [year, amount] of [
  [2022, 90000000],
  [2023, 78000000],
]) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO sales(id,store_id,number,user_id,subtotal,total,cost_total,amount_received,receipt_store,idempotency_key,created_at)
    VALUES($1,$2,$3,$4,$5,$5,0,$5,'{}',$6,$7)`,
    [
      id,
      owner.store_id,
      `OVERVIEW-${year}`,
      owner.id,
      amount,
      randomUUID(),
      `${year}-07-01T04:00:00Z`,
    ],
  );
}
const origin = 'http://127.0.0.1:3103';
const app = createApp(db, { demo: true, origin, secret: 'isolated-overview-browser-test-secret' });
const server = await new Promise((resolve) => {
  const server = app.listen(3103, '127.0.0.1', () => resolve(server));
});
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let browser, page;
try {
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(chrome) ? { executablePath: chrome } : {}),
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole('button', { name: 'Store owner', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in to your store' }).click();
  await expect(page.getByRole('heading', { name: 'A good day for business.' })).toBeVisible();
  const calendar = page.getByRole('region', { name: 'Calendar sales overview' });
  const year = calendar
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: 'View months for 2023', exact: true }) });
  await expect(year).toContainText('780,000.00');
  await expect(year.locator('.overview-change.decrease')).toContainText('-13.33%');
  await calendar.getByRole('button', { name: 'View months for 2023', exact: true }).click();
  await expect(calendar.getByRole('columnheader', { name: /^Month$/i })).toBeVisible();
  await expect(calendar.getByRole('row')).toHaveCount(13);
  await calendar.getByRole('button', { name: 'View days for 2023-07', exact: true }).click();
  await expect(calendar.getByRole('columnheader', { name: /^Day$/i })).toBeVisible();
  await expect(calendar.getByRole('row')).toHaveCount(32);
  await expect(
    calendar.getByRole('navigation', { name: 'Sales overview breadcrumbs' }),
  ).toContainText('July');
  await expect(calendar.getByRole('row').filter({ hasText: 'Sat, Jul 1' }).first()).toContainText(
    '780,000.00',
  );
  await calendar.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(calendar.getByRole('columnheader', { name: /^Month$/i })).toBeVisible();
  await calendar.getByRole('button', { name: 'All years', exact: true }).click();
  await expect(calendar.getByRole('columnheader', { name: /^Year$/i })).toBeVisible();
  await expect(calendar.getByText('No recorded history', { exact: true })).toBeVisible();
  await expect(calendar.getByText('In progress', { exact: true })).toBeVisible();
  await mkdir('test-results', { recursive: true });
  await calendar.screenshot({ path: 'test-results/sales-overview-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reports & insights' })).toBeVisible();
  await calendar.getByRole('button', { name: 'View months for 2023', exact: true }).click();
  await calendar.getByRole('button', { name: 'View days for 2023-07', exact: true }).click();
  await expect(calendar.getByRole('columnheader', { name: /^Day$/i })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(calendar.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
  await calendar.screenshot({ path: 'test-results/sales-overview-mobile.png' });
  expect(errors).toEqual([]);
  console.log(
    'PASS: yearly 13.33% decrease, year/month/day drill-down, breadcrumbs, Back, coverage labels, Dashboard and Reports, mobile layout, no browser errors',
  );
} catch (error) {
  if (page) {
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/overview-failure.png', fullPage: true });
  }
  throw error;
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
