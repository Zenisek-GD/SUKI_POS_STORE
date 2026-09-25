import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const children = [
  spawn(process.execPath, ['index.js'], { cwd: resolve('pos_backend'), stdio: 'inherit' }),
  spawn(process.execPath, [resolve('pos_frontend/node_modules/vite/bin/vite.js')], {
    cwd: resolve('pos_frontend'),
    stdio: 'inherit',
  }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill());
  process.exit(code);
}
children.forEach((child) => child.on('exit', (code) => stop(code ?? 0)));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
