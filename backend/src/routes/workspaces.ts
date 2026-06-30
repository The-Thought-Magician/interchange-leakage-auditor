import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { workspaces, workspace_members } from '../db/schema.js'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  name: z.string().min(1),
})

const renameSchema = z.object({
  name: z.string().min(1),
})

const addMemberSchema = z.object({
  user_id: z.string().min(1),
  role: z.string().min(1).optional().default('member'),
})

// Returns true when the caller owns the workspace.
async function isOwner(workspaceId: string, userId: string): Promise<boolean> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  return !!ws && ws.owner_id === userId
}

// GET / — auth — list workspaces the caller owns or is a member of.
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const memberships = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.user_id, userId))
  const memberWsIds = memberships.map((m) => m.workspace_id)

  const owned = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.owner_id, userId))

  const seen = new Set(owned.map((w) => w.id))
  let result = [...owned]
  if (memberWsIds.length) {
    const memberWs = await db
      .select()
      .from(workspaces)
      .where(inArray(workspaces.id, memberWsIds))
    for (const w of memberWs) {
      if (!seen.has(w.id)) {
        seen.add(w.id)
        result.push(w)
      }
    }
  }
  result.sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
  return c.json(result)
})

// POST / — auth — create a workspace and the owner membership row.
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const { name } = c.req.valid('json')
  const [ws] = await db.insert(workspaces).values({ name, owner_id: userId }).returning()
  await db.insert(workspace_members).values({
    workspace_id: ws.id,
    user_id: userId,
    role: 'owner',
  })
  return c.json(ws, 201)
})

// GET /:id — auth — workspace detail (owner or member only).
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  if (ws.owner_id !== userId) {
    const [m] = await db
      .select()
      .from(workspace_members)
      .where(and(eq(workspace_members.workspace_id, id), eq(workspace_members.user_id, userId)))
    if (!m) return c.json({ error: 'Forbidden' }, 403)
  }
  return c.json(ws)
})

// PUT /:id — auth (owner) — rename a workspace.
router.put('/:id', authMiddleware, zValidator('json', renameSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  if (ws.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const { name } = c.req.valid('json')
  const [updated] = await db
    .update(workspaces)
    .set({ name, updated_at: new Date() })
    .where(eq(workspaces.id, id))
    .returning()
  return c.json(updated)
})

// GET /:id/members — auth — list members (owner or member only).
router.get('/:id/members', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  if (ws.owner_id !== userId) {
    const [m] = await db
      .select()
      .from(workspace_members)
      .where(and(eq(workspace_members.workspace_id, id), eq(workspace_members.user_id, userId)))
    if (!m) return c.json({ error: 'Forbidden' }, 403)
  }
  const members = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.workspace_id, id))
    .orderBy(desc(workspace_members.created_at))
  return c.json(members)
})

// POST /:id/members — auth (owner) — add a member by user_id + role.
router.post('/:id/members', authMiddleware, zValidator('json', addMemberSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  if (!(await isOwner(id, userId))) {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
    if (!ws) return c.json({ error: 'Not found' }, 404)
    return c.json({ error: 'Forbidden' }, 403)
  }
  const body = c.req.valid('json')
  const [existing] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, id), eq(workspace_members.user_id, body.user_id)))
  if (existing) return c.json({ error: 'Member already exists' }, 400)
  const [member] = await db
    .insert(workspace_members)
    .values({ workspace_id: id, user_id: body.user_id, role: body.role })
    .returning()
  return c.json(member, 201)
})

// DELETE /:id/members/:memberId — auth (owner) — remove a member.
router.delete('/:id/members/:memberId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const memberId = c.req.param('memberId')
  if (!(await isOwner(id, userId))) {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
    if (!ws) return c.json({ error: 'Not found' }, 404)
    return c.json({ error: 'Forbidden' }, 403)
  }
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.id, memberId), eq(workspace_members.workspace_id, id)))
  if (!member) return c.json({ error: 'Not found' }, 404)
  if (member.role === 'owner') return c.json({ error: 'Cannot remove the owner' }, 400)
  await db.delete(workspace_members).where(eq(workspace_members.id, memberId))
  return c.json({ success: true })
})

export default router
