import { Hono } from 'hono'
import { db } from '../db/index.js'
import { notifications } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// GET / — auth — list caller's notifications (?workspace_id=)
// ---------------------------------------------------------------------------

router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')

  const conditions = [eq(notifications.user_id, userId)]
  if (workspaceId) conditions.push(eq(notifications.workspace_id, workspaceId))

  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.created_at))

  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /:id/read — auth — mark one notification read
// ---------------------------------------------------------------------------

router.post('/:id/read', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db.select().from(notifications).where(eq(notifications.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const [updated] = await db
    .update(notifications)
    .set({ read: true })
    .where(eq(notifications.id, id))
    .returning()

  return c.json(updated)
})

// ---------------------------------------------------------------------------
// POST /read-all — auth — mark all caller's notifications read (?workspace_id=)
// ---------------------------------------------------------------------------

router.post('/read-all', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')

  const conditions = [eq(notifications.user_id, userId), eq(notifications.read, false)]
  if (workspaceId) conditions.push(eq(notifications.workspace_id, workspaceId))

  const updated = await db
    .update(notifications)
    .set({ read: true })
    .where(and(...conditions))
    .returning()

  return c.json({ updated: updated.length })
})

export default router
