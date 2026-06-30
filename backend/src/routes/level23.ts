import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  downgrade_causes,
  qualification_results,
  transactions,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'

const router = new Hono()

// ---------------------------------------------------------------------------
// Level 2/3 eligibility gap report.
//
// A transaction has an L2 gap when a `missing_level2` downgrade cause was
// attributed to it (it could have qualified for a Level-2 category but the
// L2 data was absent). Likewise `missing_level3` for L3 gaps. These causes
// are produced by the deterministic qualification engine.
// ---------------------------------------------------------------------------

const L2_CAUSE = 'missing_level2'
const L3_CAUSE = 'missing_level3'

// Public: L2/L3 eligibility gaps (?workspace_id=&level=)
// `level` may be '2' or '3'; omitted returns both.
router.get('/gaps', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const level = c.req.query('level')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const wantedCauses: string[] = []
  if (level === '2') wantedCauses.push(L2_CAUSE)
  else if (level === '3') wantedCauses.push(L3_CAUSE)
  else wantedCauses.push(L2_CAUSE, L3_CAUSE)

  const rows = await db
    .select({
      cause: downgrade_causes,
      txn: transactions,
      result: qualification_results,
    })
    .from(downgrade_causes)
    .innerJoin(transactions, eq(downgrade_causes.transaction_id, transactions.id))
    .innerJoin(qualification_results, eq(downgrade_causes.qualification_result_id, qualification_results.id))
    .where(eq(downgrade_causes.workspace_id, workspaceId))

  const out = rows
    .filter((r) => wantedCauses.includes(r.cause.cause_code))
    .map((r) => ({
      id: r.cause.id,
      transaction_id: r.cause.transaction_id,
      batch_id: r.txn.batch_id,
      external_ref: r.txn.external_ref,
      amount_cents: r.txn.amount_cents,
      card_brand: r.txn.card_brand,
      card_product: r.txn.card_product,
      mcc: r.txn.mcc,
      has_level2: r.txn.has_level2,
      has_level3: r.txn.has_level3,
      level: r.cause.cause_code === L3_CAUSE ? 3 : 2,
      cause_code: r.cause.cause_code,
      billed_category_code: r.txn.billed_category_code,
      optimal_category_code: r.result.optimal_category_code,
      delta_cents: r.result.delta_cents,
      recoverable_cents: r.cause.recoverable_cents,
      required_fix: r.cause.required_fix,
      created_at: r.cause.created_at,
    }))
    .sort((a, b) => (b.recoverable_cents ?? 0) - (a.recoverable_cents ?? 0))

  return c.json(out)
})

// Public: L2 vs L3 opportunity totals (?workspace_id=)
router.get('/summary', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const rows = await db
    .select()
    .from(downgrade_causes)
    .where(eq(downgrade_causes.workspace_id, workspaceId))

  const level2 = { txn_count: 0, recoverable_cents: 0 }
  const level3 = { txn_count: 0, recoverable_cents: 0 }

  for (const r of rows) {
    if (r.cause_code === L2_CAUSE) {
      level2.txn_count += 1
      level2.recoverable_cents += r.recoverable_cents ?? 0
    } else if (r.cause_code === L3_CAUSE) {
      level3.txn_count += 1
      level3.recoverable_cents += r.recoverable_cents ?? 0
    }
  }

  const total = {
    txn_count: level2.txn_count + level3.txn_count,
    recoverable_cents: level2.recoverable_cents + level3.recoverable_cents,
  }

  return c.json({ level2, level3, total })
})

export default router
