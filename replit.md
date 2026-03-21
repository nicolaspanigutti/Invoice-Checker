# Invoice Checker — Workspace

## Project Overview

**Invoice Checker** is a B2B SaaS tool for corporate legal departments to review law firm invoices, detect billing errors, rate overcharges, and ensure compliance with agreed commercial terms.

### Key Roles

- **super_admin** — full access to all nav (Dashboard, Invoices, Law Firms, Rates, Rules, Users)
- **legal_ops** — Dashboard, Invoices, Law Firms, Rates, Rules (no Users)
- **internal_lawyer** — Dashboard, Invoices, Rules only

### Auth

Email/password authentication with server-side session cookies (`express-session` + `connect-pg-simple`). Session table: `user_sessions`. Seed credentials (password: `password123`):
- `admin@arcturusgroup.com` (super_admin)
- `daniel.whitfield@arcturusgroup.com` (legal_ops)
- `sophie.cartwright@arcturusgroup.com` (internal_lawyer)

---

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Auth**: bcryptjs + express-session + connect-pg-simple
- **Frontend**: React + Vite + Tailwind CSS (shadcn/ui)
- **State**: TanStack Query v5
- **Routing**: Wouter (deliberate — lightweight alternative to React Router; not a drift from spec, intentional architecture decision)
- **Forms**: react-hook-form + zod
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle for API), Vite (frontend)

---

## Monorepo Structure

```text
artifacts/
  api-server/         # Express 5 API server (port from $PORT)
  invoice-checker/    # React + Vite frontend (path: /)
  mockup-sandbox/     # Component preview server for canvas
lib/
  api-spec/           # OpenAPI spec (openapi.yaml) + Orval codegen config
  api-client-react/   # Generated React Query hooks + custom-fetch (credentials: include)
  api-zod/            # Generated Zod schemas from OpenAPI
  db/                 # Drizzle ORM schema + DB connection
scripts/              # Utility scripts (seed.ts, etc.)
```

---

## Database Schema (PostgreSQL via Drizzle)

Tables created via `pnpm --filter @workspace/db run push` + seed:

| Table | Purpose |
|-------|---------|
| `users` | App users (id, email, password_hash, role, is_active) |
| `user_sessions` | connect-pg-simple session store (sid, sess, expire) |
| `law_firms` | Law firm registry (panel / non_panel) |
| `firm_terms` | Key-value terms per firm (billing type, discount, payment terms, etc.) |
| `panel_baseline_documents` | Uploaded panel rate documents (rates / tc) |
| `panel_rates` | Panel rate rows (firm, jurisdiction, role, currency, max_rate) |
| `invoices` | Invoice records (law firm, matter, currency, amounts, status) |
| `invoice_documents` | Uploaded invoice files |
| `invoice_items` | Line items from extracted invoices |
| `analysis_runs` | AI + rule engine analysis results per invoice |
| `issues` | Individual rule violations/issues found |
| `issue_decisions` | Reviewer decisions (confirm/waive/dispute) per issue |
| `comments` | Review comments on invoices |
| `audit_events` | Full audit trail |
| `rules_config` | Configurable rule parameters (overridable from UI) |

### Key design decisions

- `firm_terms.term_value_json` uses a flexible JSON value (string/number/bool/array/object)
- `issues.evidence_json` stores structured evidence per rule
- Rate matching key: Law Firm + Jurisdiction (office) + Role + Currency
- Panel firms: use Panel Rates + Panel T&C (EL supplements, never overrides)
- Non-panel firms: EL is mandatory baseline for analysis

---

## API

Base path: `/api`

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/healthz` | GET | public | Health check |
| `/api/auth/login` | POST | public | Login with email/password |
| `/api/auth/logout` | POST | session | End session |
| `/api/auth/me` | GET | session | Get current user |

Codegen: `pnpm --filter @workspace/api-spec run codegen` — regenerates `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/`

---

## Frontend Pages

| Path | Page | Roles |
|------|------|-------|
| `/login` | Login | public |
| `/` | Dashboard | all |
| `/invoices` | Invoices | all |
| `/law-firms` | Law Firms | super_admin, legal_ops |
| `/rates` | Rates | super_admin, legal_ops |
| `/rules` | Rules | all |
| `/users` | Users | super_admin only |

---

## Scripts

```bash
pnpm --filter @workspace/scripts run seed      # Seed DB with synthetic data
pnpm --filter @workspace/api-spec run codegen  # Regenerate API client + Zod
pnpm --filter @workspace/db run push           # Push schema changes to DB
pnpm run typecheck                              # Full monorepo typecheck
```

---

## Sprint Progress

- [x] **Sprint 0** — Foundation & App Scaffold (auth, DB schema, seed data, login/logout UI)
- [x] **Sprint 1** — Reference Data Management (Law Firms, Rates CRUD, Users)
- [ ] **Sprint 2** — Invoice Upload & AI Extraction
- [ ] **Sprint 3** — Rule Engine MVP (17 objective + 7 grey rules)
- [ ] **Sprint 4** — Review Workflow, Comments & Audit Trail
- [ ] **Sprint 5** — Recovery, Report & Email Draft
- [ ] **Sprint 6** — Hardening, Re-run & Rules Admin
