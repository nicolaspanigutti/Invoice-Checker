# Invoice Checker

A self-hosted, open-source tool for corporate legal departments to review law firm invoices, detect billing errors, and ensure compliance with agreed commercial terms.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-24-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)

---

## What it does

Legal teams routinely overpay law firms due to billing errors, rate overcharges, and non-compliant line items. Invoice Checker automates the review process:

- **AI extraction** — parse invoice PDFs and images into structured line items
- **Rule engine** — 17 objective rules + 7 AI-assisted grey rules check every line
- **Issue tracking** — reviewers confirm, waive, or dispute each flagged item
- **Reports** — export PDF review reports and draft dispute emails
- **Audit trail** — every action is logged with actor, timestamp, and reason

### BYOT (Bring Your Own Token)

Invoice Checker uses your own OpenAI API key. Nothing is routed through a shared backend — your invoices and your keys stay under your control.

---

## Key features

| Feature | Details |
|---------|---------|
| Auth | Email/password, server-side sessions |
| Roles | `super_admin`, `legal_ops`, `internal_lawyer` |
| Invoice upload | PDF, DOCX, image (stored in object storage) |
| AI extraction | GPT-4o-mini parses invoice fields and line items |
| Rule engine | Objective rules (rate variance, arithmetic, duplicates…) + AI grey rules (seniority overkill, scope creep…) |
| Panel rates | Upload and manage agreed panel rate schedules |
| Engagement letters | Upload T&C and engagement letters per firm for compliance checks |
| Dispute workflow | Per-issue decisions with evidence and recoverable amounts |
| Reporting | PDF report + AI-drafted dispute email |
| Audit trail | Full log of every action |

---

## Tech stack

- **Backend**: Node.js 24, Express 5, TypeScript
- **Database**: PostgreSQL + Drizzle ORM
- **Frontend**: React + Vite + Tailwind CSS (shadcn/ui)
- **AI**: OpenAI API (user-provided key, gpt-4o / gpt-4o-mini)
- **File storage**: Google Cloud Storage (presigned URLs)
- **Auth**: bcryptjs + express-session + connect-pg-simple
- **Monorepo**: pnpm workspaces

---

## Prerequisites

- [Node.js 24+](https://nodejs.org)
- [pnpm 9+](https://pnpm.io) (`npm install -g pnpm`)
- [PostgreSQL 16+](https://www.postgresql.org)
- An [OpenAI API key](https://platform.openai.com/api-keys) (each user provides their own via the Settings page)
- A [Google Cloud Storage](https://cloud.google.com/storage) bucket (for invoice file storage)

---

## Getting started

### 1. Clone the repository

```bash
git clone https://github.com/your-username/invoice-checker.git
cd invoice-checker
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Set up environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

See [Environment variables](#environment-variables) below for a full reference.

### 4. Set up the database

Create a PostgreSQL database, then run:

```bash
pnpm --filter @workspace/db run push
```

### 5. Seed the initial admin user

The server seeds itself on first start if the users table is empty. Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_NAME` in your environment before starting.

### 6. Start the development server

```bash
# Terminal 1 — API server
pnpm --filter @workspace/api-server run dev

# Terminal 2 — Frontend
pnpm --filter @workspace/invoice-checker run dev
```

The app will be available at the URL shown by the frontend Vite server.

### 7. Add your OpenAI key

Log in with your admin credentials, go to **Settings** in the sidebar, and enter your OpenAI API key (`sk-...`). Each user on the platform adds their own key — it is encrypted at rest.

---

## Environment variables

Create a `.env` file at the project root (or set these in your hosting environment):

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string, e.g. `postgresql://user:pass@localhost:5432/invoice_checker` |
| `OPENAI_ENCRYPTION_KEY` | 32-byte key for encrypting user OpenAI keys at rest (64 hex chars). Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_EMAIL` | Email address for the initial admin account (used on first run only) |
| `ADMIN_PASSWORD` | Password for the initial admin account (used on first run only) |
| `ADMIN_NAME` | Display name for the initial admin account (used on first run only) |

### For file storage (Google Cloud Storage)

| Variable | Description |
|----------|-------------|
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | GCS bucket name |
| `PRIVATE_OBJECT_DIR` | Private directory prefix inside the bucket |
| `PUBLIC_OBJECT_SEARCH_PATHS` | Comma-separated public path prefixes |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Port for the API server | `8080` |
| `SESSION_SECRET` | Secret for signing session cookies | Random (insecure — always set in production) |
| `NODE_ENV` | `development` or `production` | `development` |

---

## Scripts

```bash
# Push database schema changes
pnpm --filter @workspace/db run push

# Regenerate API client and Zod schemas from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen

# Run all tests
pnpm run test

# Typecheck the whole monorepo
pnpm run typecheck
```

---

## Project structure

```
artifacts/
  api-server/         # Express 5 REST API
  invoice-checker/    # React + Vite frontend
lib/
  api-spec/           # OpenAPI spec + Orval codegen config
  api-client-react/   # Generated React Query hooks
  api-zod/            # Generated Zod schemas
  db/                 # Drizzle ORM schema + migrations
scripts/              # Utility scripts
```

---

## Roles

| Role | Access |
|------|--------|
| `super_admin` | Everything — users, firms, rates, rules, invoices, settings |
| `legal_ops` | Firms, rates, rules, invoices, settings (no user management) |
| `internal_lawyer` | Invoices, rules, settings (read + review only) |

---

## Security notes

- OpenAI API keys are encrypted at rest using AES-256-GCM before being stored in the database
- Keys are never returned in API responses — only a boolean `hasOpenaiKey` is exposed
- Session cookies are `httpOnly` and `sameSite: strict`
- All authenticated routes require a valid server-side session

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you'd like to change.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Push to the branch and open a Pull Request

---

## License

[MIT](LICENSE)
