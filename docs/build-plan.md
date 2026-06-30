# InterchangeLeakageAuditor — Build Plan (Authoritative Build Contract)

This is the single source of truth. Filenames, mount paths, api method names, and page files declared here are binding. Every api method is implemented by exactly one route endpoint and consumed by at least one page.

Stack: Hono 4.12.27 backend, drizzle-orm 0.45.2 + @neondatabase/serverless, Next.js 16 + React 19 + Tailwind 4 frontend, Neon Auth (`@neondatabase/auth@0.4.2-beta`). Backend mounts every domain router under `/api/v1` via a child `api` Hono router. Backend trusts `X-User-Id`; handlers use `getUserId(c)`. Frontend uses `web/proxy.ts` (never `middleware.ts`) and calls `fetch('/api/proxy/<path>')` mapping 1:1 to `/api/v1/<path>`.

---

## (a) Tables (with columns)

All app-table PKs are `text id` (`crypto.randomUUID()`); all have `created_at timestamptz default now()`. Timestamps are `timestamptz`. JSON is `jsonb`. Money is integer cents; rates/bps are `real`.

1. **workspaces** — id, name, owner_id, created_at, updated_at
2. **workspace_members** — id, workspace_id→workspaces, user_id, role, created_at; UNIQUE(workspace_id,user_id)
3. **processors** — id, workspace_id→workspaces, name, mid, pricing_model, plus_bps(real), plus_per_item_cents(int), notes, created_at
4. **rate_table_versions** — id, workspace_id→workspaces, brand, name, effective_date(ts), is_active(bool), source_note, created_at
5. **interchange_categories** — id, version_id→rate_table_versions, brand, code, name, card_product, mcc_set(jsonb), percent_rate(real), per_item_cents(int), requires_level2(bool), requires_level3(bool), requires_avs(bool), requires_card_present(bool), max_settlement_hours(int), tier_rank(int), notes, created_at
6. **upload_batches** — id, workspace_id→workspaces, processor_id→processors, filename, source_format, row_count(int), status, uploaded_by, error_message, created_at
7. **transactions** — id, workspace_id→workspaces, batch_id→upload_batches, processor_id→processors, external_ref, amount_cents(int), currency, mcc, card_brand, card_product, entry_mode, auth_timestamp(ts), settlement_timestamp(ts), has_avs(bool), has_cvv(bool), has_level2(bool), has_level3(bool), level2_data(jsonb), level3_data(jsonb), billed_category_code, billed_fee_cents(int), billed_percent_rate(real), tags(jsonb), created_at
8. **qualification_results** — id, workspace_id→workspaces, transaction_id→transactions, optimal_category_id→interchange_categories, optimal_category_code, optimal_fee_cents(int), optimal_percent_rate(real), billed_fee_cents(int), delta_cents(int), delta_bps(real), is_downgrade(bool), rule_trace(jsonb), computed_at(ts), created_at; UNIQUE(transaction_id)
9. **downgrade_causes** — id, workspace_id→workspaces, qualification_result_id→qualification_results, transaction_id→transactions, cause_code, severity, recoverable_cents(int), required_fix, detail(jsonb), created_at
10. **recoverable_savings** — id, workspace_id→workspaces, scope, scope_key, period_label, recoverable_cents(int), annualized_cents(int), txn_count(int), required_fix, created_at
11. **reconciliations** — id, workspace_id→workspaces, batch_id→upload_batches, total_billed_cents(int), total_computed_cents(int), discrepancy_cents(int), txn_count(int), downgrade_count(int), status, notes, created_at
12. **benchmarks** — id, workspace_id→workspaces, dimension, dimension_key, band_low_bps(real), band_target_bps(real), band_high_bps(real), source_note, created_at
13. **saved_filters** — id, workspace_id→workspaces, user_id, name, query(jsonb), is_shared(bool), created_at
14. **tags** — id, workspace_id→workspaces, name, color, created_at; UNIQUE(workspace_id,name)
15. **notifications** — id, workspace_id→workspaces, user_id, type, title, body, entity_type, entity_id, read(bool), created_at
16. **webhooks** — id, workspace_id→workspaces, url, events(jsonb), secret, is_active(bool), created_at
17. **webhook_deliveries** — id, workspace_id→workspaces, webhook_id→webhooks, event, payload(jsonb), status_code(int), success(bool), error, created_at
18. **api_keys** — id, workspace_id→workspaces, user_id, name, key_prefix, key_hash, last_used_at(ts), revoked(bool), created_at
19. **audit_log** — id, workspace_id→workspaces, user_id, action, entity_type, entity_id, metadata(jsonb), created_at
20. **settings** — id, workspace_id→workspaces, key, value(jsonb), updated_at; UNIQUE(workspace_id,key)
21. **onboarding_state** — id, workspace_id→workspaces, user_id, steps(jsonb), completed(bool), updated_at; UNIQUE(workspace_id,user_id)
22. **plans** — id(text 'free'|'pro'), name, price_cents(int), created_at
23. **subscriptions** — id, user_id(unique), plan_id→plans, stripe_customer_id, stripe_subscription_id, status, current_period_end(ts), created_at, updated_at

---

## (b) Backend route files

All mounted under `/api/v1` in `backend/src/index.ts` via `api.route('/<mount>', <router>)`. Every file `export default router`. Public reads, auth-gated writes (`authMiddleware` + zod + ownership via `getUserId(c)`). Standard error shapes: `{ error }` with 400/401/403/404; success bodies as noted.

### 1. `workspaces.ts` — mount `workspaces`
- `GET /` — auth — list caller's workspaces — `Workspace[]`
- `POST /` — auth — create workspace (creates owner membership) — `Workspace`
- `GET /:id` — auth — workspace detail — `Workspace`
- `PUT /:id` — auth (owner) — rename — `Workspace`
- `GET /:id/members` — auth — list members — `WorkspaceMember[]`
- `POST /:id/members` — auth (owner) — add member by user_id+role — `WorkspaceMember`
- `DELETE /:id/members/:memberId` — auth (owner) — remove member — `{ success }`

### 2. `processors.ts` — mount `processors`
- `GET /` — public — list processors (`?workspace_id=`) — `Processor[]`
- `GET /:id` — public — detail — `Processor`
- `POST /` — auth — create — `Processor`
- `PUT /:id` — auth (owner) — update — `Processor`
- `DELETE /:id` — auth (owner) — delete — `{ success }`

### 3. `rate-tables.ts` — mount `rate-tables`
- `GET /` — public — list versions (`?workspace_id=&brand=`) — `RateTableVersion[]`
- `GET /:id` — public — version + its categories — `{ version, categories }`
- `POST /` — auth — create version — `RateTableVersion`
- `PUT /:id` — auth (owner) — update version meta — `RateTableVersion`
- `POST /:id/activate` — auth (owner) — set active (deactivates siblings of same brand) — `RateTableVersion`
- `POST /:id/clone` — auth (owner) — clone version + categories — `RateTableVersion`
- `DELETE /:id` — auth (owner) — delete version — `{ success }`

### 4. `categories.ts` — mount `categories`
- `GET /` — public — list categories (`?version_id=`) — `InterchangeCategory[]`
- `POST /` — auth — create category under a version — `InterchangeCategory`
- `PUT /:id` — auth (owner) — update category — `InterchangeCategory`
- `DELETE /:id` — auth (owner) — delete category — `{ success }`

### 5. `uploads.ts` — mount `uploads`
- `GET /` — public — list batches (`?workspace_id=`) — `UploadBatch[]`
- `GET /:id` — public — batch detail + transaction count — `{ batch, txnCount }`
- `POST /` — auth — create batch with inline rows (filename, source_format, processor_id, rows[]) — parses + inserts transactions, sets status `parsed` — `{ batch, inserted }`
- `POST /:id/parse` — auth — (re)parse / re-derive transaction flags for a batch — `{ batch }`
- `DELETE /:id` — auth (owner) — delete batch + its transactions/results — `{ success }`

### 6. `transactions.ts` — mount `transactions`
- `GET /` — public — list/search/filter (`?workspace_id=&batch_id=&processor_id=&brand=&product=&mcc=&downgrade_only=&q=&from=&to=`) — `Transaction[]`
- `GET /:id` — public — txn + its qualification_result + downgrade_causes — `{ transaction, result, causes }`
- `POST /:id/tags` — auth — set tags on a txn — `Transaction`
- `POST /bulk/tag` — auth — bulk add/remove tag on ids[] — `{ updated }`
- `POST /bulk/delete` — auth — bulk delete ids[] — `{ deleted }`

### 7. `qualification.ts` — mount `qualification`
- `GET /` — public — list results (`?workspace_id=&batch_id=&downgrade_only=`) — `QualificationResult[]`
- `GET /:id` — public — result detail incl. rule_trace — `QualificationResult`
- `POST /run/batch/:batchId` — auth — run engine over a batch, upsert results + causes + savings + reconciliation — `{ count, downgrades, recoverable_cents }`
- `POST /run/transaction/:txnId` — auth — run engine on one txn — `QualificationResult`

### 8. `downgrades.ts` — mount `downgrades`
- `GET /` — public — flagged downgrades list (`?workspace_id=&batch_id=&cause=`) — `DowngradeRow[]`
- `GET /causes/breakdown` — public — count + dollars by cause (`?workspace_id=`) — `CauseBreakdown[]`

### 9. `level23.ts` — mount `level23`
- `GET /gaps` — public — L2/L3 eligibility gaps (`?workspace_id=&level=`) — `Level23Gap[]`
- `GET /summary` — public — L2 vs L3 opportunity totals (`?workspace_id=`) — `{ level2, level3, total }`

### 10. `effective-rate.ts` — mount `effective-rate`
- `GET /` — public — effective bps billed-vs-optimal by dimension (`?workspace_id=&dimension=`) — `EffectiveRateRow[]`
- `GET /trend` — public — effective rate over time (`?workspace_id=`) — `TrendPoint[]`

### 11. `savings.ts` — mount `savings`
- `GET /` — public — recoverable-savings ledger (`?workspace_id=&scope=`) — `RecoverableSaving[]`
- `GET /summary` — public — total + annualized recoverable (`?workspace_id=`) — `{ recoverable_cents, annualized_cents, txn_count }`

### 12. `reconciliation.ts` — mount `reconciliation`
- `GET /` — public — reconciliations list (`?workspace_id=`) — `Reconciliation[]`
- `GET /:id` — public — reconciliation detail — `Reconciliation`
- `PUT /:id` — auth (owner) — update status/notes — `Reconciliation`

### 13. `benchmarks.ts` — mount `benchmarks`
- `GET /` — public — list bands (`?workspace_id=&dimension=`) — `Benchmark[]`
- `POST /` — auth — create — `Benchmark`
- `PUT /:id` — auth (owner) — update — `Benchmark`
- `DELETE /:id` — auth (owner) — delete — `{ success }`

### 14. `saved-filters.ts` — mount `saved-filters`
- `GET /` — public — list (`?workspace_id=`) — `SavedFilter[]`
- `POST /` — auth — create — `SavedFilter`
- `PUT /:id` — auth (owner) — update — `SavedFilter`
- `DELETE /:id` — auth (owner) — delete — `{ success }`

### 15. `tags.ts` — mount `tags`
- `GET /` — public — list (`?workspace_id=`) — `Tag[]`
- `POST /` — auth — create — `Tag`
- `DELETE /:id` — auth (owner) — delete — `{ success }`

### 16. `notifications.ts` — mount `notifications`
- `GET /` — auth — list caller's notifications (`?workspace_id=`) — `Notification[]`
- `POST /:id/read` — auth — mark one read — `Notification`
- `POST /read-all` — auth — mark all read (`?workspace_id=`) — `{ updated }`

### 17. `webhooks.ts` — mount `webhooks`
- `GET /` — public — list (`?workspace_id=`) — `Webhook[]`
- `POST /` — auth — create — `Webhook`
- `PUT /:id` — auth (owner) — update — `Webhook`
- `DELETE /:id` — auth (owner) — delete — `{ success }`
- `POST /:id/test` — auth — test-fire, records a delivery — `WebhookDelivery`
- `GET /:id/deliveries` — public — delivery log — `WebhookDelivery[]`

### 18. `api-keys.ts` — mount `api-keys`
- `GET /` — auth — list caller's keys (hash never returned) — `ApiKey[]`
- `POST /` — auth — issue key (returns plaintext once) — `{ key, record }`
- `DELETE /:id` — auth (owner) — revoke — `{ success }`

### 19. `audit-log.ts` — mount `audit-log`
- `GET /` — public — list entries (`?workspace_id=&action=&entity_type=`) — `AuditEntry[]`

### 20. `settings.ts` — mount `settings`
- `GET /` — public — all settings for workspace (`?workspace_id=`) — `Setting[]`
- `PUT /` — auth — upsert key/value — `Setting`

### 21. `onboarding.ts` — mount `onboarding`
- `GET /` — auth — caller's onboarding state (`?workspace_id=`) — `OnboardingState`
- `POST /step` — auth — mark a step complete (`{ workspace_id, step }`) — `OnboardingState`

### 22. `sample.ts` — mount `sample`
- `POST /seed` — auth — plant demo workspace data: rate-table version + categories, processor, batch with planted downgrades (late settlement, missing L2, MCC mismatch), then run qualification — `{ workspace_id, batch_id, txnCount }`

### 23. `analytics.ts` — mount `analytics`
- `GET /overview` — public — totals: leakage_cents, downgrade_rate, recoverable_cents, txn_count, batch_count (`?workspace_id=`) — `Overview`
- `GET /top-causes` — public — top causes by dollars (`?workspace_id=`) — `CauseBreakdown[]`
- `GET /top-mccs` — public — top MCCs by leakage (`?workspace_id=`) — `MccLeakage[]`

### 24. `billing.ts` — mount `billing`
- `GET /plan` — public — current subscription + plan + `stripeEnabled` — `{ subscription, plan, stripeEnabled }`
- `POST /checkout` — auth — Stripe checkout or 503 — `{ url }`
- `POST /portal` — auth — Stripe portal or 503 — `{ url }`
- `POST /webhook` — public — Stripe webhook or 503 — `{ received }`

---

## (c) `web/lib/api.ts` methods

Every method is `fetch('/api/proxy/<path>')` → `/api/v1/<path>`. Default export object.

| Method | Verb | Path |
|---|---|---|
| listWorkspaces | GET | /api/proxy/workspaces |
| createWorkspace | POST | /api/proxy/workspaces |
| getWorkspace | GET | /api/proxy/workspaces/:id |
| updateWorkspace | PUT | /api/proxy/workspaces/:id |
| listMembers | GET | /api/proxy/workspaces/:id/members |
| addMember | POST | /api/proxy/workspaces/:id/members |
| removeMember | DELETE | /api/proxy/workspaces/:id/members/:memberId |
| listProcessors | GET | /api/proxy/processors?workspace_id= |
| getProcessor | GET | /api/proxy/processors/:id |
| createProcessor | POST | /api/proxy/processors |
| updateProcessor | PUT | /api/proxy/processors/:id |
| deleteProcessor | DELETE | /api/proxy/processors/:id |
| listRateTables | GET | /api/proxy/rate-tables?workspace_id= |
| getRateTable | GET | /api/proxy/rate-tables/:id |
| createRateTable | POST | /api/proxy/rate-tables |
| updateRateTable | PUT | /api/proxy/rate-tables/:id |
| activateRateTable | POST | /api/proxy/rate-tables/:id/activate |
| cloneRateTable | POST | /api/proxy/rate-tables/:id/clone |
| deleteRateTable | DELETE | /api/proxy/rate-tables/:id |
| listCategories | GET | /api/proxy/categories?version_id= |
| createCategory | POST | /api/proxy/categories |
| updateCategory | PUT | /api/proxy/categories/:id |
| deleteCategory | DELETE | /api/proxy/categories/:id |
| listUploads | GET | /api/proxy/uploads?workspace_id= |
| getUpload | GET | /api/proxy/uploads/:id |
| createUpload | POST | /api/proxy/uploads |
| parseUpload | POST | /api/proxy/uploads/:id/parse |
| deleteUpload | DELETE | /api/proxy/uploads/:id |
| listTransactions | GET | /api/proxy/transactions?workspace_id=&... |
| getTransaction | GET | /api/proxy/transactions/:id |
| setTransactionTags | POST | /api/proxy/transactions/:id/tags |
| bulkTagTransactions | POST | /api/proxy/transactions/bulk/tag |
| bulkDeleteTransactions | POST | /api/proxy/transactions/bulk/delete |
| listQualifications | GET | /api/proxy/qualification?workspace_id= |
| getQualification | GET | /api/proxy/qualification/:id |
| runQualificationBatch | POST | /api/proxy/qualification/run/batch/:batchId |
| runQualificationTransaction | POST | /api/proxy/qualification/run/transaction/:txnId |
| listDowngrades | GET | /api/proxy/downgrades?workspace_id= |
| getCauseBreakdown | GET | /api/proxy/downgrades/causes/breakdown?workspace_id= |
| getLevel23Gaps | GET | /api/proxy/level23/gaps?workspace_id= |
| getLevel23Summary | GET | /api/proxy/level23/summary?workspace_id= |
| getEffectiveRate | GET | /api/proxy/effective-rate?workspace_id=&dimension= |
| getEffectiveRateTrend | GET | /api/proxy/effective-rate/trend?workspace_id= |
| listSavings | GET | /api/proxy/savings?workspace_id=&scope= |
| getSavingsSummary | GET | /api/proxy/savings/summary?workspace_id= |
| listReconciliations | GET | /api/proxy/reconciliation?workspace_id= |
| getReconciliation | GET | /api/proxy/reconciliation/:id |
| updateReconciliation | PUT | /api/proxy/reconciliation/:id |
| listBenchmarks | GET | /api/proxy/benchmarks?workspace_id= |
| createBenchmark | POST | /api/proxy/benchmarks |
| updateBenchmark | PUT | /api/proxy/benchmarks/:id |
| deleteBenchmark | DELETE | /api/proxy/benchmarks/:id |
| listSavedFilters | GET | /api/proxy/saved-filters?workspace_id= |
| createSavedFilter | POST | /api/proxy/saved-filters |
| updateSavedFilter | PUT | /api/proxy/saved-filters/:id |
| deleteSavedFilter | DELETE | /api/proxy/saved-filters/:id |
| listTags | GET | /api/proxy/tags?workspace_id= |
| createTag | POST | /api/proxy/tags |
| deleteTag | DELETE | /api/proxy/tags/:id |
| listNotifications | GET | /api/proxy/notifications?workspace_id= |
| markNotificationRead | POST | /api/proxy/notifications/:id/read |
| markAllNotificationsRead | POST | /api/proxy/notifications/read-all?workspace_id= |
| listWebhooks | GET | /api/proxy/webhooks?workspace_id= |
| createWebhook | POST | /api/proxy/webhooks |
| updateWebhook | PUT | /api/proxy/webhooks/:id |
| deleteWebhook | DELETE | /api/proxy/webhooks/:id |
| testWebhook | POST | /api/proxy/webhooks/:id/test |
| listWebhookDeliveries | GET | /api/proxy/webhooks/:id/deliveries |
| listApiKeys | GET | /api/proxy/api-keys |
| createApiKey | POST | /api/proxy/api-keys |
| revokeApiKey | DELETE | /api/proxy/api-keys/:id |
| listAuditLog | GET | /api/proxy/audit-log?workspace_id= |
| getSettings | GET | /api/proxy/settings?workspace_id= |
| upsertSetting | PUT | /api/proxy/settings |
| getOnboarding | GET | /api/proxy/onboarding?workspace_id= |
| completeOnboardingStep | POST | /api/proxy/onboarding/step |
| seedSample | POST | /api/proxy/sample/seed |
| getAnalyticsOverview | GET | /api/proxy/analytics/overview?workspace_id= |
| getTopCauses | GET | /api/proxy/analytics/top-causes?workspace_id= |
| getTopMccs | GET | /api/proxy/analytics/top-mccs?workspace_id= |
| getBillingPlan | GET | /api/proxy/billing/plan |
| startCheckout | POST | /api/proxy/billing/checkout |
| openBillingPortal | POST | /api/proxy/billing/portal |

---

## (d) Pages

Public pages (no auth calls on landing):

| URL | File | Kind | API methods | Renders |
|---|---|---|---|---|
| `/` | `web/app/page.tsx` | public | (none) | Static landing: hero, problem, feature grid, CTAs |
| `/auth/sign-in` | `web/app/auth/sign-in/page.tsx` | public | (authClient) | Sign-in form (client onSubmit) |
| `/auth/sign-up` | `web/app/auth/sign-up/page.tsx` | public | (authClient) | Sign-up form (client onSubmit) |
| `/pricing` | `web/app/pricing/page.tsx` | public | getBillingPlan | Free vs Pro plans, stripeEnabled note |

Dashboard pages (under shared `web/app/dashboard/layout.tsx` → `DashboardLayout`):

| URL | File | Kind | API methods | Renders |
|---|---|---|---|---|
| `/dashboard` | `web/app/dashboard/page.tsx` | dashboard | listWorkspaces, createWorkspace, getAnalyticsOverview, getSavingsSummary, seedSample | Overview KPIs (total leakage, downgrade rate, recoverable), workspace picker, seed-sample CTA |
| `/dashboard/uploads` | `web/app/dashboard/uploads/page.tsx` | dashboard | listUploads, createUpload, listProcessors, deleteUpload | Batch list, new-upload (paste CSV/JSON), status badges |
| `/dashboard/uploads/[id]` | `web/app/dashboard/uploads/[id]/page.tsx` | dashboard | getUpload, listTransactions, parseUpload, runQualificationBatch | Batch detail rows, parse + run-qualification |
| `/dashboard/transactions` | `web/app/dashboard/transactions/page.tsx` | dashboard | listTransactions, listTags, listSavedFilters, createSavedFilter, bulkTagTransactions, bulkDeleteTransactions, listProcessors | Explorer with search/filters, tags, bulk actions |
| `/dashboard/transactions/[id]` | `web/app/dashboard/transactions/[id]/page.tsx` | dashboard | getTransaction, runQualificationTransaction, setTransactionTags | Txn detail + qualification result + rule trace + causes |
| `/dashboard/qualification` | `web/app/dashboard/qualification/page.tsx` | dashboard | listQualifications, listUploads, runQualificationBatch | Results list, run engine per batch |
| `/dashboard/downgrades` | `web/app/dashboard/downgrades/page.tsx` | dashboard | listDowngrades, getCauseBreakdown | Flagged downgrades + cause breakdown |
| `/dashboard/level23` | `web/app/dashboard/level23/page.tsx` | dashboard | getLevel23Gaps, getLevel23Summary | L2/L3 eligibility gap report |
| `/dashboard/effective-rate` | `web/app/dashboard/effective-rate/page.tsx` | dashboard | getEffectiveRate, getEffectiveRateTrend, listBenchmarks | Effective-rate dashboard, benchmark bands, trend |
| `/dashboard/savings` | `web/app/dashboard/savings/page.tsx` | dashboard | listSavings, getSavingsSummary | Recoverable-savings ledger by scope |
| `/dashboard/reconciliation` | `web/app/dashboard/reconciliation/page.tsx` | dashboard | listReconciliations, getReconciliation, updateReconciliation | Statement reconciliation per batch + status workflow |
| `/dashboard/rate-tables` | `web/app/dashboard/rate-tables/page.tsx` | dashboard | listRateTables, createRateTable, activateRateTable, cloneRateTable, deleteRateTable | Rate-table versions list + activate/clone |
| `/dashboard/rate-tables/[id]` | `web/app/dashboard/rate-tables/[id]/page.tsx` | dashboard | getRateTable, updateRateTable, listCategories, createCategory, updateCategory, deleteCategory | Version detail, edit interchange categories |
| `/dashboard/processors` | `web/app/dashboard/processors/page.tsx` | dashboard | listProcessors, createProcessor, updateProcessor, deleteProcessor | Processors CRUD |
| `/dashboard/benchmarks` | `web/app/dashboard/benchmarks/page.tsx` | dashboard | listBenchmarks, createBenchmark, updateBenchmark, deleteBenchmark | Benchmark bands CRUD |
| `/dashboard/analytics` | `web/app/dashboard/analytics/page.tsx` | dashboard | getAnalyticsOverview, getTopCauses, getTopMccs | Aggregate analytics + charts |
| `/dashboard/notifications` | `web/app/dashboard/notifications/page.tsx` | dashboard | listNotifications, markNotificationRead, markAllNotificationsRead | Notifications list |
| `/dashboard/webhooks` | `web/app/dashboard/webhooks/page.tsx` | dashboard | listWebhooks, createWebhook, updateWebhook, deleteWebhook, testWebhook, listWebhookDeliveries | Webhooks + delivery log |
| `/dashboard/api-keys` | `web/app/dashboard/api-keys/page.tsx` | dashboard | listApiKeys, createApiKey, revokeApiKey | API keys |
| `/dashboard/audit-log` | `web/app/dashboard/audit-log/page.tsx` | dashboard | listAuditLog | Audit log |
| `/dashboard/settings` | `web/app/dashboard/settings/page.tsx` | dashboard | getSettings, upsertSetting, listMembers, addMember, removeMember, getOnboarding, completeOnboardingStep, getBillingPlan, startCheckout, openBillingPortal, seedSample | Settings, members, onboarding, billing, seed sample |

Plus 2 route handlers: `web/app/api/auth/[...path]/route.ts`, `web/app/api/proxy/[...path]/route.ts`.

Page count: 4 public + 21 dashboard = 25 `page.tsx` routes.

---

## (e) DashboardLayout sidebar nav sections

`web/components/DashboardLayout.tsx` — `'use client'`, `<aside>` sidebar, active state via `usePathname()`, mobile drawer.

- **Overview**
  - Dashboard → `/dashboard`
  - Analytics → `/dashboard/analytics`
- **Audit Workflow**
  - Uploads → `/dashboard/uploads`
  - Transactions → `/dashboard/transactions`
  - Qualification → `/dashboard/qualification`
  - Downgrades → `/dashboard/downgrades`
  - Level 2/3 Gaps → `/dashboard/level23`
- **Findings**
  - Effective Rate → `/dashboard/effective-rate`
  - Recoverable Savings → `/dashboard/savings`
  - Reconciliation → `/dashboard/reconciliation`
- **Reference Data**
  - Rate Tables → `/dashboard/rate-tables`
  - Processors → `/dashboard/processors`
  - Benchmarks → `/dashboard/benchmarks`
- **Workspace**
  - Notifications → `/dashboard/notifications`
  - Webhooks → `/dashboard/webhooks`
  - API Keys → `/dashboard/api-keys`
  - Audit Log → `/dashboard/audit-log`
  - Settings → `/dashboard/settings`

---

## Engine notes (binding behavior for `qualification.ts`)

The qualification engine is deterministic:
1. Load the **active** `rate_table_versions` row for the transaction's `card_brand` and its `interchange_categories`.
2. A category is **reachable** for a txn if: txn MCC ∈ `mcc_set` (or `mcc_set` empty = any), `card_product` matches (or category product null), and every requirement is satisfied — `requires_avs`→`has_avs`, `requires_card_present`→entry_mode present/card-present, `requires_level2`→`has_level2`, `requires_level3`→`has_level3`, and settlement within `max_settlement_hours` of `auth_timestamp`.
3. **Optimal** = reachable category with the lowest computed fee (`percent_rate*amount_cents/100 + per_item_cents`), tie-broken by lowest `tier_rank`.
4. `optimal_fee_cents` computed; `delta_cents = billed_fee_cents - optimal_fee_cents`; `delta_bps = delta_cents/amount_cents*10000`.
5. `is_downgrade = delta_cents > 0` (billed worse than optimal).
6. For each downgrade, attribute cause(s) by inspecting which requirement(s) the billed category needed that the txn failed, or which timing/MCC condition pushed it down: `late_settlement`, `missing_avs`, `missing_level2`, `missing_level3`, `mcc_mismatch`, `missing_card_present`, `wrong_entry_mode`. Each cause gets `recoverable_cents` and a `required_fix` string.
7. Persist `rule_trace` (array of `{ category_code, reachable, failed_requirements[] }`).
8. After a batch run: upsert `recoverable_savings` rows per scope and a `reconciliations` row for the batch.
