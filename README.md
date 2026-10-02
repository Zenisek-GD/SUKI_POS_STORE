# Suki POS Store

Suki POS Store is a web-based point-of-sale and store management system for small retail businesses. It connects checkout, inventory, purchasing, customer records, and reporting in one workspace for store owners and staff.

> **Database implementation note:** The current repository uses **PostgreSQL**, with **PGlite (embedded PostgreSQL)** for local development. MySQL is mentioned in the project brief, but it is not implemented in this codebase. The instructions below document the working application; using MySQL would require changes to the database adapter and SQL schema.

## About the Project

### Purpose

Suki POS Store helps businesses organize daily operations that would otherwise be spread across handwritten logs, receipts, and separate spreadsheets. Sales connect to stock movements and transaction history, making it easier to review what was sold, monitor available inventory, and investigate discrepancies.

The intended users are store owners, managers, cashiers, and inventory staff. The interface supports desktop, tablet, and mobile workflows.

### Goals

- Make product selection, checkout, payment recording, and receipt generation easier.
- Maintain consistent stock records across sales, received purchases, adjustments, and returns.
- Organize product, customer, supplier, and expense information in one place.
- Provide sales summaries, stock alerts, and profit estimates for operational decisions.
- Support accountability through staff permissions and activity history.

## Features

### Sales and Customer Service

- Search products by name, SKU, product code, or barcode; support keyboard-based barcode scanning.
- Enter quantities with numeric inputs, shortcuts, or an on-screen keypad.
- Save favorite products, review orders, and void unpaid items or orders.
- Select a customer or complete a walk-in purchase.
- Apply permitted discounts, calculate tax, and record cash or configured non-cash payments.
- Generate receipts for printing or HTML download, and export transaction records as CSV.
- Retrieve receipts and record eligible partial or full returns within 24 hours of purchase.
- Maintain customer details, purchase history, and optional loyalty point tracking.

### Products, Inventory, and Purchasing

- Manage products, categories, prices, units, barcodes, and generated product codes.
- Archive products while preserving transaction history.
- Review low-stock alerts and product movement history.
- Record stock adjustments, damage, received purchases, and returns.
- Track damaged or defective returned stock separately from sellable stock.
- Manage suppliers, purchase orders, receiving, and purchase payment status.

### Reporting and Administration

- Review sales summaries with year, month, and day comparisons.
- View sales, returns, inventory, purchasing, expense, and estimated-profit reports.
- Record operating expenses and export report data.
- Manage employee accounts, access roles, store settings, and discount presets.
- Review an owner-accessible audit trail.

Payments and refunds are recorded by the system; the actual money transfer occurs through the store's cash or external payment process. Quantities use whole units. Loyalty reward redemption and a branch-switching interface are not included.

## Technology Stack

### Frontend

- **React** and **JavaScript** for application screens and interaction.
- **HTML5** and **CSS3** for structure, styling, and responsive layouts.
- **React Router** for navigation.
- **Lucide React** for icons.
- **Vite** and its React plugin for development and production builds.
- **Fontsource DM Sans and Manrope** for locally bundled fonts.

### Backend

- **Xianfires / XianFire**, with the generated Express MVC structure and `.xian` view support retained.
- **Node.js** and **Express** for the REST API.
- **express-session** with a database session store for authentication sessions.
- **bcrypt** for password hashing and **Zod** for input validation.
- **Helmet** and **express-rate-limit** for HTTP protections and sign-in throttling.
- **dotenv** for environment configuration and **hbs** for retained framework views.

Sequelize remains in the framework scaffolding. The active POS services use the database adapter in `pos_backend/models/database.js`.

### Database

- **PostgreSQL**, connected through `pg`, for an external database server.
- **PGlite**, through `@electric-sql/pglite`, for persistent local development without a separate server.
- A SQL schema and migration history in `pos_backend/models/schema.sql`.

MySQL is not a supported runtime for the current implementation.

### Development Tools

- **Git and GitHub** for version control and repository hosting.
- **Visual Studio Code** as the development editor.
- **npm** for dependency installation and project scripts.
- **Playwright**, **Supertest**, and the **Node.js test runner** for verification.
- **Prettier** and **Oxlint** for formatting and linting.

## System Architecture

```text
React frontend (Vite development server, port 5173)
                       |
          JSON requests to /api/*
          Session cookie + CSRF token
                       |
             Vite development proxy
                       |
Xianfires / Express backend (port 3000)
                       |
      Routes -> Controllers / Services
                       |
           models/database.js
                       |
          +------------+------------+
          |                         |
 PostgreSQL server           Local PGlite
 DATABASE_URL set            DATABASE_URL empty
```

React uses the shared API helper in `pos_frontend/src/lib/api.js`. The backend validates input, checks authentication and role permissions, and applies database transactions for sales, stock changes, receiving, and returns. The frontend does not connect directly to the database.

## Project Structure

```text
SUKI_POS_STORE/
├── pos_frontend/
│   ├── public/
│   ├── src/
│   │   ├── assets/
│   │   ├── components/
│   │   ├── lib/
│   │   └── pages/
│   ├── index.html
│   ├── package.json
│   ├── vercel.json
│   └── vite.config.js
├── pos_backend/
│   ├── bin/
│   ├── controllers/
│   ├── middleware/
│   ├── models/
│   │   ├── database.js
│   │   ├── schema.sql
│   │   └── seed.js
│   ├── public/
│   ├── routes/
│   ├── services/
│   ├── views/
│   ├── .env.example
│   ├── app.js
│   ├── config.js
│   ├── index.js
│   ├── migrate.js
│   ├── start.js
│   ├── LICENSE-XIANFIRE
│   └── package.json
├── scripts/
│   └── dev.mjs
├── tests/
├── .gitignore
├── package.json
├── package-lock.json
├── render.yaml
└── README.md
```

The root, frontend, and backend each have their own dependency lockfile. Generated dependencies, builds, local data, and test artifacts are excluded from version control.

## System Requirements

| Software        | Requirement                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Node.js         | Version **22.12.0 or later within Node 22.x**; both application packages declare `>=22.12.0 <23`.                               |
| npm             | Use the npm installation bundled with the supported Node.js version.                                                            |
| Git             | Required to clone and manage the repository.                                                                                    |
| Browser         | A modern browser for the React interface.                                                                                       |
| Database        | PGlite is installed through npm for local use. A PostgreSQL server is required when using `DATABASE_URL`, including production. |
| Editor          | Visual Studio Code or another editor.                                                                                           |
| Browser testing | Installed Google Chrome on Windows, or Playwright Chromium.                                                                     |

The existing Xianfires backend runs on Node.js. Its required packages are installed with npm; a global framework installation is not needed to run this repository. MySQL Server is not required by the current code.

## Installation and Setup

### 1. Clone the Repository

```bash
git clone https://github.com/Zenisek-GD/SUKI_POS_STORE.git
cd SUKI_POS_STORE
npm ci
```

Run the following setup steps from the repository root unless a command changes directories. On Windows PowerShell, use `npm.cmd` instead of `npm` if script execution policy blocks `npm.ps1`.

### 2. Frontend Setup

```bash
cd pos_frontend
npm ci
cd ..
```

No frontend `.env` file is required for the default local setup. Vite forwards `/api` requests to `http://127.0.0.1:3000`.

### 3. Backend Setup

```bash
cd pos_backend
npm ci
cd ..
```

For a fresh clone, copy the example configuration:

```bash
cp pos_backend/.env.example pos_backend/.env
```

`cp` also works as an alias in PowerShell. Skip this copy if you already have a configured `.env`. The backend can create the file automatically on its first development start if it is missing.

Review the database and environment sections below before starting. The default example enables demo mode and uses local PGlite.

### 4. Start the Application

```bash
npm run dev
```

This starts the backend and frontend together. On a new database, the backend creates the schema and initializes demo data before accepting requests.

Open **http://127.0.0.1:5173**. Stop the development processes with **Ctrl+C**.

## Database Setup

### Option A: Local PGlite

This is the default development configuration in `pos_backend/.env`:

```dotenv
DATABASE_URL=
PGLITE_DIR=
DEMO_MODE=true
```

No separate database service or SQL import is needed. On startup, data is stored in `pos_backend/.data/suki` and persists across restarts. `PGLITE_DIR` optionally selects another directory; relative paths resolve from the backend's working directory.

Run only one backend process against a given PGlite directory. Stop that process before making a filesystem copy for backup.

### Option B: PostgreSQL Server

Start your PostgreSQL service and connect using an account permitted to create databases:

```bash
psql -U postgres
```

Create the database in the PostgreSQL prompt, then exit:

```sql
CREATE DATABASE pos_store;
```

```text
\q
```

Set the connection string in `pos_backend/.env`, replacing the placeholders with your local database account:

```dotenv
DATABASE_URL=postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5432/pos_store
```

URL-encode reserved characters in the username or password. The database must exist before starting the backend; the application creates its tables, not the database itself.

### Migrations and Sample Data

Every backend start applies `pos_backend/models/schema.sql` and then runs initialization from `pos_backend/models/seed.js`. Existing store records are preserved.

To apply only the schema from the repository root:

```bash
npm --prefix pos_backend run migrate
```

Stop a backend using the same PGlite directory before running this standalone command. There is no separate npm seed command: initialization happens at backend startup.

- With `DEMO_MODE=true`, an empty database receives demo accounts and sample store records.
- With `DEMO_MODE=false`, an empty database receives one owner account using `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_NAME`.
- Once a store exists, changing demo mode or administrator environment values does not reseed data or reset existing accounts.

To initialize a fresh store without demonstration data, configure an empty database or a new local data directory and set:

```dotenv
DEMO_MODE=false
ADMIN_EMAIL=owner@example.com
ADMIN_PASSWORD=<YOUR_UNIQUE_PASSWORD>
ADMIN_NAME=Store Owner
```

Replace the password placeholder with a unique password of 12–72 characters before startup.

## Environment Variables

Configuration is loaded from `pos_backend/.env`. This development example contains no live credentials:

```dotenv
NODE_ENV=development
PORT=3000
HOST=127.0.0.1
APP_ORIGIN=http://127.0.0.1:5173
SESSION_SECRET=
DEMO_MODE=true
DATABASE_URL=
PGLITE_DIR=
ADMIN_EMAIL=
ADMIN_PASSWORD=
ADMIN_NAME=Store Owner
```

| Variable                                      | Purpose                                                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                    | Enables production configuration checks when set to `production`.                                    |
| `PORT`, `HOST`                                | Backend listening port and network address.                                                          |
| `APP_ORIGIN`                                  | Expected frontend origin; use the local frontend URL during development.                             |
| `SESSION_SECRET`                              | Session signing secret. A blank value is generated and saved automatically during local development. |
| `DEMO_MODE`                                   | Enables demo initialization for an empty database; production requires `false`.                      |
| `DATABASE_URL`                                | PostgreSQL connection string. Leave empty for local PGlite; required in production.                  |
| `PGLITE_DIR`                                  | Optional local PGlite storage directory.                                                             |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Owner details for initializing an empty store without demo data.                                     |

The example file also includes `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` for retained Sequelize scaffolding. The active POS database adapter uses **`DATABASE_URL`**, so changing those individual fields does not configure the running API.

Keep `.env` out of Git. For production, supply a PostgreSQL connection, a private session secret, `DEMO_MODE=false`, and an HTTPS `APP_ORIGIN` without a path or query. Use `HOST=0.0.0.0` when the hosting platform requires it.

## How to Run the System

### Start Both Services Together

1. Start PostgreSQL if using an external database. PGlite requires no separate service.
2. Run `npm run dev` from the repository root.
3. Wait for the backend initialization and Vite startup messages.
4. Open the frontend URL and sign in.

### Start Services Separately

In the first terminal, from the repository root:

```bash
npm run backend
```

This runs the backend's `xian` script through Nodemon. Wait for the API startup message, then use a second terminal:

```bash
npm run frontend
```

Do not run these alongside the combined `npm run dev` command.

| Service                        | Default local URL                |
| ------------------------------ | -------------------------------- |
| React application              | http://127.0.0.1:5173            |
| Backend API                    | http://127.0.0.1:3000/api        |
| Health check                   | http://127.0.0.1:3000/api/health |
| Retained XianFire welcome view | http://127.0.0.1:3000/xianfire   |

The health endpoint should return JSON with `"status":"ok"`. If either port is occupied, stop the conflicting process. If you change the backend port, update the frontend proxy in `pos_frontend/vite.config.js` as well.

### Build and Verify

```bash
npm run build
npm --prefix pos_frontend run lint
npm test
npm run test:e2e
```

Build before browser testing. Tests use isolated databases and write artifacts to `test-results/`. If Playwright Chromium is needed, install it with:

```bash
npx playwright install chromium
```

After a build, `npm --prefix pos_backend start` starts the backend without Nodemon and serves the built frontend from `pos_frontend/dist` at the backend URL.

The repository also contains Render backend configuration in `render.yaml` and Vercel frontend configuration in `pos_frontend/vercel.json`. For that deployment, use `pos_backend` and `pos_frontend` as the respective service roots, configure the backend environment variables above, and keep the frontend API rewrite aligned with the backend address. The frontend production origin must match `APP_ORIGIN`.

## User Roles and Permissions

| Role                          | Access and responsibilities                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| Store owner (`admin`)         | All store modules, employee management, store settings, discount presets, and audit history. |
| Manager (`manager`)           | Sales, returns, customers, products, inventory, suppliers, purchases, expenses, and reports. |
| Cashier (`cashier`)           | Checkout, customers, receipts, returns, and a list of their own sales.                       |
| Inventory staff (`inventory`) | Products, categories, stock movements, suppliers, purchase orders, and receiving.            |

Only owners manage employee access and store settings. The dedicated Archive action and purchase payment updates are available to owners and managers. Inventory staff can edit product availability. All roles can change their own password.

Cashiers can look up another cashier's receipt within the same store to process a return. Permissions are enforced by the backend as well as the interface.

## API Overview

The application uses JSON REST endpoints under `/api`. React sends same-origin requests through the development proxy or deployment rewrite. Authentication uses a session cookie; authenticated write requests also require the `x-csrf-token` supplied through the authentication flow.

| Module                      | Important endpoints                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Health                      | `GET /api/health`                                                                                                                                      |
| Authentication              | `GET /api/auth/info`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/password`                                   |
| Initial store data          | `GET /api/bootstrap`                                                                                                                                   |
| Sales and receipts          | `GET /api/sales`, `POST /api/sales`, `GET /api/sales/lookup`, `GET /api/sales/:id`                                                                     |
| Returns                     | `POST /api/sales/:id/returns`                                                                                                                          |
| Inventory                   | `GET /api/inventory/movements`, `GET /api/inventory/products/:id/movements`, `POST /api/inventory/adjust`                                              |
| Purchasing                  | `POST /api/purchases`, `GET /api/purchases/:id/items`, `POST /api/purchases/:id/receive`, `PATCH /api/purchases/:id/payment`                           |
| Record creation and updates | `POST /api/:entity`, `PUT /api/:entity/:id` for supported entities such as products, categories, customers, suppliers, expenses, users, and discounts. |
| Product archival            | `DELETE /api/products/:id`                                                                                                                             |
| Reports                     | `GET /api/reports`, `GET /api/reports/overview`                                                                                                        |
| Administration              | `GET /api/audit`, `PUT /api/settings`                                                                                                                  |

See [API routes](pos_backend/routes/api.js) and [validation schemas](pos_backend/validation.js) for accepted requests. Entity-specific permissions also apply to the shared record endpoints. Many lists arrive through `/api/bootstrap`; do not assume a separate `GET` route exists for every entity.

## Database Overview

The schema is defined in [schema.sql](pos_backend/models/schema.sql).

| Tables                            | Purpose                                                           |
| --------------------------------- | ----------------------------------------------------------------- |
| `stores`, `store_settings`        | Store identity and operational settings.                          |
| `roles`, `users`, `sessions`      | Employee roles, accounts, and authenticated sessions.             |
| `categories`, `products`          | Product organization, pricing, identifiers, and stock counters.   |
| `customers`, `suppliers`          | Customer and supplier records.                                    |
| `discounts`                       | Configured discount presets.                                      |
| `sales`, `sale_items`, `payments` | Completed sale records, purchased lines, and payment records.     |
| `sales_returns`, `return_items`   | Returns linked to original sales, conditions, and refund amounts. |
| `inventory_transactions`          | Stock movement history and references.                            |
| `purchases`, `purchase_items`     | Supplier orders and ordered product lines.                        |
| `expenses`                        | Recorded operating expenses.                                      |
| `audit_logs`                      | Staff activity history.                                           |
| `schema_migrations`               | Applied schema version history.                                   |

Money is stored as integer minor units, such as centavos for PHP. Stock quantities are whole numbers. Transactional services keep related sale, payment, inventory, and return changes together.

## Sample Accounts

These public accounts are defined in the demo seed and are **for local testing or demonstration only**. They are created only when `DEMO_MODE=true` initializes an empty database. They are not production account credentials.

| Role            | Email                  | Demo password        |
| --------------- | ---------------------- | -------------------- |
| Store owner     | `owner@suki.store`     | `SukiOwner2026!`     |
| Manager         | `manager@suki.store`   | `SukiManager2026!`   |
| Cashier         | `cashier@suki.store`   | `SukiCashier2026!`   |
| Inventory staff | `inventory@suki.store` | `SukiInventory2026!` |

The demo login screen includes buttons to fill these details. A store initialized with `DEMO_MODE=false` uses the owner account configured during its first startup instead.

## Guidelines for Use

1. Use your assigned account and review product prices, units, stock, and store settings before processing sales.
2. Enter positive whole-number quantities and check the complete order before selecting **Charge**. On mobile, use **View order** to review the basket.
3. Confirm receipt of payment through the store's cash or payment channel before completing a sale.
4. Correct unpaid orders with void actions. For completed sales, locate the original receipt and follow the return workflow and enabled conditions within the 24-hour window.
5. Record stock changes and expenses promptly, provide adjustment reasons, and compare recorded quantities with physical stock.
6. Review the selected reporting dates and treat profit figures as estimates based on recorded information.
7. Sign out after using shared devices and report record or access issues to the store owner.

## Screenshots

Add screenshots of the following screens when preparing the repository for presentation. No application screenshots are currently tracked in Git; the placeholders below intentionally avoid broken image links.

| Screen          | Suggested screenshot                                 | Status      |
| --------------- | ---------------------------------------------------- | ----------- |
| Login           | Sign-in screen and demonstration role choices.       | To be added |
| Dashboard       | Sales summary and calendar sales overview.           | To be added |
| User management | Team members and role assignment.                    | To be added |
| Point of sale   | Product catalog, current order, and mobile checkout. | To be added |
| Inventory       | Stock list and product movement history.             | To be added |
| Reports         | Report filters, summary, and results.                | To be added |

Browser tests generate local screenshots in the ignored `test-results/` directory. Review screenshots for private data before adding selected images to version control, then replace the relevant placeholder with a relative Markdown image link.

## Developers / Contributors

- **Gerald De Palubos / Zenisek-GD** — project contributor names recorded in the repository's Git history.
- **Christian I. Cabrera** — XianFire framework author credited in the retained backend license.

## Academic Purpose

This project supports academic work in **ITE 413 — Integrative Programming and Technologies 2**. It demonstrates frontend and backend integration, REST API communication, database transactions, authentication, role permissions, and responsive interface development through a retail management application.

## License

XianFire-derived backend code includes an **MIT license** and attribution in [pos_backend/LICENSE-XIANFIRE](pos_backend/LICENSE-XIANFIRE).

No separate repository-wide license is currently included. The framework license should not be treated as a license declaration for all original Suki POS Store code.
