import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function createDatabase({
  url = process.env.DATABASE_URL,
  directory = process.env.PGLITE_DIR,
  memory = false,
} = {}) {
  if (url && !memory) {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    pool.on('error', (error) => console.error('Database connection error:', error.message));
    return {
      kind: 'PostgreSQL',
      query: (sql, args = []) => pool.query(sql, args),
      close: () => pool.end(),
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const value = await fn(client);
          await client.query('COMMIT');
          return value;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
    };
  }
  const path = directory
    ? resolve(directory)
    : fileURLToPath(new URL('../.data/suki', import.meta.url));
  if (!memory) await mkdir(path, { recursive: true });
  const db = new PGlite(memory ? undefined : path);
  await db.waitReady;
  return {
    kind: 'Embedded PostgreSQL',
    query: (sql, args = []) => db.query(sql, args),
    transaction: (fn) => db.transaction(fn),
    close: () => db.close(),
  };
}
export const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
export async function migrate(db) {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await db.transaction((tx) => (tx.exec ? tx.exec(sql) : tx.query(sql)));
}
