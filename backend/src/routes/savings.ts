import { Hono } from 'hono'
import { db } from '../db/index.js'
import { recoverable_savings } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'

const router = new Hono()

// GET / — recoverable-savings ledger for a workspace, optionally filtered by scope.
// ?workspace_id= (required) &scope=
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const scope = c.req.query('scope')

  const conditions = [eq(recoverable_savings.workspace_id, workspaceId)]
  if (scope) conditions.push(eq(recoverable_savings.scope, scope))

  const rows = await db
    .select()
    .from(recoverable_savings)
    .where(and(...conditions))
    .orderBy(desc(recoverable_savings.recoverable_cents))

  return c.json(rows)
})

// GET /summary — total + annualized recoverable for a workspace.
// ?workspace_id= (required). Aggregates the 'total' scope row when present,
// otherwise sums the most granular per-transaction scope to avoid double-counting.
router.get('/summary', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const rows = await db
    .select()
    .from(recoverable_savings)
    .where(eq(recoverable_savings.workspace_id, workspaceId))

  // Prefer an explicit roll-up scope if the engine wrote one.
  const totalRows = rows.filter((r) => r.scope === 'total')
  let source = totalRows
  if (source.length === 0) {
    // Pick a single non-total scope family (the one with the most rows) and sum it,
    // so overlapping scopes (brand + mcc + processor) are not double-counted.
    const byScope = new Map<string, typeof rows>()
    for (const r of rows) {
      if (r.scope === 'total') continue
      const arr = byScope.get(r.scope) ?? []
      arr.push(r)
      byScope.set(r.scope, arr)
    }
    let best: typeof rows = []
    for (const arr of byScope.values()) {
      if (arr.length > best.length) best = arr
    }
    source = best
  }

  const recoverable_cents = source.reduce((s, r) => s + (r.recoverable_cents ?? 0), 0)
  const annualized_cents = source.reduce((s, r) => s + (r.annualized_cents ?? 0), 0)
  const txn_count = source.reduce((s, r) => s + (r.txn_count ?? 0), 0)

  return c.json({ recoverable_cents, annualized_cents, txn_count })
})

export default router
