import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { reconciliations } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const updateSchema = z.object({
  status: z.enum(['open', 'in_review', 'resolved', 'disputed', 'accepted']).optional(),
  notes: z.string().optional(),
})

// GET / — statement reconciliations for a workspace (billed vs computed per batch).
// ?workspace_id= (required)
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const rows = await db
    .select()
    .from(reconciliations)
    .where(eq(reconciliations.workspace_id, workspaceId))
    .orderBy(desc(reconciliations.created_at))

  return c.json(rows)
})

// GET /:id — reconciliation detail.
router.get('/:id', async (c) => {
  const [row] = await db
    .select()
    .from(reconciliations)
    .where(eq(reconciliations.id, c.req.param('id')))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// PUT /:id — update reconciliation status/notes (auth + ownership via workspace).
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)

  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(reconciliations)
    .where(eq(reconciliations.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  // Ownership: caller must be a member of the reconciliation's workspace.
  const { workspaces, workspace_members } = await import('../db/schema.js')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, existing.workspace_id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, existing.workspace_id), eq(workspace_members.user_id, userId)))
  if (ws.owner_id !== userId && !member) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.status !== undefined) patch.status = body.status
  if (body.notes !== undefined) patch.notes = body.notes
  if (Object.keys(patch).length === 0) return c.json(existing)

  const [updated] = await db
    .update(reconciliations)
    .set(patch)
    .where(eq(reconciliations.id, id))
    .returning()

  return c.json(updated)
})

export default router
