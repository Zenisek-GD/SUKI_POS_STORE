import './config.js';
import { createDatabase, migrate } from './models/database.js';
const db = await createDatabase();
try {
  await migrate(db);
  console.log('POS schema is up to date.');
} finally {
  await db.close();
}
