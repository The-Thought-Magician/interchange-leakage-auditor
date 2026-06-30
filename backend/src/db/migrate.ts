import { db } from './index.js'
import { sql } from 'drizzle-orm'

const statements: string[] = [
  `CREATE TABLE IF NOT EXISTS workspaces (
    id text PRIMARY KEY,
    name text NOT NULL,
    owner_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS workspace_members (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    role text NOT NULL DEFAULT 'member',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS processors (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    mid text,
    pricing_model text NOT NULL DEFAULT 'interchange_plus',
    plus_bps real DEFAULT 0,
    plus_per_item_cents integer DEFAULT 0,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS rate_table_versions (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    brand text NOT NULL,
    name text NOT NULL,
    effective_date timestamptz,
    is_active boolean NOT NULL DEFAULT false,
    source_note text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS interchange_categories (
    id text PRIMARY KEY,
    version_id text NOT NULL REFERENCES rate_table_versions(id),
    brand text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    card_product text,
    mcc_set jsonb DEFAULT '[]'::jsonb,
    percent_rate real NOT NULL DEFAULT 0,
    per_item_cents integer NOT NULL DEFAULT 0,
    requires_level2 boolean NOT NULL DEFAULT false,
    requires_level3 boolean NOT NULL DEFAULT false,
    requires_avs boolean NOT NULL DEFAULT false,
    requires_card_present boolean NOT NULL DEFAULT false,
    max_settlement_hours integer,
    tier_rank integer NOT NULL DEFAULT 0,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS upload_batches (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    processor_id text REFERENCES processors(id),
    filename text NOT NULL,
    source_format text NOT NULL DEFAULT 'csv',
    row_count integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'uploaded',
    uploaded_by text NOT NULL,
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS transactions (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    batch_id text NOT NULL REFERENCES upload_batches(id),
    processor_id text REFERENCES processors(id),
    external_ref text,
    amount_cents integer NOT NULL DEFAULT 0,
    currency text NOT NULL DEFAULT 'USD',
    mcc text,
    card_brand text,
    card_product text,
    entry_mode text,
    auth_timestamp timestamptz,
    settlement_timestamp timestamptz,
    has_avs boolean NOT NULL DEFAULT false,
    has_cvv boolean NOT NULL DEFAULT false,
    has_level2 boolean NOT NULL DEFAULT false,
    has_level3 boolean NOT NULL DEFAULT false,
    level2_data jsonb DEFAULT '{}'::jsonb,
    level3_data jsonb DEFAULT '{}'::jsonb,
    billed_category_code text,
    billed_fee_cents integer DEFAULT 0,
    billed_percent_rate real DEFAULT 0,
    tags jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS qualification_results (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    transaction_id text NOT NULL REFERENCES transactions(id),
    optimal_category_id text REFERENCES interchange_categories(id),
    optimal_category_code text,
    optimal_fee_cents integer DEFAULT 0,
    optimal_percent_rate real DEFAULT 0,
    billed_fee_cents integer DEFAULT 0,
    delta_cents integer DEFAULT 0,
    delta_bps real DEFAULT 0,
    is_downgrade boolean NOT NULL DEFAULT false,
    rule_trace jsonb DEFAULT '[]'::jsonb,
    computed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (transaction_id)
  )`,

  `CREATE TABLE IF NOT EXISTS downgrade_causes (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    qualification_result_id text NOT NULL REFERENCES qualification_results(id),
    transaction_id text NOT NULL REFERENCES transactions(id),
    cause_code text NOT NULL,
    severity text NOT NULL DEFAULT 'medium',
    recoverable_cents integer DEFAULT 0,
    required_fix text,
    detail jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS recoverable_savings (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    scope text NOT NULL,
    scope_key text NOT NULL,
    period_label text,
    recoverable_cents integer DEFAULT 0,
    annualized_cents integer DEFAULT 0,
    txn_count integer DEFAULT 0,
    required_fix text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS reconciliations (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    batch_id text NOT NULL REFERENCES upload_batches(id),
    total_billed_cents integer DEFAULT 0,
    total_computed_cents integer DEFAULT 0,
    discrepancy_cents integer DEFAULT 0,
    txn_count integer DEFAULT 0,
    downgrade_count integer DEFAULT 0,
    status text NOT NULL DEFAULT 'open',
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS benchmarks (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    dimension text NOT NULL,
    dimension_key text NOT NULL,
    band_low_bps real DEFAULT 0,
    band_target_bps real DEFAULT 0,
    band_high_bps real DEFAULT 0,
    source_note text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS saved_filters (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    name text NOT NULL,
    query jsonb DEFAULT '{}'::jsonb,
    is_shared boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS tags (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    color text DEFAULT '#6366f1',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, name)
  )`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    type text NOT NULL DEFAULT 'info',
    title text NOT NULL,
    body text,
    entity_type text,
    entity_id text,
    read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS webhooks (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    url text NOT NULL,
    events jsonb DEFAULT '[]'::jsonb,
    secret text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    webhook_id text NOT NULL REFERENCES webhooks(id),
    event text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    status_code integer,
    success boolean NOT NULL DEFAULT false,
    error text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS api_keys (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    name text NOT NULL,
    key_prefix text NOT NULL,
    key_hash text NOT NULL,
    last_used_at timestamptz,
    revoked boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS audit_log (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text,
    action text NOT NULL,
    entity_type text,
    entity_id text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS settings (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    key text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, key)
  )`,

  `CREATE TABLE IF NOT EXISTS onboarding_state (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    steps jsonb DEFAULT '{}'::jsonb,
    completed boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS plans (
    id text PRIMARY KEY,
    name text NOT NULL,
    price_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    plan_id text NOT NULL DEFAULT 'free' REFERENCES plans(id),
    stripe_customer_id text,
    stripe_subscription_id text,
    status text NOT NULL DEFAULT 'active',
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // Indexes on FKs / workspace_id for query performance
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_processors_workspace ON processors(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rate_table_versions_workspace ON rate_table_versions(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_interchange_categories_version ON interchange_categories(version_id)`,
  `CREATE INDEX IF NOT EXISTS idx_upload_batches_workspace ON upload_batches(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_workspace ON transactions(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_batch ON transactions(batch_id)`,
  `CREATE INDEX IF NOT EXISTS idx_qualification_results_workspace ON qualification_results(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_qualification_results_txn ON qualification_results(transaction_id)`,
  `CREATE INDEX IF NOT EXISTS idx_downgrade_causes_workspace ON downgrade_causes(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_downgrade_causes_result ON downgrade_causes(qualification_result_id)`,
  `CREATE INDEX IF NOT EXISTS idx_recoverable_savings_workspace ON recoverable_savings(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reconciliations_workspace ON reconciliations(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reconciliations_batch ON reconciliations(batch_id)`,
  `CREATE INDEX IF NOT EXISTS idx_benchmarks_workspace ON benchmarks(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_saved_filters_workspace ON saved_filters(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tags_workspace ON tags(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_workspace ON notifications(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_webhooks_workspace ON webhooks(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id)`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_workspace ON api_keys(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_workspace ON audit_log(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_settings_workspace ON settings(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_onboarding_state_workspace ON onboarding_state(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)`,
]

export async function migrate() {
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
  console.log('Migration complete: ensured all tables and indexes exist')
}
