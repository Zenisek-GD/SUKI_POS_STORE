import { demo, production } from './config.js';
import { createDatabase, migrate } from './models/database.js';
import { seed } from './models/seed.js';
import { createApp } from './app.js';
const db = await createDatabase();
await migrate(db);
await seed(db, { demo });
const app = createApp(db, { demo, production });
const port = Number(process.env.PORT || 3000),
  host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () =>
  console.log(
    `Suki POS · XianFire · ${db.kind}\nAPI: http://${host}:${port}\n${demo ? 'Demo store enabled. Sign in with the accounts shown on the login screen.' : ''}`,
  ),
);
server.on('error', async (error) => {
  console.error(error.message);
  await db.close();
  process.exit(1);
});
async function stop() {
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
export default app;
