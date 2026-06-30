import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { settings, workspaces, workspace_members } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Verify the caller is the owner or a member of the workspace.
async function callerCanWrite(workspaceId: string, userId: string): Promise<boolean> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  if (!ws) return false
  if (ws.owner_id === userId) return true
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!member
}

// Public: all settings for a workspace.
// GET /?workspace_id=
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.workspace_id, workspaceId))
    .orderBy(settings.key)

  return c.json(rows)
})

const upsertSchema = z.object({
  workspace_id: z.string().min(1),
  key: z.string().min(1),
  value: z.record(z.unknown()).default({}),
})

// Auth: upsert a key/value setting for a workspace.
// PUT /
router.put('/', authMiddleware, zValidator('json', upsertSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, key, value } = c.req.valid('json')

  if (!(await callerCanWrite(workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const [row] = await db
    .insert(settings)
    .values({ workspace_id, key, value })
    .onConflictDoUpdate({
      target: [settings.workspace_id, settings.key],
      set: { value, updated_at: new Date() },
    })
    .returning()

  return c.json(row)
})

export default router
