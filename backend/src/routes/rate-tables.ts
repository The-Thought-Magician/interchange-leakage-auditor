import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { rate_table_versions, interchange_categories, workspaces } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  workspace_id: z.string().min(1),
  brand: z.string().min(1),
  name: z.string().min(1),
  effective_date: z.string().datetime().optional().nullable(),
  is_active: z.boolean().optional().default(false),
  source_note: z.string().optional().nullable(),
})

const updateSchema = z.object({
  brand: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  effective_date: z.string().datetime().optional().nullable(),
  source_note: z.string().optional().nullable(),
})

const cloneSchema = z
  .object({
    name: z.string().min(1).optional(),
  })
  .optional()

// Returns true when the caller owns the given workspace.
async function ownsWorkspace(workspaceId: string, userId: string): Promise<boolean> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  return !!ws && ws.owner_id === userId
}

// GET / — public — list versions, optionally scoped by workspace + brand.
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const brand = c.req.query('brand')
  const conditions = []
  if (workspaceId) conditions.push(eq(rate_table_versions.workspace_id, workspaceId))
  if (brand) conditions.push(eq(rate_table_versions.brand, brand))
  const rows = conditions.length
    ? await db
        .select()
        .from(rate_table_versions)
        .where(and(...conditions))
        .orderBy(desc(rate_table_versions.created_at))
    : await db.select().from(rate_table_versions).orderBy(desc(rate_table_versions.created_at))
  return c.json(rows)
})

// GET /:id — public — version detail plus its interchange categories.
router.get('/:id', async (c) => {
  const [version] = await db
    .select()
    .from(rate_table_versions)
    .where(eq(rate_table_versions.id, c.req.param('id')))
  if (!version) return c.json({ error: 'Not found' }, 404)
  const categories = await db
    .select()
    .from(interchange_categories)
    .where(eq(interchange_categories.version_id, version.id))
    .orderBy(interchange_categories.tier_rank)
  return c.json({ version, categories })
})

// POST / — auth — create a version (caller must own the workspace).
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, body.workspace_id))
  if (!ws) return c.json({ error: 'Workspace not found' }, 404)
  if (ws.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const [version] = await db
    .insert(rate_table_versions)
    .values({
      workspace_id: body.workspace_id,
      brand: body.brand,
      name: body.name,
      effective_date: body.effective_date ? new Date(body.effective_date) : null,
      is_active: body.is_active ?? false,
      source_note: body.source_note ?? null,
    })
    .returning()
  return c.json(version, 201)
})

// PUT /:id — auth (owner) — update version metadata.
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(rate_table_versions)
    .where(eq(rate_table_versions.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await ownsWorkspace(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.brand !== undefined) patch.brand = body.brand
  if (body.name !== undefined) patch.name = body.name
  if (body.source_note !== undefined) patch.source_note = body.source_note
  if (body.effective_date !== undefined) {
    patch.effective_date = body.effective_date ? new Date(body.effective_date) : null
  }
  const [updated] = await db
    .update(rate_table_versions)
    .set(patch)
    .where(eq(rate_table_versions.id, id))
    .returning()
  return c.json(updated)
})

// POST /:id/activate — auth (owner) — set active, deactivating same-brand siblings.
router.post('/:id/activate', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(rate_table_versions)
    .where(eq(rate_table_versions.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await ownsWorkspace(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  // Deactivate every version of the same brand in this workspace.
  await db
    .update(rate_table_versions)
    .set({ is_active: false })
    .where(
      and(
        eq(rate_table_versions.workspace_id, existing.workspace_id),
        eq(rate_table_versions.brand, existing.brand),
      ),
    )
  const [activated] = await db
    .update(rate_table_versions)
    .set({ is_active: true })
    .where(eq(rate_table_versions.id, id))
    .returning()
  return c.json(activated)
})

// POST /:id/clone — auth (owner) — clone a version and all its categories.
router.post('/:id/clone', authMiddleware, zValidator('json', cloneSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [source] = await db
    .select()
    .from(rate_table_versions)
    .where(eq(rate_table_versions.id, id))
  if (!source) return c.json({ error: 'Not found' }, 404)
  if (!(await ownsWorkspace(source.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const body = c.req.valid('json')
  const cloneName = body?.name ?? `${source.name} (copy)`
  const [cloned] = await db
    .insert(rate_table_versions)
    .values({
      workspace_id: source.workspace_id,
      brand: source.brand,
      name: cloneName,
      effective_date: source.effective_date,
      is_active: false,
      source_note: source.source_note,
    })
    .returning()

  const sourceCategories = await db
    .select()
    .from(interchange_categories)
    .where(eq(interchange_categories.version_id, id))
  if (sourceCategories.length) {
    await db.insert(interchange_categories).values(
      sourceCategories.map((cat) => ({
        version_id: cloned.id,
        brand: cat.brand,
        code: cat.code,
        name: cat.name,
        card_product: cat.card_product,
        mcc_set: cat.mcc_set,
        percent_rate: cat.percent_rate,
        per_item_cents: cat.per_item_cents,
        requires_level2: cat.requires_level2,
        requires_level3: cat.requires_level3,
        requires_avs: cat.requires_avs,
        requires_card_present: cat.requires_card_present,
        max_settlement_hours: cat.max_settlement_hours,
        tier_rank: cat.tier_rank,
        notes: cat.notes,
      })),
    )
  }
  return c.json(cloned, 201)
})

// DELETE /:id — auth (owner) — delete a version and its categories.
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(rate_table_versions)
    .where(eq(rate_table_versions.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await ownsWorkspace(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await db.delete(interchange_categories).where(eq(interchange_categories.version_id, id))
  await db.delete(rate_table_versions).where(eq(rate_table_versions.id, id))
  return c.json({ success: true })
})

export default router
