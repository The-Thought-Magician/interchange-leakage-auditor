import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createHmac, randomBytes } from 'node:crypto'
import { db } from '../db/index.js'
import { webhooks, webhook_deliveries, workspaces, workspace_members } from '../db/schema.js'
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

function signPayload(secret: string | null | undefined, body: string): string | undefined {
  if (!secret) return undefined
  return createHmac('sha256', secret).update(body).digest('hex')
}

const webhookSchema = z.object({
  workspace_id: z.string().min(1),
  url: z.string().url(),
  events: z.array(z.string()).optional().default([]),
  secret: z.string().nullable().optional(),
  is_active: z.boolean().optional().default(true),
})

const webhookUpdateSchema = webhookSchema.partial().omit({ workspace_id: true })

// ---------------------------------------------------------------------------
// GET / — public — list webhooks (?workspace_id=)
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.workspace_id, workspaceId))
    .orderBy(desc(webhooks.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST / — auth — create a webhook
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', webhookSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  if (!(await userCanWriteWorkspace(body.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  // Generate a signing secret if none was supplied.
  const secret = body.secret ?? `whsec_${randomBytes(24).toString('hex')}`

  const [created] = await db
    .insert(webhooks)
    .values({
      workspace_id: body.workspace_id,
      url: body.url,
      events: body.events ?? [],
      secret,
      is_active: body.is_active ?? true,
    })
    .returning()

  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — auth (workspace owner/member) — update a webhook
// ---------------------------------------------------------------------------

router.put('/:id', authMiddleware, zValidator('json', webhookUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db.select().from(webhooks).where(eq(webhooks.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  if (!(await userCanWriteWorkspace(existing.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  const patch: Record<string, unknown> = {}
  if (body.url !== undefined) patch.url = body.url
  if (body.events !== undefined) patch.events = body.events
  if (body.secret !== undefined) patch.secret = body.secret
  if (body.is_active !== undefined) patch.is_active = body.is_active

  if (Object.keys(patch).length === 0) return c.json(existing)

  const [updated] = await db.update(webhooks).set(patch).where(eq(webhooks.id, id)).returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — auth (workspace owner/member) — delete a webhook + its deliveries
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db.select().from(webhooks).where(eq(webhooks.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  if (!(await userCanWriteWorkspace(existing.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  await db.delete(webhook_deliveries).where(eq(webhook_deliveries.webhook_id, id))
  await db.delete(webhooks).where(eq(webhooks.id, id))
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// POST /:id/test — auth — fire a test event, record the delivery
// ---------------------------------------------------------------------------

router.post('/:id/test', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, id))
  if (!hook) return c.json({ error: 'Not found' }, 404)

  if (!(await userCanWriteWorkspace(hook.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  const event = 'webhook.test'
  const payload: Record<string, unknown> = {
    event,
    webhook_id: hook.id,
    workspace_id: hook.workspace_id,
    delivered_at: new Date().toISOString(),
    data: { message: 'This is a test delivery from InterchangeLeakageAuditor.' },
  }
  const bodyStr = JSON.stringify(payload)
  const signature = signPayload(hook.secret, bodyStr)

  let statusCode: number | null = null
  let success = false
  let error: string | null = null

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Webhook-Event': event,
    }
    if (signature) headers['X-Webhook-Signature'] = `sha256=${signature}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        headers,
        body: bodyStr,
        signal: controller.signal,
      })
      statusCode = res.status
      success = res.ok
      if (!res.ok) error = `Endpoint responded with status ${res.status}`
    } finally {
      clearTimeout(timer)
    }
  } catch (e) {
    success = false
    error = e instanceof Error ? e.message : String(e)
  }

  const [delivery] = await db
    .insert(webhook_deliveries)
    .values({
      workspace_id: hook.workspace_id,
      webhook_id: hook.id,
      event,
      payload,
      status_code: statusCode,
      success,
      error,
    })
    .returning()

  return c.json(delivery, 201)
})

// ---------------------------------------------------------------------------
// GET /:id/deliveries — public — delivery log for a webhook
// ---------------------------------------------------------------------------

router.get('/:id/deliveries', async (c) => {
  const id = c.req.param('id')

  const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, id))
  if (!hook) return c.json({ error: 'Not found' }, 404)

  const rows = await db
    .select()
    .from(webhook_deliveries)
    .where(eq(webhook_deliveries.webhook_id, id))
    .orderBy(desc(webhook_deliveries.created_at))

  return c.json(rows)
})

export default router
