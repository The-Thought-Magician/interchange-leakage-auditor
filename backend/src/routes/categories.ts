import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { interchange_categories, rate_table_versions, workspaces, workspace_members } from '../db/schema.js'
import { eq, and, asc } from 'drizzle-orm'
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

const categorySchema = z.object({
  version_id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  card_product: z.string().nullable().optional(),
  mcc_set: z.array(z.string()).optional().default([]),
  percent_rate: z.number().optional().default(0),
  per_item_cents: z.number().int().optional().default(0),
  requires_level2: z.boolean().optional().default(false),
  requires_level3: z.boolean().optional().default(false),
  requires_avs: z.boolean().optional().default(false),
  requires_card_present: z.boolean().optional().default(false),
  max_settlement_hours: z.number().int().nullable().optional(),
  tier_rank: z.number().int().optional().default(0),
  notes: z.string().nullable().optional(),
})

const categoryUpdateSchema = categorySchema.partial().omit({ version_id: true })

// ---------------------------------------------------------------------------
// GET / — public — list categories for a rate-table version (?version_id=)
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const versionId = c.req.query('version_id')
  if (!versionId) return c.json({ error: 'version_id is required' }, 400)
  const rows = await db
    .select()
    .from(interchange_categories)
    .where(eq(interchange_categories.version_id, versionId))
    .orderBy(asc(interchange_categories.tier_rank), asc(interchange_categories.code))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST / — auth — create a category under a version
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', categorySchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [version] = await db
    .select()
    .from(rate_table_versions)
    .where(eq(rate_table_versions.id, body.version_id))
  if (!version) return c.json({ error: 'Rate-table version not found' }, 404)

  if (!(await userCanWriteWorkspace(version.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  const [created] = await db
    .insert(interchange_categories)
    .values({
      version_id: body.version_id,
      brand: version.brand,
      code: body.code,
      name: body.name,
      card_product: body.card_product ?? null,
      mcc_set: body.mcc_set ?? [],
      percent_rate: body.percent_rate ?? 0,
      per_item_cents: body.per_item_cents ?? 0,
      requires_level2: body.requires_level2 ?? false,
      requires_level3: body.requires_level3 ?? false,
      requires_avs: body.requires_avs ?? false,
      requires_card_present: body.requires_card_present ?? false,
      max_settlement_hours: body.max_settlement_hours ?? null,
      tier_rank: body.tier_rank ?? 0,
      notes: body.notes ?? null,
    })
    .returning()

  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — auth (workspace owner/member) — update a category
// ---------------------------------------------------------------------------

router.put('/:id', authMiddleware, zValidator('json', categoryUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db
    .select()
    .from(interchange_categories)
    .where(eq(interchange_categories.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const [version] = await db
    .select()
    .from(rate_table_versions)
    .where(eq(rate_table_versions.id, existing.version_id))
  if (!version) return c.json({ error: 'Rate-table version not found' }, 404)

  if (!(await userCanWriteWorkspace(version.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  const patch: Record<string, unknown> = {}
  if (body.code !== undefined) patch.code = body.code
  if (body.name !== undefined) patch.name = body.name
  if (body.card_product !== undefined) patch.card_product = body.card_product
  if (body.mcc_set !== undefined) patch.mcc_set = body.mcc_set
  if (body.percent_rate !== undefined) patch.percent_rate = body.percent_rate
  if (body.per_item_cents !== undefined) patch.per_item_cents = body.per_item_cents
  if (body.requires_level2 !== undefined) patch.requires_level2 = body.requires_level2
  if (body.requires_level3 !== undefined) patch.requires_level3 = body.requires_level3
  if (body.requires_avs !== undefined) patch.requires_avs = body.requires_avs
  if (body.requires_card_present !== undefined) patch.requires_card_present = body.requires_card_present
  if (body.max_settlement_hours !== undefined) patch.max_settlement_hours = body.max_settlement_hours
  if (body.tier_rank !== undefined) patch.tier_rank = body.tier_rank
  if (body.notes !== undefined) patch.notes = body.notes

  if (Object.keys(patch).length === 0) return c.json(existing)

  const [updated] = await db
    .update(interchange_categories)
    .set(patch)
    .where(eq(interchange_categories.id, id))
    .returning()

  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — auth (workspace owner/member) — delete a category
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db
    .select()
    .from(interchange_categories)
    .where(eq(interchange_categories.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const [version] = await db
    .select()
    .from(rate_table_versions)
    .where(eq(rate_table_versions.id, existing.version_id))
  if (version && !(await userCanWriteWorkspace(version.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  await db.delete(interchange_categories).where(eq(interchange_categories.id, id))
  return c.json({ success: true })
})

export default router
