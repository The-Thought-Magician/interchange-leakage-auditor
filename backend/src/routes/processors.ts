import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { processors, workspaces } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  mid: z.string().optional().nullable(),
  pricing_model: z.string().min(1).optional().default('interchange_plus'),
  plus_bps: z.number().optional().default(0),
  plus_per_item_cents: z.number().int().optional().default(0),
  notes: z.string().optional().nullable(),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  mid: z.string().optional().nullable(),
  pricing_model: z.string().min(1).optional(),
  plus_bps: z.number().optional(),
  plus_per_item_cents: z.number().int().optional(),
  notes: z.string().optional().nullable(),
})

// Returns true when the caller owns the given workspace.
async function ownsWorkspace(workspaceId: string, userId: string): Promise<boolean> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  return !!ws && ws.owner_id === userId
}

// GET / — public — list processors, optionally scoped to a workspace.
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const rows = workspaceId
    ? await db
        .select()
        .from(processors)
        .where(eq(processors.workspace_id, workspaceId))
        .orderBy(desc(processors.created_at))
    : await db.select().from(processors).orderBy(desc(processors.created_at))
  return c.json(rows)
})

// GET /:id — public — processor detail.
router.get('/:id', async (c) => {
  const [p] = await db.select().from(processors).where(eq(processors.id, c.req.param('id')))
  if (!p) return c.json({ error: 'Not found' }, 404)
  return c.json(p)
})

// POST / — auth — create a processor (caller must own the workspace).
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, body.workspace_id))
  if (!ws) return c.json({ error: 'Workspace not found' }, 404)
  if (ws.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const [p] = await db
    .insert(processors)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      mid: body.mid ?? null,
      pricing_model: body.pricing_model,
      plus_bps: body.plus_bps,
      plus_per_item_cents: body.plus_per_item_cents,
      notes: body.notes ?? null,
    })
    .returning()
  return c.json(p, 201)
})

// PUT /:id — auth (owner) — update a processor.
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(processors).where(eq(processors.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await ownsWorkspace(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const body = c.req.valid('json')
  const [updated] = await db.update(processors).set(body).where(eq(processors.id, id)).returning()
  return c.json(updated)
})

// DELETE /:id — auth (owner) — delete a processor.
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(processors).where(eq(processors.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await ownsWorkspace(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await db.delete(processors).where(eq(processors.id, id))
  return c.json({ success: true })
})

export default router
