# InterchangeLeakageAuditor

> Re-derive the optimal interchange category for every card transaction and flag the costly downgrades you should never have paid.

---

## Overview

InterchangeLeakageAuditor ingests merchant settlement/transaction files, re-classifies every card transaction against seeded Visa/Mastercard interchange rate tables, computes the **optimal** interchange category each transaction *should* have qualified for, and flags any transaction that was billed at a worse (more expensive) category. Each downgrade is attributed to a concrete, fixable cause — late settlement, missing AVS, absent Level 2/Level 3 data, MCC mismatch, missing card-present indicators — and quantified into annualized recoverable dollars with the exact data fix required.

The product is a deterministic rules engine over uploaded data: no machine-learning guesswork, no opaque "score." Every flagged downgrade is explained by a rule with a citation to the rate-table row that produced it, so a controller can take the finding to their processor and contest it.

A built-in sample seeder plants a multi-brand settlement batch with known downgrades so the qualification engine, downgrade detector, and recoverable-savings ledger are demoable the instant a user signs in.

All features are FREE for signed-in users. Stripe billing is wired but optional (returns 503 when unconfigured).

---

## Problem

Card transactions silently **downgrade** to more expensive interchange categories. A transaction that *could* have qualified for a low commercial-card Level 3 rate instead settles at a non-qualified consumer rate because:

- it settled more than 24 hours after authorization (late settlement),
- it was missing AVS / CVV / address verification data,
- it lacked the Level 2 fields (tax amount, customer code) or Level 3 fields (line-item detail, freight, duty) that B2B/commercial/government cards require,
- the merchant category code (MCC) on file did not match the card program's expectations,
- the card-present / entry-mode indicators were absent or wrong.

Each downgrade silently adds 20-50 basis points. On interchange-plus pricing the merchant pays the difference directly, and **no one re-audits it**. Processors do not volunteer the optimization; statement-audit consultants do it by hand on spreadsheets. There is no self-serve tool that re-derives the optimal category from the raw transaction data and produces a defensible, line-by-line recoverable-savings report.

---

## Target Users

- **CFOs and controllers** at high-volume merchants on interchange-plus pricing who want to recover leaked basis points.
- **Payments / treasury leads** responsible for processor relationships and cost-of-acceptance.
- **Statement-audit consultants** who run interchange optimization engagements and need a fast, repeatable, defensible engine.
- **Finance analysts** reconciling billed processor fees against what *should* have been charged.

---

## Why this is NOT an existing project

This is specifically **card interchange qualification** — re-deriving the Visa/Mastercard interchange category from raw transaction attributes and rate tables, and detecting downgrades. It is NOT:

- **freight-invoice-audit** — that audits carrier/freight invoices for billing errors (accessorials, dimensional weight, fuel surcharge). Entirely different cost domain and reference data (carrier tariffs, not interchange tables).
- **bank-reconciliation** tools — those match bank-statement lines to a general ledger. We reconcile *billed interchange fee* vs *computed optimal interchange fee*, a payments-specific cost, not cash movement.
- **generic billing / spend-management / expense tools** — those track or categorize spend. We do not categorize spend; we re-derive the interchange *rate* a transaction qualified for.
- **chargeback / dispute managers** — different lifecycle (cardholder disputes), not interchange qualification.

It is also distinct from its sibling ventures that share the "re-derive from raw" pattern but operate in completely different domains with different reference data:

- **commission-dispute-ledger** re-derives **sales commission** from quota/plan rules (sales-comp domain).
- **fx-markup-transparency-tracker** re-derives the true **FX spread/markup** from mid-market rates (foreign-exchange domain).

InterchangeLeakageAuditor's reference data is the **Visa/Mastercard interchange rate tables** and its mechanics are **interchange downgrade rules** — a domain neither sibling touches.

---

## Data Model (tables)

App tables (string-UUID PKs, `created_at` timestamps, `workspace_id` scoping where noted):

1. **workspaces** — tenant container. `id, name, owner_id, created_at, updated_at`.
2. **workspace_members** — `id, workspace_id→workspaces, user_id, role, created_at` (unique workspace_id+user_id).
3. **processors** — merchant's acquiring processors. `id, workspace_id, name, mid, pricing_model('interchange_plus'), plus_bps, plus_per_item_cents, notes, created_at`.
4. **rate_table_versions** — versioned interchange program editions. `id, workspace_id, brand('visa'|'mastercard'), name, effective_date, is_active, source_note, created_at`.
5. **interchange_categories** — rows of a rate table version. `id, version_id→rate_table_versions, brand, code, name, card_product, mcc_set(jsonb), percent_rate(real), per_item_cents(integer), requires_level2(bool), requires_level3(bool), requires_avs(bool), requires_card_present(bool), max_settlement_hours(integer), tier_rank(integer), notes, created_at`.
6. **upload_batches** — an uploaded settlement/transaction file. `id, workspace_id, processor_id, filename, source_format('csv'|'json'), row_count, status('uploaded'|'parsed'|'qualified'|'error'), uploaded_by, error_message, created_at`.
7. **transactions** — normalized ledger row. `id, workspace_id, batch_id→upload_batches, processor_id, external_ref, amount_cents(integer), currency, mcc, card_brand, card_product, entry_mode, auth_timestamp, settlement_timestamp, has_avs(bool), has_cvv(bool), has_level2(bool), has_level3(bool), level2_data(jsonb), level3_data(jsonb), billed_category_code, billed_fee_cents(integer), billed_percent_rate(real), tags(jsonb), created_at`.
8. **qualification_results** — engine output per transaction. `id, workspace_id, transaction_id→transactions, optimal_category_id→interchange_categories, optimal_category_code, optimal_fee_cents(integer), optimal_percent_rate(real), billed_fee_cents(integer), delta_cents(integer), delta_bps(real), is_downgrade(bool), rule_trace(jsonb), computed_at, created_at` (unique transaction_id).
9. **downgrade_causes** — attributed cause per downgrade. `id, workspace_id, qualification_result_id→qualification_results, transaction_id, cause_code('late_settlement'|'missing_avs'|'missing_level2'|'missing_level3'|'mcc_mismatch'|'missing_card_present'|'wrong_entry_mode'), severity, recoverable_cents(integer), required_fix, detail(jsonb), created_at`.
10. **recoverable_savings** — aggregated recoverable ledger entries. `id, workspace_id, scope('batch'|'cause'|'processor'|'mcc'|'brand'), scope_key, period_label, recoverable_cents(integer), annualized_cents(integer), txn_count(integer), required_fix, created_at`.
11. **reconciliations** — billed-vs-computed per settlement batch. `id, workspace_id, batch_id→upload_batches, total_billed_cents(integer), total_computed_cents(integer), discrepancy_cents(integer), txn_count(integer), downgrade_count(integer), status('open'|'reviewed'|'resolved'), notes, created_at`.
12. **benchmarks** — effective-rate benchmark bands. `id, workspace_id, dimension('processor'|'brand'|'product'|'mcc'), dimension_key, band_low_bps(real), band_target_bps(real), band_high_bps(real), source_note, created_at`.
13. **saved_filters** — saved transaction queries. `id, workspace_id, user_id, name, query(jsonb), is_shared(bool), created_at`.
14. **tags** — reusable tag definitions. `id, workspace_id, name, color, created_at` (unique workspace_id+name).
15. **notifications** — `id, workspace_id, user_id, type, title, body, entity_type, entity_id, read(bool), created_at`.
16. **webhooks** — outbound webhook endpoints. `id, workspace_id, url, events(jsonb), secret, is_active(bool), created_at`.
17. **webhook_deliveries** — `id, workspace_id, webhook_id→webhooks, event, payload(jsonb), status_code(integer), success(bool), error, created_at`.
18. **api_keys** — `id, workspace_id, user_id, name, key_prefix, key_hash, last_used_at, revoked(bool), created_at`.
19. **audit_log** — `id, workspace_id, user_id, action, entity_type, entity_id, metadata(jsonb), created_at`.
20. **settings** — per-workspace settings. `id, workspace_id, key, value(jsonb), updated_at` (unique workspace_id+key).
21. **onboarding_state** — `id, workspace_id, user_id, steps(jsonb), completed(bool), updated_at` (unique workspace_id+user_id).
22. **plans** — billing plans. `id('free'|'pro'), name, price_cents, created_at`.
23. **subscriptions** — `id, user_id(unique), plan_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at`.

---

## API surface (high level)

Mounted under `/api/v1`. Public reads, auth-gated writes, ownership checks, zod validation.

- Workspaces, members, settings, onboarding
- Processors CRUD
- Rate-table versions + interchange categories CRUD + activate/clone
- Upload batches: create, parse, list, detail, delete
- Transactions: list/search/filter, detail, bulk-tag, bulk-delete
- Qualification engine: run on batch / run on transaction, results list, result detail
- Downgrade detector: list causes, by-cause breakdown
- Level 2/3 gap report
- Effective-rate dashboard / analytics
- Recoverable-savings ledger
- Statement reconciliation
- Benchmarks CRUD
- Saved filters CRUD, tags CRUD, bulk actions
- Notifications, webhooks + deliveries, API keys, audit log
- Sample seeder (plant demo batch)
- Billing (plan/checkout/portal/webhook), stats

---

## MAJOR FEATURE SECTIONS

### 1. Transaction Intake & Normalization
- Upload settlement/transaction files in CSV or JSON.
- Field mapping for amount, MCC, card brand, card product, entry mode, auth + settlement timestamps, Level 2/3 data fields, billed interchange category + billed fee.
- Per-batch parse with row-count, status (uploaded/parsed/qualified/error), and error capture.
- Normalize heterogeneous columns into a single transaction ledger.
- Per-transaction validation: amount, currency, timestamps, brand/product enums.
- Re-parse / re-upload a batch; delete a batch and its transactions.
- Batch list with status badges and progress.

### 2. Interchange Qualification Engine
- Deterministic rules engine re-classifies each transaction against the active rate table version for its brand.
- Candidate-category matching by MCC set, card product, entry mode, AVS/CVV presence, Level 2/3 presence, settlement timing.
- Compute optimal category = cheapest category the transaction *qualifies* for given its actual data.
- Compute optimal fee (percent_rate * amount + per_item_cents) and optimal effective bps.
- Persist a full `rule_trace` jsonb explaining which rules passed/failed and why a category was or wasn't reachable.
- Run on a whole batch or a single transaction; idempotent re-run.
- Per-transaction result detail with the rule trace rendered.

### 3. Downgrade Detector & Cause Attribution
- Flag transactions where billed category is worse (higher tier_rank / higher fee) than optimal.
- Attribute each downgrade to a specific cause: late_settlement, missing_avs, missing_level2, missing_level3, mcc_mismatch, missing_card_present, wrong_entry_mode.
- Compute recoverable_cents per cause and the exact required_fix string.
- Severity scoring per cause.
- Cause breakdown: count and dollars by cause.
- Filter transactions to only downgrades.

### 4. Level 2/3 Eligibility Gap Report
- For B2B / government / commercial card products, find transactions that could have hit far cheaper L2/L3 rates with the right data fields.
- Show the specific missing field(s) (tax amount, customer code, line items, freight, duty).
- Quantify the gap dollars and the L2 vs L3 opportunity separately.
- List eligible-but-ungapped vs gapped transactions.

### 5. Effective-Rate Dashboard
- Effective interchange rate (bps) by processor, brand, card product, MCC.
- Benchmark bands (low / target / high) overlaid per dimension.
- Trend over time (by settlement period).
- Billed effective rate vs optimal effective rate side by side.

### 6. Recoverable-Savings Ledger
- Quantify annualized recoverable dollars per downgrade cause.
- Per-scope ledger: by batch, by cause, by processor, by MCC, by brand.
- The exact data fix required for each recoverable line.
- Totals and annualized projection.

### 7. Statement Reconciliation
- Billed-vs-computed fee reconciliation per settlement batch.
- Discrepancy in cents and bps, downgrade count, txn count.
- Reconciliation status workflow: open / reviewed / resolved.
- Surface discrepancies that exceed a threshold.

### 8. Rate-Table Management
- Versioned interchange rate tables (Visa / Mastercard categories) editable as the program updates.
- Create/clone/activate a version; edit categories (percent_rate, per_item_cents, requirements, MCC set, tier_rank).
- Effective-date tracking; only the active version is used by the engine.
- Per-brand category catalog.

### 9. Processors
- CRUD merchant processors with MID and interchange-plus markup (plus_bps, plus_per_item_cents).
- Associate batches and transactions to a processor.

### 10. Benchmarks
- CRUD benchmark bands per dimension (processor/brand/product/MCC) with low/target/high bps.
- Used by the effective-rate dashboard to flag out-of-band rates.

### 11. Transactions Explorer (search, tags, saved filters)
- Full transaction list with search and multi-field filters (brand, product, MCC, downgrade-only, batch, processor, date range).
- Tags: define, assign, bulk-assign.
- Saved filters: save a query, share within workspace, re-run.

### 12. Bulk Actions
- Bulk-tag, bulk-untag, bulk-delete transactions.
- Bulk re-qualify a selection.

### 13. Analytics
- Aggregate stats: total leakage, downgrade rate, top causes, top MCCs by leakage, leakage trend.
- Charts feeding the dashboard.

### 14. Notifications
- In-app notifications for batch parsed, qualification complete, large discrepancy detected.
- Mark read / mark all read.

### 15. Webhooks
- Register outbound webhook endpoints with event subscriptions and a secret.
- Delivery log with status codes and success flag.
- Test-fire a webhook.

### 16. Public API + API Keys
- Issue API keys (prefix + hash), list, revoke.
- Programmatic access aligned with the same endpoints.

### 17. Audit Log
- Append-only audit entries for create/update/delete and engine runs.
- Filter by action, entity, user.

### 18. Settings
- Per-workspace key/value settings (discrepancy threshold, default currency, annualization basis).

### 19. Onboarding
- Stepped onboarding state (connect processor, upload a batch, run qualification, view savings).
- Mark steps complete; track completion.

### 20. Billing
- Plans (free, pro) and subscriptions.
- Stripe optional: checkout / portal / webhook return 503 when `STRIPE_SECRET_KEY` is unset.
- `GET /plan` always returns the current subscription + plan + `stripeEnabled`.

### 21. Sample Data Seeder
- One-click plant of a multi-brand settlement batch with deliberately planted downgrades (late settlement, missing L2 data, MCC mismatch) plus a seeded rate-table version.
- Makes the qualification engine + recoverable-savings ledger demoable instantly.

### 22. Workspaces & Members
- Multi-tenant workspaces; invite/list members with roles.
- All data scoped by `workspace_id`.

---

## Frontend Pages (~24)

Public:
1. `/` — landing (static marketing).
2. `/auth/sign-in` — sign in.
3. `/auth/sign-up` — sign up.
4. `/pricing` — pricing (free + optional pro).

Dashboard (under `/dashboard`, shared sidebar layout):
5. `/dashboard` — overview: total leakage, downgrade rate, recoverable total, quick links, seed-sample CTA.
6. `/dashboard/uploads` — upload batches list + new upload + parse.
7. `/dashboard/uploads/[id]` — batch detail: rows, parse status, run-qualification.
8. `/dashboard/transactions` — transactions explorer: search, filters, tags, bulk actions.
9. `/dashboard/transactions/[id]` — transaction detail with qualification result + rule trace + causes.
10. `/dashboard/qualification` — qualification results list, run engine, re-run.
11. `/dashboard/downgrades` — downgrade detector: flagged txns + cause breakdown.
12. `/dashboard/level23` — Level 2/3 eligibility gap report.
13. `/dashboard/effective-rate` — effective-rate dashboard with benchmark bands + trend.
14. `/dashboard/savings` — recoverable-savings ledger by scope.
15. `/dashboard/reconciliation` — statement reconciliation per batch.
16. `/dashboard/rate-tables` — rate-table versions list + activate/clone.
17. `/dashboard/rate-tables/[id]` — version detail: edit interchange categories.
18. `/dashboard/processors` — processors CRUD.
19. `/dashboard/benchmarks` — benchmark bands CRUD.
20. `/dashboard/analytics` — aggregate analytics + charts.
21. `/dashboard/notifications` — notifications.
22. `/dashboard/webhooks` — webhooks + delivery log.
23. `/dashboard/api-keys` — API keys.
24. `/dashboard/audit-log` — audit log.
25. `/dashboard/settings` — settings, members, onboarding, billing/plan, seed sample.
