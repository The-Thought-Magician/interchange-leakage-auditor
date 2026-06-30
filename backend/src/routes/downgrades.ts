import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  downgrade_causes,
  qualification_results,
  transactions,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'

const router = new Hono()

// ---------------------------------------------------------------------------
// Downgrade detector — read views over qualification engine output.
// ---------------------------------------------------------------------------

// Public: flagged downgrades list (?workspace_id=&batch_id=&cause=)
// Each row joins the downgrade cause to its transaction + qualification result.
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const batchId = c.req.query('batch_id')
  const cause = c.req.query('cause')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const conds = [eq(downgrade_causes.workspace_id, workspaceId)]
  if (cause) conds.push(eq(downgrade_causes.cause_code, cause))

  const rows = await db
    .select({
      cause: downgrade_causes,
      txn: transactions,
      result: qualification_results,
    })
    .from(downgrade_causes)
    .innerJoin(transactions, eq(downgrade_causes.transaction_id, transactions.id))
    .innerJoin(qualification_results, eq(downgrade_causes.qualification_result_id, qualification_results.id))
    .where(and(...conds))
    .orderBy(desc(downgrade_causes.recoverable_cents))

  const out = rows
    .filter((r) => !batchId || r.txn.batch_id === batchId)
    .map((r) => ({
      id: r.cause.id,
      transaction_id: r.cause.transaction_id,
      qualification_result_id: r.cause.qualification_result_id,
      batch_id: r.txn.batch_id,
      external_ref: r.txn.external_ref,
      amount_cents: r.txn.amount_cents,
      card_brand: r.txn.card_brand,
      card_product: r.txn.card_product,
      mcc: r.txn.mcc,
      billed_category_code: r.txn.billed_category_code,
      optimal_category_code: r.result.optimal_category_code,
      delta_cents: r.result.delta_cents,
      delta_bps: r.result.delta_bps,
      cause_code: r.cause.cause_code,
      severity: r.cause.severity,
      recoverable_cents: r.cause.recoverable_cents,
      required_fix: r.cause.required_fix,
      detail: r.cause.detail,
      created_at: r.cause.created_at,
    }))

  return c.json(out)
})

// Public: count + dollars by cause (?workspace_id=)
router.get('/causes/breakdown', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const rows = await db
    .select()
    .from(downgrade_causes)
    .where(eq(downgrade_causes.workspace_id, workspaceId))

  const byCause = new Map<
    string,
    { cause_code: string; count: number; recoverable_cents: number; severity: string; required_fix: string | null }
  >()

  for (const r of rows) {
    const e = byCause.get(r.cause_code) ?? {
      cause_code: r.cause_code,
      count: 0,
      recoverable_cents: 0,
      severity: r.severity,
      required_fix: r.required_fix,
    }
    e.count += 1
    e.recoverable_cents += r.recoverable_cents ?? 0
    // Keep the highest severity seen for the cause.
    const order: Record<string, number> = { low: 1, medium: 2, high: 3 }
    if ((order[r.severity] ?? 0) > (order[e.severity] ?? 0)) e.severity = r.severity
    byCause.set(r.cause_code, e)
  }

  const out = Array.from(byCause.values()).sort((a, b) => b.recoverable_cents - a.recoverable_cents)
  return c.json(out)
})

export default router
