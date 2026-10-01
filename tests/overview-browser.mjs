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
await db.query("UPDATE stores SET created_at='2019-01-01T00:00:00+08:00' WHERE id=$1", [
  owner.store_id,
]);
// Closed periods keep these comparisons independent of today's calendar cutoff.
// The 2023 monthly and daily fixtures add up to exactly 780,000 pesos for the year.
for (const [date, amount] of [
  ['2021-07-01', 90000000],
  ['2022-07-01', 90000000],
  ['2023-01-01', 9000000],
  ['2023-02-01', 7800000],
  ['2023-03-01', 900000],
  ['2023-03-02', 780000],
  ['2023-03-03', 936000],
  ['2023-03-04', 936000],
  ['2023-03-20', 5808000],
  ['2023-04-01', 9360000],
  ['2023-07-01', 42480000],
  ['2024-07-01', 93600000],
]) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO sales(id,store_id,number,user_id,subtotal,total,cost_total,amount_received,receipt_store,idempotency_key,created_at)
    VALUES($1,$2,$3,$4,$5,$5,0,$5,'{}',$6,$7)`,
    [id, owner.store_id, `OVERVIEW-${date}`, owner.id, amount, randomUUID(), `${date}T04:00:00Z`],
  );
}
const origin = 'http://127.0.0.1:3103';
const app = createApp(db, { demo: true, origin, secret: 'isolated-overview-browser-test-secret' });
const server = await new Promise((resolve) => {
  const server = app.listen(3103, '127.0.0.1', () => resolve(server));
});
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let browser, page;

async function expectChange(row, direction, percentage) {
  const change = row.locator(`.overview-change.${direction}`);
  await expect(change).toContainText(percentage);
  const symbol =
    direction === 'increase' ? 'arrow-up' : direction === 'decrease' ? 'arrow-down' : 'minus';
  await expect(change.locator(`svg.lucide-${symbol}`)).toBeVisible();
  await expect(row.locator('.overview-change-label')).toHaveText(
    direction === 'increase' ? 'Increased' : direction === 'decrease' ? 'Decreased' : 'No change',
  );
}

async function expectCompactColumns(calendar, width) {
  await page.setViewportSize({ width, height: 844 });
  const table = calendar.locator('.overview-table');
  await table.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  const headings = table.getByRole('columnheader');
  await expect(headings.nth(1)).toHaveText('Net sales');
  await expect(headings.nth(2)).toHaveText('Change');
  // The primary period, total, and direction must fit without horizontal scrolling.
  for (const index of [0, 1, 2]) {
    const bounds = await headings.nth(index).boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
  }
  const changes = await table.locator('tbody tr').first().locator('.overview-change').boundingBox();
  expect(changes.x).toBeGreaterThanOrEqual(0);
  expect(changes.x + changes.width).toBeLessThanOrEqual(width);
}

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
  const periodRow = (key, drilldown) =>
    calendar.getByRole('row').filter({
      has: page.getByRole('button', { name: `View ${drilldown} for ${key}`, exact: true }),
    });
  const dayRow = (label) =>
    calendar.getByRole('row').filter({ has: page.getByText(label, { exact: true }) });
  const year = periodRow('2023', 'months');
  await expect(year).toContainText('780,000.00');
  await expectChange(year, 'decrease', '-13.33%');
  await expect(year).toContainText('900,000.00');
  await expect(year).toContainText('2022');
  await expectChange(periodRow('2024', 'months'), 'increase', '+20.00%');
  await expectChange(periodRow('2022', 'months'), 'unchanged', '0.00%');
  await expectChange(periodRow('2020', 'months'), 'unchanged', '0.00%');
  await expect(periodRow('2021', 'months').locator('.overview-change.increase')).toContainText(
    'From zero',
  );
  await calendar.getByRole('checkbox', { name: 'Show sales breakdown' }).check();
  await expect(periodRow('2020', 'months')).toContainText('Confirmed zero sales');
  await expect(periodRow('2018', 'months').locator('.overview-change.unavailable')).toContainText(
    'N/A',
  );
  await expect(periodRow('2018', 'months')).toContainText('No recorded history');
  await calendar.getByRole('checkbox', { name: 'Show sales breakdown' }).uncheck();
  await calendar.getByRole('button', { name: 'View months for 2023', exact: true }).click();
  await expect(calendar.getByRole('columnheader', { name: /^Month$/i })).toBeVisible();
  await expect(calendar.getByRole('row')).toHaveCount(13);
  await expectChange(periodRow('2023-02', 'days'), 'decrease', '-13.33%');
  await expect(periodRow('2023-02', 'days')).toContainText('90,000.00');
  await expect(periodRow('2023-02', 'days')).toContainText('2023-01');
  await expectChange(periodRow('2023-03', 'days'), 'increase', '+20.00%');
  await expectChange(periodRow('2023-04', 'days'), 'unchanged', '0.00%');
  await expectChange(periodRow('2023-06', 'days'), 'unchanged', '0.00%');
  for (const width of [390, 320]) await expectCompactColumns(calendar, width);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await calendar.getByRole('button', { name: 'View days for 2023-03', exact: true }).click();
  await expect(calendar.getByRole('columnheader', { name: /^Day$/i })).toBeVisible();
  await expect(calendar.getByRole('row')).toHaveCount(32);
  await expect(
    calendar.getByRole('navigation', { name: 'Sales overview breadcrumbs' }),
  ).toContainText('March');
  await expect(dayRow('Thu, Mar 2')).toContainText('7,800.00');
  await expectChange(dayRow('Thu, Mar 2'), 'decrease', '-13.33%');
  await expect(dayRow('Thu, Mar 2')).toContainText('9,000.00');
  await expect(dayRow('Thu, Mar 2')).toContainText('2023-03-01');
  await expectChange(dayRow('Fri, Mar 3'), 'increase', '+20.00%');
  await expectChange(dayRow('Sat, Mar 4'), 'unchanged', '0.00%');
  await expectChange(dayRow('Mon, Mar 6'), 'unchanged', '0.00%');
  await calendar.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(calendar.getByRole('columnheader', { name: /^Month$/i })).toBeVisible();
  await calendar.getByRole('button', { name: 'All years', exact: true }).click();
  await expect(calendar.getByRole('columnheader', { name: /^Year$/i })).toBeVisible();
  await calendar.getByRole('checkbox', { name: 'Show sales breakdown' }).check();
  await expect(calendar.getByText('No recorded history', { exact: true })).toBeVisible();
  await expect(calendar.getByText('In progress', { exact: true })).toBeVisible();
  await calendar.getByRole('checkbox', { name: 'Show sales breakdown' }).uncheck();
  await mkdir('test-results', { recursive: true });
  await calendar.screenshot({ path: 'test-results/sales-overview-desktop.png' });
  for (const width of [390, 320]) await expectCompactColumns(calendar, width);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reports & insights' })).toBeVisible();
  await calendar.getByRole('button', { name: 'View months for 2023', exact: true }).click();
  await calendar.getByRole('button', { name: 'View days for 2023-03', exact: true }).click();
  await expect(calendar.getByRole('columnheader', { name: /^Day$/i })).toBeVisible();
  await expectChange(dayRow('Thu, Mar 2'), 'decrease', '-13.33%');
  for (const width of [320, 390]) await expectCompactColumns(calendar, width);
  await expect(calendar.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
  await calendar.scrollIntoViewIfNeeded();
  await calendar.locator('.overview-table').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await calendar.screenshot({ path: 'test-results/sales-overview-mobile.png' });
  expect(errors).toEqual([]);
  console.log(
    'PASS: year/month/day up, down, unchanged symbols and percentages; 900k to 780k = 13.33% down; confirmed zero versus missing history; drill-down and Back; Dashboard and Reports; visible mobile totals/change at 390px and 320px; no browser errors',
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
