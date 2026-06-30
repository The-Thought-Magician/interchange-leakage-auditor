import { Hono } from 'hono'
import { db } from '../db/index.js'
import { audit_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'

const router = new Hono()

// Public: append-only audit log list with action/entity filters.
// GET /?workspace_id=&action=&entity_type=
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const action = c.req.query('action')
  const entityType = c.req.query('entity_type')

  const conditions = [eq(audit_log.workspace_id, workspaceId)]
  if (action) conditions.push(eq(audit_log.action, action))
  if (entityType) conditions.push(eq(audit_log.entity_type, entityType))

  const rows = await db
    .select()
    .from(audit_log)
    .where(and(...conditions))
    .orderBy(desc(audit_log.created_at))

  return c.json(rows)
})

export default router
