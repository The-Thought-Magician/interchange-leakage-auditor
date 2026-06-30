import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  transactions,
  qualification_results,
  downgrade_causes,
  workspaces,
  workspace_members,
} from '../db/schema.js'
import { eq, and, desc, gte, lte, inArray, ilike, or, type SQL } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function userCanWriteWorkspace(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  if (!ws) return false
  if (ws.owner_id === userId) return true
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!member
}

function parseBoolQuery(v: string | undefined): boolean {
  if (!v) return false
  const s = v.toLowerCase()
  return s === 'true' || s === '1' || s === 'yes'
}

// ---------------------------------------------------------------------------
// GET / — public — list / search / filter transactions
// query: workspace_id (required), batch_id, processor_id, brand, product, mcc,
//        downgrade_only, q, from, to, limit, offset
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const conditions: SQL[] = [eq(transactions.workspace_id, workspaceId)]

  const batchId = c.req.query('batch_id')
  if (batchId) conditions.push(eq(transactions.batch_id, batchId))

  const processorId = c.req.query('processor_id')
  if (processorId) conditions.push(eq(transactions.processor_id, processorId))

  const brand = c.req.query('brand')
  if (brand) conditions.push(eq(transactions.card_brand, brand))

  const product = c.req.query('product')
  if (product) conditions.push(eq(transactions.card_product, product))

  const mcc = c.req.query('mcc')
  if (mcc) conditions.push(eq(transactions.mcc, mcc))

  const from = c.req.query('from')
  if (from) {
    const d = new Date(from)
    if (!Number.isNaN(d.getTime())) conditions.push(gte(transactions.auth_timestamp, d))
  }

  const to = c.req.query('to')
  if (to) {
    const d = new Date(to)
    if (!Number.isNaN(d.getTime())) conditions.push(lte(transactions.auth_timestamp, d))
  }

  const q = c.req.query('q')
  if (q && q.trim()) {
    const pattern = `%${q.trim()}%`
    const search = or(
      ilike(transactions.external_ref, pattern),
      ilike(transactions.mcc, pattern),
      ilike(transactions.card_brand, pattern),
      ilike(transactions.card_product, pattern),
      ilike(transactions.billed_category_code, pattern),
    )
    if (search) conditions.push(search)
  }

  const limitRaw = parseInt(c.req.query('limit') ?? '500', 10)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 2000)) : 500
  const offsetRaw = parseInt(c.req.query('offset') ?? '0', 10)
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0

  const rows = await db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.auth_timestamp), desc(transactions.created_at))
    .limit(limit)
    .offset(offset)

  // downgrade_only filter requires the qualification result; join in memory.
  const downgradeOnly = parseBoolQuery(c.req.query('downgrade_only'))
  if (!downgradeOnly) return c.json(rows)

  if (rows.length === 0) return c.json([])
  const ids = rows.map((r) => r.id)
  const results = await db
    .select()
    .from(qualification_results)
    .where(inArray(qualification_results.transaction_id, ids))
  const downgradeSet = new Set(results.filter((r) => r.is_downgrade).map((r) => r.transaction_id))
  return c.json(rows.filter((r) => downgradeSet.has(r.id)))
})

// ---------------------------------------------------------------------------
// POST /bulk/tag — auth — add/remove a tag across many transactions
// ---------------------------------------------------------------------------

const bulkTagSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  tag: z.string().min(1),
  op: z.enum(['add', 'remove']).optional().default('add'),
})

router.post('/bulk/tag', authMiddleware, zValidator('json', bulkTagSchema), async (c) => {
  const userId = getUserId(c)
  const { ids, tag, op } = c.req.valid('json')

  const rows = await db.select().from(transactions).where(inArray(transactions.id, ids))
  if (rows.length === 0) return c.json({ updated: 0 })

  // Ownership: every targeted txn must belong to a workspace the caller can write.
  const wsIds = Array.from(new Set(rows.map((r) => r.workspace_id)))
  for (const wsId of wsIds) {
    if (!(await userCanWriteWorkspace(wsId, userId))) return c.json({ error: 'Forbidden' }, 403)
  }

  let updated = 0
  for (const t of rows) {
    const current = (t.tags ?? []) as string[]
    let next: string[]
    if (op === 'add') {
      if (current.includes(tag)) continue
      next = [...current, tag]
    } else {
      if (!current.includes(tag)) continue
      next = current.filter((x) => x !== tag)
    }
    await db.update(transactions).set({ tags: next }).where(eq(transactions.id, t.id))
    updated++
  }

  return c.json({ updated })
})

// ---------------------------------------------------------------------------
// POST /bulk/delete — auth — delete many transactions (+ dependent rows)
// ---------------------------------------------------------------------------

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
})

router.post('/bulk/delete', authMiddleware, zValidator('json', bulkDeleteSchema), async (c) => {
  const userId = getUserId(c)
  const { ids } = c.req.valid('json')

  const rows = await db.select().from(transactions).where(inArray(transactions.id, ids))
  if (rows.length === 0) return c.json({ deleted: 0 })

  const wsIds = Array.from(new Set(rows.map((r) => r.workspace_id)))
  for (const wsId of wsIds) {
    if (!(await userCanWriteWorkspace(wsId, userId))) return c.json({ error: 'Forbidden' }, 403)
  }

  const realIds = rows.map((r) => r.id)
  await db.delete(downgrade_causes).where(inArray(downgrade_causes.transaction_id, realIds))
  await db.delete(qualification_results).where(inArray(qualification_results.transaction_id, realIds))
  await db.delete(transactions).where(inArray(transactions.id, realIds))

  return c.json({ deleted: realIds.length })
})

// ---------------------------------------------------------------------------
// GET /:id — public — transaction + its qualification_result + downgrade_causes
// ---------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [transaction] = await db.select().from(transactions).where(eq(transactions.id, id))
  if (!transaction) return c.json({ error: 'Not found' }, 404)

  const [result] = await db
    .select()
    .from(qualification_results)
    .where(eq(qualification_results.transaction_id, id))

  const causes = await db
    .select()
    .from(downgrade_causes)
    .where(eq(downgrade_causes.transaction_id, id))
    .orderBy(desc(downgrade_causes.recoverable_cents))

  return c.json({ transaction, result: result ?? null, causes })
})

// ---------------------------------------------------------------------------
// POST /:id/tags — auth — set the full tag set on one transaction
// ---------------------------------------------------------------------------

const setTagsSchema = z.object({
  tags: z.array(z.string().min(1)),
})

router.post('/:id/tags', authMiddleware, zValidator('json', setTagsSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const { tags } = c.req.valid('json')

  const [existing] = await db.select().from(transactions).where(eq(transactions.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await userCanWriteWorkspace(existing.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  // De-duplicate while preserving order.
  const deduped = Array.from(new Set(tags))
  const [updated] = await db
    .update(transactions)
    .set({ tags: deduped })
    .where(eq(transactions.id, id))
    .returning()

  return c.json(updated)
})

export default router
