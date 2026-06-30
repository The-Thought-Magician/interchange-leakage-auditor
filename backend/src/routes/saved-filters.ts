import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { saved_filters } from '../db/schema.js'
import { eq, and, or, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  query: z.record(z.unknown()).optional().default({}),
  is_shared: z.boolean().optional().default(false),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  query: z.record(z.unknown()).optional(),
  is_shared: z.boolean().optional(),
})

// Public-ish read: list saved filters for a workspace.
// Returns shared filters for everyone; if the caller identifies via X-User-Id,
// also includes their own private filters. Shareable within the workspace.
// GET /?workspace_id=
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const userId = getUserId(c)
  const visibility = userId
    ? or(eq(saved_filters.is_shared, true), eq(saved_filters.user_id, userId))
    : eq(saved_filters.is_shared, true)

  const rows = await db
    .select()
    .from(saved_filters)
    .where(and(eq(saved_filters.workspace_id, workspaceId), visibility))
    .orderBy(desc(saved_filters.created_at))

  return c.json(rows)
})

// Auth: create a saved filter owned by the caller.
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [created] = await db
    .insert(saved_filters)
    .values({
      workspace_id: body.workspace_id,
      user_id: userId,
      name: body.name,
      query: body.query as Record<string, unknown>,
      is_shared: body.is_shared,
    })
    .returning()

  return c.json(created, 201)
})

// Auth (owner): update a saved filter. Only the creating user may edit it.
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db.select().from(saved_filters).where(eq(saved_filters.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Partial<typeof saved_filters.$inferInsert> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.query !== undefined) patch.query = body.query as Record<string, unknown>
  if (body.is_shared !== undefined) patch.is_shared = body.is_shared

  const [updated] = await db.update(saved_filters).set(patch).where(eq(saved_filters.id, id)).returning()
  return c.json(updated)
})

// Auth (owner): delete a saved filter. Only the creating user may delete it.
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db.select().from(saved_filters).where(eq(saved_filters.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(saved_filters).where(eq(saved_filters.id, id))
  return c.json({ success: true })
})

export default router
