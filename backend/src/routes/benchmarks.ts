import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { benchmarks, workspaces } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  workspace_id: z.string().min(1),
  dimension: z.string().min(1),
  dimension_key: z.string().min(1),
  band_low_bps: z.number().optional().default(0),
  band_target_bps: z.number().optional().default(0),
  band_high_bps: z.number().optional().default(0),
  source_note: z.string().optional().nullable(),
})

const updateSchema = z.object({
  dimension: z.string().min(1).optional(),
  dimension_key: z.string().min(1).optional(),
  band_low_bps: z.number().optional(),
  band_target_bps: z.number().optional(),
  band_high_bps: z.number().optional(),
  source_note: z.string().optional().nullable(),
})

async function isOwner(workspaceId: string, userId: string): Promise<boolean> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  return !!ws && ws.owner_id === userId
}

// Public: list effective-rate benchmark bands for a workspace, optional dimension filter.
// GET /?workspace_id=&dimension=
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const dimension = c.req.query('dimension')
  const conditions = [eq(benchmarks.workspace_id, workspaceId)]
  if (dimension) conditions.push(eq(benchmarks.dimension, dimension))

  const rows = await db
    .select()
    .from(benchmarks)
    .where(and(...conditions))
    .orderBy(desc(benchmarks.created_at))

  return c.json(rows)
})

// Auth: create a benchmark band.
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, body.workspace_id))
  if (!ws) return c.json({ error: 'Workspace not found' }, 404)
  if (ws.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const [created] = await db
    .insert(benchmarks)
    .values({
      workspace_id: body.workspace_id,
      dimension: body.dimension,
      dimension_key: body.dimension_key,
      band_low_bps: body.band_low_bps,
      band_target_bps: body.band_target_bps,
      band_high_bps: body.band_high_bps,
      source_note: body.source_note ?? null,
    })
    .returning()

  return c.json(created, 201)
})

// Auth (owner): update a benchmark band.
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db.select().from(benchmarks).where(eq(benchmarks.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isOwner(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const [updated] = await db.update(benchmarks).set(body).where(eq(benchmarks.id, id)).returning()
  return c.json(updated)
})

// Auth (owner): delete a benchmark band.
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db.select().from(benchmarks).where(eq(benchmarks.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isOwner(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(benchmarks).where(eq(benchmarks.id, id))
  return c.json({ success: true })
})

export default router
