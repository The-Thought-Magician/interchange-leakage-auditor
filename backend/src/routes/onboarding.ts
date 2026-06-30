import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { onboarding_state } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// The canonical onboarding steps. `completed` is derived from these all being done.
const ONBOARDING_STEPS = [
  'create_workspace',
  'add_processor',
  'import_rate_table',
  'upload_batch',
  'run_qualification',
  'review_findings',
] as const

function isAllComplete(steps: Record<string, boolean>): boolean {
  return ONBOARDING_STEPS.every((s) => steps[s] === true)
}

// Auth: get the caller's onboarding state for a workspace.
// GET /?workspace_id=
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const [existing] = await db
    .select()
    .from(onboarding_state)
    .where(
      and(eq(onboarding_state.workspace_id, workspaceId), eq(onboarding_state.user_id, userId)),
    )

  if (existing) return c.json(existing)

  // No state yet — return a fresh, unsaved default so the UI has a stable shape.
  const emptySteps: Record<string, boolean> = {}
  for (const s of ONBOARDING_STEPS) emptySteps[s] = false
  return c.json({
    id: null,
    workspace_id: workspaceId,
    user_id: userId,
    steps: emptySteps,
    completed: false,
    updated_at: null,
  })
})

const stepSchema = z.object({
  workspace_id: z.string().min(1),
  step: z.string().min(1),
})

// Auth: mark a single onboarding step complete for the caller.
// POST /step
router.post('/step', authMiddleware, zValidator('json', stepSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, step } = c.req.valid('json')

  const [existing] = await db
    .select()
    .from(onboarding_state)
    .where(
      and(eq(onboarding_state.workspace_id, workspace_id), eq(onboarding_state.user_id, userId)),
    )

  const currentSteps: Record<string, boolean> = { ...(existing?.steps ?? {}) }
  currentSteps[step] = true
  const completed = isAllComplete(currentSteps)

  if (existing) {
    const [updated] = await db
      .update(onboarding_state)
      .set({ steps: currentSteps, completed, updated_at: new Date() })
      .where(eq(onboarding_state.id, existing.id))
      .returning()
    return c.json(updated)
  }

  const [created] = await db
    .insert(onboarding_state)
    .values({ workspace_id, user_id: userId, steps: currentSteps, completed })
    .returning()
  return c.json(created)
})

export default router
