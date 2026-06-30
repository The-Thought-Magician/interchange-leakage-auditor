import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  transactions,
  qualification_results,
  downgrade_causes,
  upload_batches,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'

const router = new Hono()

// ---------------------------------------------------------------------------
// GET /overview — portfolio KPIs for a workspace.
//   leakage_cents   = sum of positive delta_cents across downgrades
//   downgrade_rate  = downgrades / qualified results (0..1)
//   recoverable_cents = same as leakage (recoverable through fixes)
//   txn_count       = transactions in workspace
//   batch_count     = upload batches in workspace
// ---------------------------------------------------------------------------

router.get('/overview', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const results = await db
    .select()
    .from(qualification_results)
    .where(eq(qualification_results.workspace_id, workspaceId))

  let leakageCents = 0
  let downgradeCount = 0
  for (const r of results) {
    if (r.is_downgrade) {
      downgradeCount += 1
      leakageCents += Math.max(0, r.delta_cents ?? 0)
    }
  }
  const qualifiedCount = results.length
  const downgradeRate = qualifiedCount > 0 ? downgradeCount / qualifiedCount : 0

  const txns = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.workspace_id, workspaceId))

  const batches = await db
    .select({ id: upload_batches.id })
    .from(upload_batches)
    .where(eq(upload_batches.workspace_id, workspaceId))

  return c.json({
    leakage_cents: leakageCents,
    downgrade_rate: downgradeRate,
    downgrade_count: downgradeCount,
    qualified_count: qualifiedCount,
    recoverable_cents: leakageCents,
    annualized_cents: leakageCents * 12,
    txn_count: txns.length,
    batch_count: batches.length,
  })
})

// ---------------------------------------------------------------------------
// GET /top-causes — top downgrade causes by recoverable dollars.
//   Returns CauseBreakdown[]: { cause_code, count, recoverable_cents }
// ---------------------------------------------------------------------------

router.get('/top-causes', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const limit = Math.max(1, Math.min(100, parseInt(c.req.query('limit') ?? '10', 10) || 10))

  const causes = await db
    .select()
    .from(downgrade_causes)
    .where(eq(downgrade_causes.workspace_id, workspaceId))

  const agg = new Map<string, { cause_code: string; count: number; recoverable_cents: number; required_fix: string | null }>()
  for (const cause of causes) {
    const entry = agg.get(cause.cause_code) ?? {
      cause_code: cause.cause_code,
      count: 0,
      recoverable_cents: 0,
      required_fix: cause.required_fix ?? null,
    }
    entry.count += 1
    entry.recoverable_cents += cause.recoverable_cents ?? 0
    if (!entry.required_fix && cause.required_fix) entry.required_fix = cause.required_fix
    agg.set(cause.cause_code, entry)
  }

  const out = Array.from(agg.values()).sort((a, b) => b.recoverable_cents - a.recoverable_cents).slice(0, limit)
  return c.json(out)
})

// ---------------------------------------------------------------------------
// GET /top-mccs — top MCCs by leakage dollars.
//   Joins qualification_results (downgrades) to their transactions and groups
//   by transaction MCC. Returns MccLeakage[]: { mcc, leakage_cents, txn_count }
// ---------------------------------------------------------------------------

router.get('/top-mccs', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const limit = Math.max(1, Math.min(100, parseInt(c.req.query('limit') ?? '10', 10) || 10))

  const rows = await db
    .select({
      mcc: transactions.mcc,
      delta_cents: qualification_results.delta_cents,
      is_downgrade: qualification_results.is_downgrade,
    })
    .from(qualification_results)
    .innerJoin(transactions, eq(qualification_results.transaction_id, transactions.id))
    .where(
      and(
        eq(qualification_results.workspace_id, workspaceId),
        eq(qualification_results.is_downgrade, true),
      ),
    )

  const agg = new Map<string, { mcc: string; leakage_cents: number; txn_count: number }>()
  for (const r of rows) {
    const mcc = r.mcc ?? 'unknown'
    const entry = agg.get(mcc) ?? { mcc, leakage_cents: 0, txn_count: 0 }
    entry.leakage_cents += Math.max(0, r.delta_cents ?? 0)
    entry.txn_count += 1
    agg.set(mcc, entry)
  }

  const out = Array.from(agg.values()).sort((a, b) => b.leakage_cents - a.leakage_cents).slice(0, limit)
  return c.json(out)
})

export default router
