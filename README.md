# Suki POS & Store Management

A working React application backed by the **Xianfires-generated backend**, with REST endpoints and PostgreSQL storage. The requested projects remain separate: `pos_backend` and `pos_frontend`.

## Run the app

Dependencies are already installed. From the workspace root:

```powershell
npm.cmd run dev
```

Open **http://127.0.0.1:5173**. The backend runs at **http://127.0.0.1:3000**.

Alternatively, run these in separate terminals:

```powershell
npm.cmd run backend
npm.cmd run frontend
```

The first development start copies `pos_backend/.env.example` to `.env`, creates the database schema, and initializes the demo store. Later starts keep your data. On Windows, `npm.cmd` works when PowerShell execution policy blocks `npm.ps1`.

## Demo accounts

The login screen has buttons to fill these credentials. Demo users and sample records are created only in an empty database with `DEMO_MODE=true`.

| Role            | Email                  | Password             |
| --------------- | ---------------------- | -------------------- |
| Store owner     | `owner@suki.store`     | `SukiOwner2026!`     |
| Manager         | `manager@suki.store`   | `SukiManager2026!`   |
| Cashier         | `cashier@suki.store`   | `SukiCashier2026!`   |
| Inventory staff | `inventory@suki.store` | `SukiInventory2026!` |

## Included features

- **Checkout:** search by name, SKU, or barcode; keyboard scanner input; quantity changes; customer selection or walk-in; authorized preset/custom discounts; inclusive/exclusive tax; cash received and change; configurable recorded payment methods; retry-safe checkout.
- **Receipts:** store details, cashier, customer, product lines, discounts, tax, payment, change, and footer. Print through the browser (including Save as PDF) or download an HTML receipt. Store details are captured with the sale, so old receipts retain the original information.
- **Products and categories:** create/edit products and categories, unique SKU/barcode, supplier linkage, product symbols or image URLs, costs, selling prices, stock minimums, units, and archival with history retained.
- **Inventory:** stock-in/out, adjustments, damage and returns; low/out-of-stock alerts; before/change/after quantities, reason, employee, and timestamps for every movement.
- **Transactions:** search, status/payment/date filters, CSV export, receipt retrieval, and manager/owner cancellation that restores inventory once.
- **Purchasing:** supplier records, multi-item orders, payment/receiving statuses, order detail, and transactional receiving that increments stock once and updates product costs.
- **Customers:** contact records, purchase history, optional loyalty points, and purchases without registration.
- **Expenses:** categorized expense entry/editing and inclusion in profit estimates.
- **Dashboard and reports:** current-day metrics, daily sales charts with daily/weekly/monthly ranges, category charts, best sellers, payment distribution, transaction/product/category/cashier reports, inventory, movements, low stock, purchasing, expenses, and profit. Date filters and CSV exports are included.
- **Administration:** employee accounts, four enforced roles, account activation, password changes, store/tax/payment/receipt settings, discount presets, and a read-only audit trail.
- **Responsive interface:** desktop sidebar, mobile navigation, responsive checkout, searchable/paginated tables, accessible form labels, native modal dialogs, loading/error states, and locally bundled fonts.

## Role access

| Module                                     | Owner | Manager | Cashier | Inventory |
| ------------------------------------------ | :---: | :-----: | :-----: | :-------: |
| Dashboard, reports, expenses               |   ✓   |    ✓    |         |           |
| POS and receipts                           |   ✓   |    ✓    |    ✓    |           |
| Sales history                              |  All  |   All   |   Own   |           |
| Cancel sales                               |   ✓   |    ✓    |         |           |
| Customers                                  |   ✓   |    ✓    |    ✓    |           |
| Products, inventory, suppliers, purchasing |   ✓   |    ✓    |         |     ✓     |
| Archive products, update purchase payment  |   ✓   |    ✓    |         |           |
| Team, settings, discounts, audit           |   ✓   |         |         |           |
| Own password                               |   ✓   |    ✓    |    ✓    |     ✓     |

Cashier API responses omit product costs and administrative data. Authorization is enforced by the backend, independently of navigation visibility.

## PostgreSQL configuration

### Local development

With `DATABASE_URL` empty, the app uses **PGlite**, an embedded PostgreSQL engine. Data persists in `pos_backend/.data/suki`. This makes the complete application runnable without a separately installed server. It is a development option; production startup requires a PostgreSQL server connection.

### PostgreSQL server

Create a PostgreSQL database, then set `pos_backend/.env`:

```dotenv
DATABASE_URL=postgresql://postgres:your-password@localhost:5432/pos_store
DEMO_MODE=false
ADMIN_EMAIL=owner@suki.store
ADMIN_PASSWORD=your-unique-password-at-least-12-characters
SESSION_SECRET=your-long-random-session-secret
```

On an empty database, the application initializes a store and the specified owner. Using an existing database preserves its accounts and records; changing environment credentials does not reset an existing owner. To start a fresh local store, point `PGLITE_DIR` to a new directory and set `DEMO_MODE=false` with the admin credentials.

Apply the schema independently with:

```powershell
npm.cmd --prefix pos_backend run migrate
```

The SQL migration creates missing objects without dropping existing data. `DATABASE_URL` selects the live application's external database. The generated Sequelize `models/db.js` and code generators remain available for extending Xianfires; application repositories in `models/database.js` use parameterized PostgreSQL SQL.

For deployment, build the frontend and start the backend:

```powershell
npm.cmd run build
npm.cmd --prefix pos_backend start
```

The backend serves `pos_frontend/dist`. Production requires `NODE_ENV=production`, `DEMO_MODE=false`, `DATABASE_URL`, `SESSION_SECRET`, and an HTTPS `APP_ORIGIN`; configure the host and an HTTPS reverse proxy for the deployment environment. Sessions are stored in the database, expire after 12 hours, and use HttpOnly/SameSite cookies (Secure in production).

## Data and transaction design

```text
pos_backend/
  index.js, start.js         Xianfires entry and startup
  app.js                    Express, .xian engine, sessions, security, static React
  routes/api.js             REST routes and role guards
  controllers/              Authentication, records, reports
  services/                 Atomic sales, stock changes, and purchase receiving
  models/schema.sql         PostgreSQL tables, constraints, indexes, migration record
  models/database.js        PostgreSQL/PGlite connection and transaction adapter
  models/seed.js             Empty-store initialization and optional demo data
  middleware/               Authentication, role guards, persistent session store
  bin/, create.js, views/    Retained Xianfires generator and .xian templates
pos_frontend/
  src/pages/                Store application screens
  src/components/           Layout, forms, dialogs, tables, receipts
  src/lib/                  API, session/store context, fetching, CSV and formatting
tests/
  api.test.js               Financial, stock, permission, and session integration tests
  browser.mjs               Isolated browser workflow and responsive-layout checks
```

- Money is stored and sent by the API as integer minor units (centavos for PHP). Quantities are whole units. Use prepackaged products for fractional weights in this version.
- Store-scoped foreign keys and queries prepare the data model for multiple branches. This version exposes a single store per user and does not include a branch-switching interface.
- Checkout uses server prices, sorted product row locks, and an idempotency key. A failed checkout rolls back the sale, payments, stock movements, points, and audit record together.
- Receiving and cancellation lock their parent records to prevent repeated stock changes. Products are archived rather than deleted, preserving history.
- Expense-adjusted profit is `sales collected − tax − sold-item cost − expenses`. Costs are snapshotted when selling; this version uses the product's current cost, updated on receipt, rather than FIFO or weighted-average accounting.
- Category/product net sales allocate sale-level discounts/tax proportionally and round to minor units. Small allocation rounding differences are possible; sale totals remain authoritative.
- Most record screens show the most recent 1,000 rows with client-side paging. Financial report exports include all matching rows within a date range of up to one year. Inventory reports are current snapshots.
- GCash, Maya, bank transfer, and custom methods **record payments received separately**; they do not initiate or verify payment-provider transfers. Cancellation similarly records a reversal and stock return; the actual refund is handled outside the app.
- Product/store images currently use URLs. Loyalty points are earned and tracked; reward redemption is not included.

## Verification

```powershell
npm.cmd run build
npm.cmd --prefix pos_frontend run lint
npm.cmd test
npm.cmd run test:e2e
```

API and browser tests use fresh, in-memory PostgreSQL databases; they do not change your store data. Browser tests use installed Chrome on Windows, or Playwright's Chromium on other systems. If needed, install the latter using `npx playwright install chromium`. Screenshots and downloaded test artifacts are written under `test-results`.

The API suite covers permissions, CSRF/origin checks, validation, duplicate products, concurrent stock competition, checkout retries, cancellation, purchase receiving, stock ledgers, cross-store references, tax/discount totals, reports, account deactivation, and session invalidation.

## Install on another machine

Node.js 22.12 or newer is recommended for the current Vite release.

```powershell
npm.cmd ci
npm.cmd --prefix pos_backend ci
npm.cmd --prefix pos_frontend ci
```

For backups, use your PostgreSQL server's backup tooling. For local PGlite data, shut down the backend before copying its `.data/suki` directory. Do not run multiple backend processes against the same PGlite directory.

## Xianfires attribution

`pos_backend` was generated with the installed **Xianfires 2.0.9** generator before adding application features. Its Express MVC structure, `.xian` view support, `express-session` authentication approach, and CLI scaffolding remain in place. The original license is preserved in `pos_backend/LICENSE-XIANFIRE` and generated source files. The original welcome view remains at `/xianfire`.
