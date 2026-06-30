import { pgTable, text, integer, boolean, timestamp, jsonb, unique, real } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  owner_id: text('owner_id').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const workspace_members = pgTable('workspace_members', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  role: text('role').notNull().default('member'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.user_id)])

// ---------------------------------------------------------------------------
// Processors
// ---------------------------------------------------------------------------

export const processors = pgTable('processors', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  mid: text('mid'),
  pricing_model: text('pricing_model').notNull().default('interchange_plus'),
  plus_bps: real('plus_bps').default(0),
  plus_per_item_cents: integer('plus_per_item_cents').default(0),
  notes: text('notes'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Rate tables
// ---------------------------------------------------------------------------

export const rate_table_versions = pgTable('rate_table_versions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  brand: text('brand').notNull(),
  name: text('name').notNull(),
  effective_date: timestamp('effective_date'),
  is_active: boolean('is_active').default(false).notNull(),
  source_note: text('source_note'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const interchange_categories = pgTable('interchange_categories', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  version_id: text('version_id').notNull().references(() => rate_table_versions.id),
  brand: text('brand').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  card_product: text('card_product'),
  mcc_set: jsonb('mcc_set').$type<string[]>().default([]),
  percent_rate: real('percent_rate').notNull().default(0),
  per_item_cents: integer('per_item_cents').notNull().default(0),
  requires_level2: boolean('requires_level2').default(false).notNull(),
  requires_level3: boolean('requires_level3').default(false).notNull(),
  requires_avs: boolean('requires_avs').default(false).notNull(),
  requires_card_present: boolean('requires_card_present').default(false).notNull(),
  max_settlement_hours: integer('max_settlement_hours'),
  tier_rank: integer('tier_rank').notNull().default(0),
  notes: text('notes'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Uploads & transactions
// ---------------------------------------------------------------------------

export const upload_batches = pgTable('upload_batches', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  processor_id: text('processor_id').references(() => processors.id),
  filename: text('filename').notNull(),
  source_format: text('source_format').notNull().default('csv'),
  row_count: integer('row_count').default(0).notNull(),
  status: text('status').notNull().default('uploaded'),
  uploaded_by: text('uploaded_by').notNull(),
  error_message: text('error_message'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const transactions = pgTable('transactions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  batch_id: text('batch_id').notNull().references(() => upload_batches.id),
  processor_id: text('processor_id').references(() => processors.id),
  external_ref: text('external_ref'),
  amount_cents: integer('amount_cents').notNull().default(0),
  currency: text('currency').notNull().default('USD'),
  mcc: text('mcc'),
  card_brand: text('card_brand'),
  card_product: text('card_product'),
  entry_mode: text('entry_mode'),
  auth_timestamp: timestamp('auth_timestamp'),
  settlement_timestamp: timestamp('settlement_timestamp'),
  has_avs: boolean('has_avs').default(false).notNull(),
  has_cvv: boolean('has_cvv').default(false).notNull(),
  has_level2: boolean('has_level2').default(false).notNull(),
  has_level3: boolean('has_level3').default(false).notNull(),
  level2_data: jsonb('level2_data').$type<Record<string, unknown>>().default({}),
  level3_data: jsonb('level3_data').$type<Record<string, unknown>>().default({}),
  billed_category_code: text('billed_category_code'),
  billed_fee_cents: integer('billed_fee_cents').default(0),
  billed_percent_rate: real('billed_percent_rate').default(0),
  tags: jsonb('tags').$type<string[]>().default([]),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Qualification engine output
// ---------------------------------------------------------------------------

export const qualification_results = pgTable('qualification_results', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  transaction_id: text('transaction_id').notNull().references(() => transactions.id),
  optimal_category_id: text('optimal_category_id').references(() => interchange_categories.id),
  optimal_category_code: text('optimal_category_code'),
  optimal_fee_cents: integer('optimal_fee_cents').default(0),
  optimal_percent_rate: real('optimal_percent_rate').default(0),
  billed_fee_cents: integer('billed_fee_cents').default(0),
  delta_cents: integer('delta_cents').default(0),
  delta_bps: real('delta_bps').default(0),
  is_downgrade: boolean('is_downgrade').default(false).notNull(),
  rule_trace: jsonb('rule_trace').$type<Array<Record<string, unknown>>>().default([]),
  computed_at: timestamp('computed_at').defaultNow().notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.transaction_id)])

export const downgrade_causes = pgTable('downgrade_causes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  qualification_result_id: text('qualification_result_id').notNull().references(() => qualification_results.id),
  transaction_id: text('transaction_id').notNull().references(() => transactions.id),
  cause_code: text('cause_code').notNull(),
  severity: text('severity').notNull().default('medium'),
  recoverable_cents: integer('recoverable_cents').default(0),
  required_fix: text('required_fix'),
  detail: jsonb('detail').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const recoverable_savings = pgTable('recoverable_savings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  scope: text('scope').notNull(),
  scope_key: text('scope_key').notNull(),
  period_label: text('period_label'),
  recoverable_cents: integer('recoverable_cents').default(0),
  annualized_cents: integer('annualized_cents').default(0),
  txn_count: integer('txn_count').default(0),
  required_fix: text('required_fix'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const reconciliations = pgTable('reconciliations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  batch_id: text('batch_id').notNull().references(() => upload_batches.id),
  total_billed_cents: integer('total_billed_cents').default(0),
  total_computed_cents: integer('total_computed_cents').default(0),
  discrepancy_cents: integer('discrepancy_cents').default(0),
  txn_count: integer('txn_count').default(0),
  downgrade_count: integer('downgrade_count').default(0),
  status: text('status').notNull().default('open'),
  notes: text('notes'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const benchmarks = pgTable('benchmarks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  dimension: text('dimension').notNull(),
  dimension_key: text('dimension_key').notNull(),
  band_low_bps: real('band_low_bps').default(0),
  band_target_bps: real('band_target_bps').default(0),
  band_high_bps: real('band_high_bps').default(0),
  source_note: text('source_note'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Workspace utilities
// ---------------------------------------------------------------------------

export const saved_filters = pgTable('saved_filters', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  query: jsonb('query').$type<Record<string, unknown>>().default({}),
  is_shared: boolean('is_shared').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const tags = pgTable('tags', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  color: text('color').default('#6366f1'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.name)])

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  type: text('type').notNull().default('info'),
  title: text('title').notNull(),
  body: text('body'),
  entity_type: text('entity_type'),
  entity_id: text('entity_id'),
  read: boolean('read').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const webhooks = pgTable('webhooks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  url: text('url').notNull(),
  events: jsonb('events').$type<string[]>().default([]),
  secret: text('secret'),
  is_active: boolean('is_active').default(true).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const webhook_deliveries = pgTable('webhook_deliveries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  webhook_id: text('webhook_id').notNull().references(() => webhooks.id),
  event: text('event').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
  status_code: integer('status_code'),
  success: boolean('success').default(false).notNull(),
  error: text('error'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const api_keys = pgTable('api_keys', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  key_prefix: text('key_prefix').notNull(),
  key_hash: text('key_hash').notNull(),
  last_used_at: timestamp('last_used_at'),
  revoked: boolean('revoked').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const audit_log = pgTable('audit_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id'),
  action: text('action').notNull(),
  entity_type: text('entity_type'),
  entity_id: text('entity_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const settings = pgTable('settings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  key: text('key').notNull(),
  value: jsonb('value').$type<Record<string, unknown>>().default({}),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.key)])

export const onboarding_state = pgTable('onboarding_state', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  steps: jsonb('steps').$type<Record<string, boolean>>().default({}),
  completed: boolean('completed').default(false).notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.user_id)])

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  price_cents: integer('price_cents').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  plan_id: text('plan_id').notNull().default('free').references(() => plans.id),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  status: text('status').notNull().default('active'),
  current_period_end: timestamp('current_period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
