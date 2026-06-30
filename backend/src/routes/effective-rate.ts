import { Hono } from 'hono'
import { db } from '../db/index.js'
import { qualification_results, transactions } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'

const router = new Hono()

// Allowed dimensions map onto transaction columns.
const DIMENSION_COLUMNS: Record<string, keyof typeof transactions.$inferSelect> = {
  brand: 'card_brand',
  product: 'card_product',
  mcc: 'mcc',
  processor: 'processor_id',
  entry_mode: 'entry_mode',
  batch: 'batch_id',
}

interface EffectiveRateAccumulator {
  dimension_key: string
  amount_cents: number
  billed_fee_cents: number
  optimal_fee_cents: number
  delta_cents: number
  txn_count: number
  downgrade_count: number
}

// GET / — effective interchange bps (billed vs optimal) grouped by a dimension.
// ?workspace_id= (required) &dimension=brand|product|mcc|processor|entry_mode|batch (default brand)
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const dimension = (c.req.query('dimension') ?? 'brand').toLowerCase()
  const column = DIMENSION_COLUMNS[dimension]
  if (!column) {
    return c.json({ error: `Unknown dimension: ${dimension}` }, 400)
  }

  const rows = await db
    .select({
      amount_cents: transactions.amount_cents,
      billed_fee_cents: qualification_results.billed_fee_cents,
      optimal_fee_cents: qualification_results.optimal_fee_cents,
      delta_cents: qualification_results.delta_cents,
      is_downgrade: qualification_results.is_downgrade,
      card_brand: transactions.card_brand,
      card_product: transactions.card_product,
      mcc: transactions.mcc,
      processor_id: transactions.processor_id,
      entry_mode: transactions.entry_mode,
      batch_id: transactions.batch_id,
    })
    .from(qualification_results)
    .innerJoin(transactions, eq(qualification_results.transaction_id, transactions.id))
    .where(eq(qualification_results.workspace_id, workspaceId))

  const groups = new Map<string, EffectiveRateAccumulator>()
  for (const r of rows) {
    const raw = (r as Record<string, unknown>)[column as string]
    const key = raw == null || raw === '' ? '(unknown)' : String(raw)
    let acc = groups.get(key)
    if (!acc) {
      acc = {
        dimension_key: key,
        amount_cents: 0,
        billed_fee_cents: 0,
        optimal_fee_cents: 0,
        delta_cents: 0,
        txn_count: 0,
        downgrade_count: 0,
      }
      groups.set(key, acc)
    }
    acc.amount_cents += r.amount_cents ?? 0
    acc.billed_fee_cents += r.billed_fee_cents ?? 0
    acc.optimal_fee_cents += r.optimal_fee_cents ?? 0
    acc.delta_cents += r.delta_cents ?? 0
    acc.txn_count += 1
    if (r.is_downgrade) acc.downgrade_count += 1
  }

  const out = Array.from(groups.values()).map((g) => {
    const billed_bps = g.amount_cents > 0 ? (g.billed_fee_cents / g.amount_cents) * 10000 : 0
    const optimal_bps = g.amount_cents > 0 ? (g.optimal_fee_cents / g.amount_cents) * 10000 : 0
    return {
      dimension,
      dimension_key: g.dimension_key,
      amount_cents: g.amount_cents,
      billed_fee_cents: g.billed_fee_cents,
      optimal_fee_cents: g.optimal_fee_cents,
      delta_cents: g.delta_cents,
      billed_bps: Math.round(billed_bps * 100) / 100,
      optimal_bps: Math.round(optimal_bps * 100) / 100,
      delta_bps: Math.round((billed_bps - optimal_bps) * 100) / 100,
      txn_count: g.txn_count,
      downgrade_count: g.downgrade_count,
    }
  })

  out.sort((a, b) => b.delta_cents - a.delta_cents)
  return c.json(out)
})

// GET /trend — effective interchange rate over time (billed vs optimal bps per day).
// ?workspace_id= (required)
router.get('/trend', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const rows = await db
    .select({
      amount_cents: transactions.amount_cents,
      billed_fee_cents: qualification_results.billed_fee_cents,
      optimal_fee_cents: qualification_results.optimal_fee_cents,
      delta_cents: qualification_results.delta_cents,
      is_downgrade: qualification_results.is_downgrade,
      auth_timestamp: transactions.auth_timestamp,
      computed_at: qualification_results.computed_at,
    })
    .from(qualification_results)
    .innerJoin(transactions, eq(qualification_results.transaction_id, transactions.id))
    .where(eq(qualification_results.workspace_id, workspaceId))

  const buckets = new Map<string, EffectiveRateAccumulator>()
  for (const r of rows) {
    const ts = r.auth_timestamp ?? r.computed_at
    const day = ts ? new Date(ts).toISOString().slice(0, 10) : '(undated)'
    let acc = buckets.get(day)
    if (!acc) {
      acc = {
        dimension_key: day,
        amount_cents: 0,
        billed_fee_cents: 0,
        optimal_fee_cents: 0,
        delta_cents: 0,
        txn_count: 0,
        downgrade_count: 0,
      }
      buckets.set(day, acc)
    }
    acc.amount_cents += r.amount_cents ?? 0
    acc.billed_fee_cents += r.billed_fee_cents ?? 0
    acc.optimal_fee_cents += r.optimal_fee_cents ?? 0
    acc.delta_cents += r.delta_cents ?? 0
    acc.txn_count += 1
    if (r.is_downgrade) acc.downgrade_count += 1
  }

  const out = Array.from(buckets.values())
    .map((g) => {
      const billed_bps = g.amount_cents > 0 ? (g.billed_fee_cents / g.amount_cents) * 10000 : 0
      const optimal_bps = g.amount_cents > 0 ? (g.optimal_fee_cents / g.amount_cents) * 10000 : 0
      return {
        period: g.dimension_key,
        amount_cents: g.amount_cents,
        billed_fee_cents: g.billed_fee_cents,
        optimal_fee_cents: g.optimal_fee_cents,
        delta_cents: g.delta_cents,
        billed_bps: Math.round(billed_bps * 100) / 100,
        optimal_bps: Math.round(optimal_bps * 100) / 100,
        delta_bps: Math.round((billed_bps - optimal_bps) * 100) / 100,
        txn_count: g.txn_count,
        downgrade_count: g.downgrade_count,
      }
    })
    .sort((a, b) => a.period.localeCompare(b.period))

  return c.json(out)
})

export default router
