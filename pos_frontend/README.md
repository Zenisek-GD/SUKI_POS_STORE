# Suki React frontend

The POS interface lives in `src/pages` with shared components in `src/components`.

```powershell
npm.cmd run dev
npm.cmd run build
npm.cmd run lint
```

Development runs on http://127.0.0.1:5173 and proxies `/api` to the Xianfires backend at http://127.0.0.1:3000. Start the backend as described in the root README. Production assets are written to `dist` and served by the backend.

See `../README.md` for demo credentials, module capabilities, database setup, API conventions, and testing.
