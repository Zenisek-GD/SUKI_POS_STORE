import dotenv from 'dotenv';
import { existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const env = fileURLToPath(new URL('./.env', import.meta.url));
if (process.env.NODE_ENV !== 'production' && !existsSync(env))
  copyFileSync(new URL('./.env.example', import.meta.url), env);
dotenv.config({ path: env });
export const production = process.env.NODE_ENV === 'production';
// Keep local database-backed sessions valid across backend restarts.
if (!production && !process.env.SESSION_SECRET) {
  const secret = randomBytes(48).toString('hex');
  const contents = readFileSync(env, 'utf8');
  writeFileSync(
    env,
    /^SESSION_SECRET=.*$/m.test(contents)
      ? contents.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`)
      : `${contents}\nSESSION_SECRET=${secret}\n`,
  );
  process.env.SESSION_SECRET = secret;
}
export const demo = process.env.DEMO_MODE === 'true';
if (production && process.env.APP_ORIGIN) {
  try {
    const origin = new URL(process.env.APP_ORIGIN);
    if (
      origin.protocol !== 'https:' ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    )
      throw new Error('Invalid origin');
    process.env.APP_ORIGIN = origin.origin;
  } catch {
    throw new Error('APP_ORIGIN must be your HTTPS frontend origin, without a path or query.');
  }
}
if (
  production &&
  (!process.env.DATABASE_URL ||
    !process.env.SESSION_SECRET ||
    demo ||
    !process.env.APP_ORIGIN?.startsWith('https://'))
)
  throw new Error(
    'Production requires DATABASE_URL, SESSION_SECRET, HTTPS APP_ORIGIN, and DEMO_MODE=false.',
  );
