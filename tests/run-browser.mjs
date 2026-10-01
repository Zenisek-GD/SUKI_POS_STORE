import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const file of [
  'browser.mjs',
  'checkout-browser.mjs',
  'pos-touch.browser.mjs',
  'compact-pages.browser.mjs',
  'store-operations.browser.mjs',
  'overview-browser.mjs',
]) {
  console.log(`Running ${file}`);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(file, import.meta.url))], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
