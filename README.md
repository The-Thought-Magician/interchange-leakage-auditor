# InterchangeLeakageAuditor

Re-derive the optimal interchange category for every card transaction and flag the costly downgrades you should never have paid.

InterchangeLeakageAuditor ingests merchant settlement/transaction files, re-classifies every card transaction against seeded Visa/Mastercard interchange rate tables, computes the optimal interchange category each transaction should have qualified for, and flags any transaction that was billed at a worse (more expensive) category. Each downgrade is attributed to a concrete, fixable cause (late settlement, missing AVS, absent Level 2/Level 3 data, MCC mismatch, missing card-present indicators) and quantified into annualized recoverable dollars with the exact data fix required.

The product is a deterministic rules engine over uploaded data: no machine-learning guesswork, no opaque score. Every flagged downgrade is explained by a rule with a citation to the rate-table row that produced it, so a controller can take the finding to their processor and contest it.

A built-in sample seeder plants a multi-brand settlement batch with known downgrades, so the qualification engine, downgrade detector, and recoverable-savings ledger are demoable the instant a user signs in.

See [docs/idea.md](docs/idea.md) for the full product specification.

## Stack

- **Backend:** Hono (TypeScript, ESM) on Node 22, run via `tsx`. Drizzle ORM over Neon serverless Postgres.
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS 4.
- **Auth:** Neon Auth (`@neondatabase/auth`). The Next.js server resolves the session and proxies requests to the backend with an `X-User-Id` header.
- **Database:** Neon Postgres.
- **Package managers:** pnpm (Node), cargo/uv where applicable.

## Project layout

```
backend/   Hono API server (src/index.ts entrypoint)
web/       Next.js frontend (App Router)
docs/      idea.md (product spec), build-plan.md
```

## Local development

Prerequisites: Node 22, pnpm, and a Neon Postgres connection string. The app does not create its own tables; provision the Drizzle schema out-of-band (drizzle-kit push or the Neon console) before first boot.

### Backend

```bash
cd backend
pnpm install
cp .env.example .env   # then fill in DATABASE_URL and FRONTEND_URL
pnpm dev               # node --import tsx/esm src/index.ts
```

The backend listens on `PORT` (default `3001`). Health check: `GET /health` returns `{ ok: true }`. All API routes are mounted under `/api/v1`. The server runs an idempotent `seedIfEmpty()` on boot to plant the sample multi-brand settlement batch and the Visa/Mastercard rate tables.

### Frontend

```bash
cd web
pnpm install
cp .env.example .env.local   # then fill in the NEON_AUTH_* and NEXT_PUBLIC_API_URL vars
pnpm dev                     # next dev
```

The frontend runs on `http://localhost:3000`. Browser calls go to same-origin `/api/proxy/...`, which resolves the Neon Auth session server-side and forwards to the backend with `X-User-Id`.

### Docker Compose

```bash
docker compose up --build
```

Brings up the backend (`:3001`) and web (`:3000`) together. Set `DATABASE_URL` in `backend/.env`.

## Environment variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | no | Listen port (default `3001`; Render injects `10000`). |
| `DATABASE_URL` | yes | Neon Postgres connection string (`?sslmode=require`). |
| `FRONTEND_URL` | no | Allowed CORS origin (default `http://localhost:3000`). |
| `ADMIN_USER_IDS` | no | Comma-separated user IDs granted admin endpoints. |
| `STRIPE_SECRET_KEY` | no | Enables Stripe billing; unset returns 503 from billing routes. |
| `STRIPE_PRO_PRICE_ID` | no | Stripe price ID for the pro plan checkout. |
| `STRIPE_WEBHOOK_SECRET` | no | Verifies incoming Stripe webhooks. |

### Frontend (`web/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEON_AUTH_BASE_URL` | yes | Neon Auth endpoint base URL (server-only). |
| `NEON_AUTH_COOKIE_SECRET` | yes | Random 32-byte hex secret for session cookies (server-only). |
| `NEXT_PUBLIC_API_URL` | yes | Backend base URL, baked into the bundle at build time. |

## Billing

All features are FREE for signed-in users. Stripe billing is wired but optional: billing endpoints return `503` when `STRIPE_SECRET_KEY` is unconfigured, and the app is fully functional without it.

## Deployment

- **Backend:** Render web service (see [render.yaml](render.yaml)). Build `cd backend && pnpm install`, start `cd backend && node --import tsx/esm src/index.ts`. Set `DATABASE_URL` and `FRONTEND_URL` as Render env vars.
- **Frontend:** Vercel (framework `nextjs`, root directory `web`, Node 22.x).
