import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { tags, workspaces } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().min(1).optional().default('#6366f1'),
})

async function isOwner(workspaceId: string, userId: string): Promise<boolean> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  return !!ws && ws.owner_id === userId
}

// Public: list reusable tag definitions for a workspace.
// GET /?workspace_id=
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const rows = await db
    .select()
    .from(tags)
    .where(eq(tags.workspace_id, workspaceId))
    .orderBy(desc(tags.created_at))

  return c.json(rows)
})

// Auth: create a tag definition. UNIQUE(workspace_id, name) is enforced.
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, body.workspace_id))
  if (!ws) return c.json({ error: 'Workspace not found' }, 404)
  if (ws.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const [existing] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.workspace_id, body.workspace_id), eq(tags.name, body.name)))
  if (existing) return c.json({ error: 'Tag with this name already exists in workspace' }, 400)

  const [created] = await db
    .insert(tags)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      color: body.color,
    })
    .returning()

  return c.json(created, 201)
})

// Auth (owner): delete a tag definition.
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db.select().from(tags).where(eq(tags.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isOwner(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(tags).where(eq(tags.id, id))
  return c.json({ success: true })
})

export default router
