import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createHash, randomBytes } from 'node:crypto'
import { db } from '../db/index.js'
import { api_keys, workspaces, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
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

// Strip the secret hash before returning an api-key record to a client.
function redact(row: typeof api_keys.$inferSelect) {
  const { key_hash, ...safe } = row
  return safe
}

const issueSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
})

// ---------------------------------------------------------------------------
// GET / — auth — list caller's keys (hash never returned)
// ---------------------------------------------------------------------------

router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')

  const conditions = [eq(api_keys.user_id, userId)]
  if (workspaceId) conditions.push(eq(api_keys.workspace_id, workspaceId))

  const rows = await db
    .select()
    .from(api_keys)
    .where(and(...conditions))
    .orderBy(desc(api_keys.created_at))

  return c.json(rows.map(redact))
})

// ---------------------------------------------------------------------------
// POST / — auth — issue a key (returns plaintext once)
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', issueSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  if (!(await userCanWriteWorkspace(body.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  // Generate a key: plaintext shown once, only the SHA-256 hash is persisted.
  const raw = randomBytes(24).toString('hex')
  const key = `ila_${raw}`
  const keyPrefix = key.slice(0, 12)
  const keyHash = createHash('sha256').update(key).digest('hex')

  const [created] = await db
    .insert(api_keys)
    .values({
      workspace_id: body.workspace_id,
      user_id: userId,
      name: body.name,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      revoked: false,
    })
    .returning()

  return c.json({ key, record: redact(created) }, 201)
})

// ---------------------------------------------------------------------------
// DELETE /:id — auth (owner of key) — revoke a key
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db.select().from(api_keys).where(eq(api_keys.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  // Either the key's issuer or a workspace owner/member may revoke it.
  const isIssuer = existing.user_id === userId
  if (!isIssuer && !(await userCanWriteWorkspace(existing.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  await db.update(api_keys).set({ revoked: true }).where(eq(api_keys.id, id))
  return c.json({ success: true })
})

export default router
