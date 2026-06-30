import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'
import { plans, workspaces } from './db/schema.js'

import workspacesRoutes from './routes/workspaces.js'
import processorsRoutes from './routes/processors.js'
import rateTablesRoutes from './routes/rate-tables.js'
import categoriesRoutes from './routes/categories.js'
import uploadsRoutes from './routes/uploads.js'
import transactionsRoutes from './routes/transactions.js'
import qualificationRoutes from './routes/qualification.js'
import downgradesRoutes from './routes/downgrades.js'
import level23Routes from './routes/level23.js'
import effectiveRateRoutes from './routes/effective-rate.js'
import savingsRoutes from './routes/savings.js'
import reconciliationRoutes from './routes/reconciliation.js'
import benchmarksRoutes from './routes/benchmarks.js'
import savedFiltersRoutes from './routes/saved-filters.js'
import tagsRoutes from './routes/tags.js'
import notificationsRoutes from './routes/notifications.js'
import webhooksRoutes from './routes/webhooks.js'
import apiKeysRoutes from './routes/api-keys.js'
import auditLogRoutes from './routes/audit-log.js'
import settingsRoutes from './routes/settings.js'
import onboardingRoutes from './routes/onboarding.js'
import sampleRoutes from './routes/sample.js'
import analyticsRoutes from './routes/analytics.js'
import billingRoutes from './routes/billing.js'

const app = new Hono()

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'https://interchange-leakage-auditor-ventures.vercel.app',
]

app.use('*', cors({
  origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
  credentials: true,
}))

const api = new Hono()
api.route('/workspaces', workspacesRoutes)
api.route('/processors', processorsRoutes)
api.route('/rate-tables', rateTablesRoutes)
api.route('/categories', categoriesRoutes)
api.route('/uploads', uploadsRoutes)
api.route('/transactions', transactionsRoutes)
api.route('/qualification', qualificationRoutes)
api.route('/downgrades', downgradesRoutes)
api.route('/level23', level23Routes)
api.route('/effective-rate', effectiveRateRoutes)
api.route('/savings', savingsRoutes)
api.route('/reconciliation', reconciliationRoutes)
api.route('/benchmarks', benchmarksRoutes)
api.route('/saved-filters', savedFiltersRoutes)
api.route('/tags', tagsRoutes)
api.route('/notifications', notificationsRoutes)
api.route('/webhooks', webhooksRoutes)
api.route('/api-keys', apiKeysRoutes)
api.route('/audit-log', auditLogRoutes)
api.route('/settings', settingsRoutes)
api.route('/onboarding', onboardingRoutes)
api.route('/sample', sampleRoutes)
api.route('/analytics', analyticsRoutes)
api.route('/billing', billingRoutes)

app.route('/api/v1', api)
app.get('/health', (c) => c.json({ ok: true }))

async function seedIfEmpty() {
  // Idempotent: count-then-insert. Seed billing plans + a demo workspace.
  const existingPlans = await db.select().from(plans).limit(1)
  if (existingPlans.length === 0) {
    await db.insert(plans).values([
      { id: 'free', name: 'Free', price_cents: 0 },
      { id: 'pro', name: 'Pro', price_cents: 4900 },
    ]).onConflictDoNothing()
    console.log('Seeded plans')
  }

  const existingWorkspaces = await db.select().from(workspaces).limit(1)
  if (existingWorkspaces.length === 0) {
    await db.insert(workspaces).values({
      name: 'Demo Workspace',
      owner_id: 'demo-user',
    }).onConflictDoNothing()
    console.log('Seeded demo workspace')
  }
}

const port = parseInt(process.env.PORT ?? '3001')

// CRITICAL boot order: bind the port FIRST so the platform health check sees a
// live service immediately, THEN run migrate() + seedIfEmpty() (both idempotent).
serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`))

try {
  await migrate()
} catch (e) {
  console.error('Migration error:', e)
}

try {
  await seedIfEmpty()
} catch (e) {
  console.error('Seed error:', e)
}

export default app
