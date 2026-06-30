import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  upload_batches,
  transactions,
  qualification_results,
  downgrade_causes,
  processors,
  workspaces,
  workspace_members,
} from '../db/schema.js'
import { eq, and, desc, inArray } from 'drizzle-orm'
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

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    return s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 't'
  }
  return false
}

function toInt(v: unknown): number {
  if (typeof v === 'number') return Math.round(v)
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/[^0-9.-]/g, ''), 10)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function toFloat(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.-]/g, ''))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function toTimestamp(v: unknown): Date | null {
  const s = toStr(v)
  if (!s) return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t)
}

// Parse a CSV string into an array of record objects keyed by header.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.some((f) => f.trim() !== '')) rows.push(row)
  }
  if (rows.length === 0) return []
  const headers = rows[0].map((h) => h.trim())
  const out: Record<string, string>[] = []
  for (let r = 1; r < rows.length; r++) {
    const rec: Record<string, string> = {}
    for (let cIdx = 0; cIdx < headers.length; cIdx++) {
      rec[headers[cIdx]] = (rows[r][cIdx] ?? '').trim()
    }
    out.push(rec)
  }
  return out
}

// Normalise an arbitrary parsed row into the transaction-flag shape.
// Flags are derived from raw fields when not explicitly provided.
function normaliseRow(raw: Record<string, unknown>) {
  const get = (...keys: string[]): unknown => {
    for (const k of keys) {
      if (raw[k] !== undefined && raw[k] !== null && raw[k] !== '') return raw[k]
      // case-insensitive fallback
      const found = Object.keys(raw).find((rk) => rk.toLowerCase() === k.toLowerCase())
      if (found && raw[found] !== undefined && raw[found] !== null && raw[found] !== '') return raw[found]
    }
    return undefined
  }

  const entry_mode = toStr(get('entry_mode', 'entrymode', 'pos_entry_mode'))
  // Derive card-present: explicit flag, else infer from entry_mode.
  const cardPresentRaw = get('card_present', 'has_card_present', 'is_card_present')
  const inferredCardPresent =
    entry_mode != null &&
    ['swipe', 'chip', 'contactless', 'emv', 'card_present', 'present', 'tap'].some((m) =>
      entry_mode.toLowerCase().includes(m),
    )
  const cardPresent = cardPresentRaw !== undefined ? toBool(cardPresentRaw) : inferredCardPresent

  // Level 2/3: explicit flag, else infer from presence of level2_data/level3_data.
  const level2Data = get('level2_data', 'level2', 'l2_data')
  const level3Data = get('level3_data', 'level3', 'l3_data')
  let parsedL2: Record<string, unknown> = {}
  let parsedL3: Record<string, unknown> = {}
  if (level2Data && typeof level2Data === 'object') parsedL2 = level2Data as Record<string, unknown>
  else if (typeof level2Data === 'string') {
    try {
      parsedL2 = JSON.parse(level2Data)
    } catch {
      parsedL2 = {}
    }
  }
  if (level3Data && typeof level3Data === 'object') parsedL3 = level3Data as Record<string, unknown>
  else if (typeof level3Data === 'string') {
    try {
      parsedL3 = JSON.parse(level3Data)
    } catch {
      parsedL3 = {}
    }
  }

  const hasL2Raw = get('has_level2', 'level2_present', 'l2')
  const hasL3Raw = get('has_level3', 'level3_present', 'l3')
  const has_level2 = hasL2Raw !== undefined ? toBool(hasL2Raw) : Object.keys(parsedL2).length > 0
  const has_level3 = hasL3Raw !== undefined ? toBool(hasL3Raw) : Object.keys(parsedL3).length > 0

  const avsRaw = get('has_avs', 'avs', 'avs_result')
  const has_avs =
    avsRaw !== undefined
      ? typeof avsRaw === 'string' && !['true', 'false', '0', '1', 'yes', 'no'].includes(avsRaw.toLowerCase())
        ? avsRaw.trim() !== '' && avsRaw.trim().toUpperCase() !== 'N'
        : toBool(avsRaw)
      : false

  const cvvRaw = get('has_cvv', 'cvv', 'cvv_result')
  const has_cvv =
    cvvRaw !== undefined
      ? typeof cvvRaw === 'string' && !['true', 'false', '0', '1', 'yes', 'no'].includes(cvvRaw.toLowerCase())
        ? cvvRaw.trim() !== '' && cvvRaw.trim().toUpperCase() !== 'N'
        : toBool(cvvRaw)
      : false

  return {
    external_ref: toStr(get('external_ref', 'ref', 'reference', 'transaction_id', 'txn_id', 'id')),
    amount_cents: toInt(get('amount_cents', 'amount', 'amount_in_cents')),
    currency: toStr(get('currency', 'curr')) ?? 'USD',
    mcc: toStr(get('mcc', 'merchant_category_code')),
    card_brand: toStr(get('card_brand', 'brand', 'network')),
    card_product: toStr(get('card_product', 'product')),
    entry_mode,
    auth_timestamp: toTimestamp(get('auth_timestamp', 'authorized_at', 'auth_time', 'auth_date')),
    settlement_timestamp: toTimestamp(
      get('settlement_timestamp', 'settled_at', 'settlement_time', 'settlement_date'),
    ),
    has_avs,
    has_cvv,
    has_level2,
    has_level3,
    level2_data: parsedL2,
    level3_data: parsedL3,
    billed_category_code: toStr(get('billed_category_code', 'billed_category', 'category_code', 'qualified_as')),
    billed_fee_cents: toInt(get('billed_fee_cents', 'billed_fee', 'interchange_fee_cents', 'fee_cents')),
    billed_percent_rate: toFloat(get('billed_percent_rate', 'billed_rate', 'discount_rate')),
  }
}

// Turn an upload body (rows[] inline, or raw CSV/JSON text) into row records.
function extractRecords(sourceFormat: string, rows: unknown, rawText: unknown): Record<string, unknown>[] {
  if (Array.isArray(rows) && rows.length > 0) {
    return rows as Record<string, unknown>[]
  }
  const text = typeof rawText === 'string' ? rawText : ''
  if (!text.trim()) return []
  const fmt = (sourceFormat || 'csv').toLowerCase()
  if (fmt === 'json') {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) return parsed as Record<string, unknown>[]
      if (parsed && typeof parsed === 'object') return [parsed as Record<string, unknown>]
      return []
    } catch {
      return []
    }
  }
  // default csv
  return parseCsv(text)
}

const uploadCreateSchema = z.object({
  workspace_id: z.string().min(1),
  processor_id: z.string().nullable().optional(),
  filename: z.string().min(1),
  source_format: z.enum(['csv', 'json']).optional().default('csv'),
  rows: z.array(z.record(z.string(), z.any())).optional(),
  raw: z.string().optional(),
})

// ---------------------------------------------------------------------------
// GET / — public — list batches for a workspace (?workspace_id=)
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(upload_batches)
    .where(eq(upload_batches.workspace_id, workspaceId))
    .orderBy(desc(upload_batches.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /:id — public — batch detail + transaction count
// ---------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [batch] = await db.select().from(upload_batches).where(eq(upload_batches.id, id))
  if (!batch) return c.json({ error: 'Not found' }, 404)
  const txns = await db.select().from(transactions).where(eq(transactions.batch_id, id))
  return c.json({ batch, txnCount: txns.length })
})

// ---------------------------------------------------------------------------
// POST / — auth — create a batch with inline rows; parse + insert transactions
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', uploadCreateSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  if (!(await userCanWriteWorkspace(body.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  // Validate processor (if supplied) belongs to the workspace.
  if (body.processor_id) {
    const [proc] = await db.select().from(processors).where(eq(processors.id, body.processor_id))
    if (!proc) return c.json({ error: 'Processor not found' }, 404)
    if (proc.workspace_id !== body.workspace_id)
      return c.json({ error: 'Processor does not belong to this workspace' }, 400)
  }

  const records = extractRecords(body.source_format, body.rows, body.raw)

  // Create the batch first.
  const [batch] = await db
    .insert(upload_batches)
    .values({
      workspace_id: body.workspace_id,
      processor_id: body.processor_id ?? null,
      filename: body.filename,
      source_format: body.source_format ?? 'csv',
      row_count: records.length,
      status: 'parsed',
      uploaded_by: userId,
      error_message: records.length === 0 ? 'No rows parsed from input' : null,
    })
    .returning()

  let inserted = 0
  if (records.length > 0) {
    const values = records.map((raw) => {
      const n = normaliseRow(raw)
      return {
        workspace_id: body.workspace_id,
        batch_id: batch.id,
        processor_id: body.processor_id ?? null,
        external_ref: n.external_ref,
        amount_cents: n.amount_cents,
        currency: n.currency,
        mcc: n.mcc,
        card_brand: n.card_brand,
        card_product: n.card_product,
        entry_mode: n.entry_mode,
        auth_timestamp: n.auth_timestamp,
        settlement_timestamp: n.settlement_timestamp,
        has_avs: n.has_avs,
        has_cvv: n.has_cvv,
        has_level2: n.has_level2,
        has_level3: n.has_level3,
        level2_data: n.level2_data,
        level3_data: n.level3_data,
        billed_category_code: n.billed_category_code,
        billed_fee_cents: n.billed_fee_cents,
        billed_percent_rate: n.billed_percent_rate,
        tags: [] as string[],
      }
    })
    // Insert in chunks to stay within statement limits.
    const CHUNK = 200
    for (let i = 0; i < values.length; i += CHUNK) {
      const slice = values.slice(i, i + CHUNK)
      const result = await db.insert(transactions).values(slice).returning({ id: transactions.id })
      inserted += result.length
    }
  }

  return c.json({ batch, inserted }, 201)
})

// ---------------------------------------------------------------------------
// POST /:id/parse — auth — re-derive transaction flags for an existing batch
// ---------------------------------------------------------------------------

router.post('/:id/parse', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [batch] = await db.select().from(upload_batches).where(eq(upload_batches.id, id))
  if (!batch) return c.json({ error: 'Not found' }, 404)
  if (!(await userCanWriteWorkspace(batch.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  // Re-derive the boolean flags for every transaction in the batch from its
  // own stored raw fields (entry_mode + level2/level3 data).
  const txns = await db.select().from(transactions).where(eq(transactions.batch_id, id))
  for (const t of txns) {
    const l2 = (t.level2_data ?? {}) as Record<string, unknown>
    const l3 = (t.level3_data ?? {}) as Record<string, unknown>
    const has_level2 = t.has_level2 || Object.keys(l2).length > 0
    const has_level3 = t.has_level3 || Object.keys(l3).length > 0
    if (has_level2 !== t.has_level2 || has_level3 !== t.has_level3) {
      await db
        .update(transactions)
        .set({ has_level2, has_level3 })
        .where(eq(transactions.id, t.id))
    }
  }

  const [updated] = await db
    .update(upload_batches)
    .set({ status: 'parsed', row_count: txns.length, error_message: null })
    .where(eq(upload_batches.id, id))
    .returning()

  return c.json({ batch: updated })
})

// ---------------------------------------------------------------------------
// DELETE /:id — auth — delete batch + its transactions / results / causes
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [batch] = await db.select().from(upload_batches).where(eq(upload_batches.id, id))
  if (!batch) return c.json({ error: 'Not found' }, 404)
  if (!(await userCanWriteWorkspace(batch.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  // Collect transaction ids in this batch so we can clear dependent rows.
  const txns = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.batch_id, id))
  const txnIds = txns.map((t) => t.id)

  if (txnIds.length > 0) {
    // downgrade_causes reference transactions + qualification_results
    await db.delete(downgrade_causes).where(inArray(downgrade_causes.transaction_id, txnIds))
    await db.delete(qualification_results).where(inArray(qualification_results.transaction_id, txnIds))
    await db.delete(transactions).where(inArray(transactions.id, txnIds))
  }

  await db.delete(upload_batches).where(eq(upload_batches.id, id))
  return c.json({ success: true })
})

export default router
