import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  transactions,
  interchange_categories,
  rate_table_versions,
  qualification_results,
  downgrade_causes,
  recoverable_savings,
  reconciliations,
  upload_batches,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Deterministic interchange qualification engine
// ---------------------------------------------------------------------------

type Category = typeof interchange_categories.$inferSelect
type Transaction = typeof transactions.$inferSelect

interface RuleTraceEntry {
  category_code: string
  category_id: string
  reachable: boolean
  computed_fee_cents: number
  failed_requirements: string[]
}

interface CauseDraft {
  cause_code: string
  severity: 'low' | 'medium' | 'high'
  recoverable_cents: number
  required_fix: string
  detail: Record<string, unknown>
}

interface EngineOutput {
  optimal_category_id: string | null
  optimal_category_code: string | null
  optimal_fee_cents: number
  optimal_percent_rate: number
  billed_fee_cents: number
  delta_cents: number
  delta_bps: number
  is_downgrade: boolean
  rule_trace: RuleTraceEntry[]
  causes: CauseDraft[]
}

function computeFee(cat: Category, amountCents: number): number {
  const pct = (cat.percent_rate ?? 0) * amountCents / 100
  return Math.round(pct + (cat.per_item_cents ?? 0))
}

function isCardPresent(entryMode: string | null): boolean {
  if (!entryMode) return false
  const m = entryMode.toLowerCase()
  return m === 'card_present' || m === 'swipe' || m === 'chip' || m === 'contactless' || m === 'emv' || m === 'present'
}

function settlementHours(txn: Transaction): number | null {
  if (!txn.auth_timestamp || !txn.settlement_timestamp) return null
  const auth = new Date(txn.auth_timestamp as unknown as string).getTime()
  const settle = new Date(txn.settlement_timestamp as unknown as string).getTime()
  if (Number.isNaN(auth) || Number.isNaN(settle)) return null
  return (settle - auth) / 3_600_000
}

// Returns the list of failed requirement codes for a category against a txn.
function failedRequirements(cat: Category, txn: Transaction): string[] {
  const failed: string[] = []
  const mccSet = (cat.mcc_set ?? []) as string[]
  if (mccSet.length > 0 && (!txn.mcc || !mccSet.includes(txn.mcc))) {
    failed.push('mcc_mismatch')
  }
  if (cat.card_product && txn.card_product && cat.card_product !== txn.card_product) {
    failed.push('card_product_mismatch')
  }
  if (cat.requires_avs && !txn.has_avs) failed.push('missing_avs')
  if (cat.requires_card_present && !isCardPresent(txn.entry_mode)) failed.push('missing_card_present')
  if (cat.requires_level2 && !txn.has_level2) failed.push('missing_level2')
  if (cat.requires_level3 && !txn.has_level3) failed.push('missing_level3')
  if (cat.max_settlement_hours != null) {
    const hrs = settlementHours(txn)
    if (hrs == null || hrs > cat.max_settlement_hours) failed.push('late_settlement')
  }
  return failed
}

const CAUSE_SEVERITY: Record<string, 'low' | 'medium' | 'high'> = {
  late_settlement: 'high',
  missing_level3: 'high',
  missing_level2: 'medium',
  missing_avs: 'medium',
  mcc_mismatch: 'medium',
  missing_card_present: 'high',
  wrong_entry_mode: 'medium',
  card_product_mismatch: 'low',
}

const CAUSE_FIX: Record<string, string> = {
  late_settlement: 'Settle the transaction within the category settlement window (batch sooner).',
  missing_level3: 'Submit Level 3 line-item data (item descriptions, quantities, commodity codes).',
  missing_level2: 'Submit Level 2 data (tax amount, customer code) for commercial card acceptance.',
  missing_avs: 'Capture and submit AVS (billing address verification) at authorization.',
  mcc_mismatch: 'Verify the merchant category code assigned to this account is correct.',
  missing_card_present: 'Capture the card present (chip/contactless) instead of keyed entry.',
  wrong_entry_mode: 'Use a compliant entry mode for the target interchange category.',
  card_product_mismatch: 'Route the transaction under the correct card product.',
}

// Map a failed-requirement code to a downgrade cause code (most are identical).
function causeCodeFor(req: string): string {
  return req
}

function runEngine(txn: Transaction, cats: Category[]): EngineOutput {
  const amount = txn.amount_cents ?? 0
  const billed = txn.billed_fee_cents ?? 0
  const trace: RuleTraceEntry[] = []

  let optimal: { cat: Category; fee: number } | null = null

  for (const cat of cats) {
    const failed = failedRequirements(cat, txn)
    const fee = computeFee(cat, amount)
    const reachable = failed.length === 0
    trace.push({
      category_code: cat.code,
      category_id: cat.id,
      reachable,
      computed_fee_cents: fee,
      failed_requirements: failed,
    })
    if (reachable) {
      if (
        optimal == null ||
        fee < optimal.fee ||
        (fee === optimal.fee && (cat.tier_rank ?? 0) < (optimal.cat.tier_rank ?? 0))
      ) {
        optimal = { cat, fee }
      }
    }
  }

  const optimalFee = optimal ? optimal.fee : billed
  const optimalCat = optimal ? optimal.cat : null
  const delta = billed - optimalFee
  const deltaBps = amount > 0 ? (delta / amount) * 10000 : 0
  const isDowngrade = delta > 0

  // Attribute causes: which requirements did the optimal (cheaper) category
  // need that the txn failed? Those are the levers that pushed the txn down.
  const causes: CauseDraft[] = []
  if (isDowngrade && optimalCat) {
    // Look across all reachable-or-not categories cheaper than billed to find
    // the missed requirements. Use the optimal category's requirement set as
    // the authoritative target, but also inspect any cheaper unreachable
    // category for additional recoverable levers.
    const seen = new Set<string>()
    // Cheaper categories than what was billed, ranked by fee ascending.
    const cheaper = trace
      .filter((t) => t.computed_fee_cents < billed && t.failed_requirements.length > 0)
      .sort((a, b) => a.computed_fee_cents - b.computed_fee_cents)

    // Recoverable per cause is attributed against the best (optimal) target.
    const totalRecoverable = Math.max(0, delta)
    const candidateReqs: string[] = []
    for (const t of cheaper) {
      for (const r of t.failed_requirements) {
        if (r === 'card_product_mismatch') continue // structural, not a fixable lever
        if (!candidateReqs.includes(r)) candidateReqs.push(r)
      }
    }
    // If the optimal target itself was reached but billed was still higher,
    // the lever is the billed-category misqualification — attribute to the
    // requirement(s) the optimal category enforced.
    if (candidateReqs.length === 0 && optimal) {
      const optFailed = failedRequirements(optimalCat, txn)
      for (const r of optFailed) if (r !== 'card_product_mismatch') candidateReqs.push(r)
    }

    const split = candidateReqs.length > 0 ? Math.floor(totalRecoverable / candidateReqs.length) : 0
    let remainder = totalRecoverable - split * candidateReqs.length
    for (const req of candidateReqs) {
      const code = causeCodeFor(req)
      if (seen.has(code)) continue
      seen.add(code)
      let rec = split
      if (remainder > 0) {
        rec += 1
        remainder -= 1
      }
      causes.push({
        cause_code: code,
        severity: CAUSE_SEVERITY[code] ?? 'medium',
        recoverable_cents: rec,
        required_fix: CAUSE_FIX[code] ?? 'Review qualification requirements for this transaction.',
        detail: { delta_cents: delta, optimal_category_code: optimalCat.code },
      })
    }
    // Fallback: a downgrade with no attributable lever still records a generic cause.
    if (causes.length === 0) {
      causes.push({
        cause_code: 'misqualified',
        severity: 'medium',
        recoverable_cents: totalRecoverable,
        required_fix: 'Transaction billed above its optimal reachable category; review processor qualification.',
        detail: { delta_cents: delta, optimal_category_code: optimalCat.code },
      })
    }
  }

  return {
    optimal_category_id: optimalCat?.id ?? null,
    optimal_category_code: optimalCat?.code ?? null,
    optimal_fee_cents: optimalFee,
    optimal_percent_rate: optimalCat?.percent_rate ?? (txn.billed_percent_rate ?? 0),
    billed_fee_cents: billed,
    delta_cents: delta,
    delta_bps: deltaBps,
    is_downgrade: isDowngrade,
    rule_trace: trace,
    causes,
  }
}

// Load the active rate-table categories for a given workspace + card brand.
// Falls back to the most recent version for the brand when none is active.
async function loadCategories(workspaceId: string, brand: string | null): Promise<Category[]> {
  if (!brand) return []
  const versions = await db
    .select()
    .from(rate_table_versions)
    .where(and(eq(rate_table_versions.workspace_id, workspaceId), eq(rate_table_versions.brand, brand)))
    .orderBy(desc(rate_table_versions.is_active), desc(rate_table_versions.effective_date), desc(rate_table_versions.created_at))
  const version = versions[0]
  if (!version) return []
  return db.select().from(interchange_categories).where(eq(interchange_categories.version_id, version.id))
}

// Persist a single engine output (upsert on transaction_id) + replace causes.
async function persistResult(txn: Transaction, out: EngineOutput) {
  const [existing] = await db
    .select()
    .from(qualification_results)
    .where(eq(qualification_results.transaction_id, txn.id))

  let resultId: string
  if (existing) {
    const [updated] = await db
      .update(qualification_results)
      .set({
        optimal_category_id: out.optimal_category_id,
        optimal_category_code: out.optimal_category_code,
        optimal_fee_cents: out.optimal_fee_cents,
        optimal_percent_rate: out.optimal_percent_rate,
        billed_fee_cents: out.billed_fee_cents,
        delta_cents: out.delta_cents,
        delta_bps: out.delta_bps,
        is_downgrade: out.is_downgrade,
        rule_trace: out.rule_trace as unknown as Array<Record<string, unknown>>,
        computed_at: new Date(),
      })
      .where(eq(qualification_results.id, existing.id))
      .returning()
    resultId = updated.id
    // Replace prior causes for a clean recompute.
    await db.delete(downgrade_causes).where(eq(downgrade_causes.qualification_result_id, resultId))
  } else {
    const [created] = await db
      .insert(qualification_results)
      .values({
        workspace_id: txn.workspace_id,
        transaction_id: txn.id,
        optimal_category_id: out.optimal_category_id,
        optimal_category_code: out.optimal_category_code,
        optimal_fee_cents: out.optimal_fee_cents,
        optimal_percent_rate: out.optimal_percent_rate,
        billed_fee_cents: out.billed_fee_cents,
        delta_cents: out.delta_cents,
        delta_bps: out.delta_bps,
        is_downgrade: out.is_downgrade,
        rule_trace: out.rule_trace as unknown as Array<Record<string, unknown>>,
        computed_at: new Date(),
      })
      .returning()
    resultId = created.id
  }

  for (const cause of out.causes) {
    await db.insert(downgrade_causes).values({
      workspace_id: txn.workspace_id,
      qualification_result_id: resultId,
      transaction_id: txn.id,
      cause_code: cause.cause_code,
      severity: cause.severity,
      recoverable_cents: cause.recoverable_cents,
      required_fix: cause.required_fix,
      detail: cause.detail,
    })
  }

  return resultId
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Public: list qualification results (?workspace_id=&batch_id=&downgrade_only=)
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const batchId = c.req.query('batch_id')
  const downgradeOnly = c.req.query('downgrade_only')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  if (batchId) {
    // Join through transactions to scope by batch.
    const rows = await db
      .select({ result: qualification_results })
      .from(qualification_results)
      .innerJoin(transactions, eq(qualification_results.transaction_id, transactions.id))
      .where(and(eq(qualification_results.workspace_id, workspaceId), eq(transactions.batch_id, batchId)))
      .orderBy(desc(qualification_results.delta_cents))
    let out = rows.map((r) => r.result)
    if (downgradeOnly === 'true' || downgradeOnly === '1') out = out.filter((r) => r.is_downgrade)
    return c.json(out)
  }

  const conds = [eq(qualification_results.workspace_id, workspaceId)]
  if (downgradeOnly === 'true' || downgradeOnly === '1') conds.push(eq(qualification_results.is_downgrade, true))
  const out = await db
    .select()
    .from(qualification_results)
    .where(and(...conds))
    .orderBy(desc(qualification_results.delta_cents))
  return c.json(out)
})

// Public: result detail incl. rule_trace
router.get('/:id', async (c) => {
  const [result] = await db
    .select()
    .from(qualification_results)
    .where(eq(qualification_results.id, c.req.param('id')))
  if (!result) return c.json({ error: 'Not found' }, 404)
  return c.json(result)
})

// Auth: run engine over a batch, upsert results + causes + savings + reconciliation
router.post('/run/batch/:batchId', authMiddleware, async (c) => {
  getUserId(c)
  const batchId = c.req.param('batchId')
  const [batch] = await db.select().from(upload_batches).where(eq(upload_batches.id, batchId))
  if (!batch) return c.json({ error: 'Batch not found' }, 404)

  const txns = await db.select().from(transactions).where(eq(transactions.batch_id, batchId))

  // Cache categories per brand to avoid re-querying.
  const catCache = new Map<string, Category[]>()
  const loadCached = async (brand: string | null): Promise<Category[]> => {
    const key = brand ?? '__none__'
    if (catCache.has(key)) return catCache.get(key)!
    const cats = await loadCategories(batch.workspace_id, brand)
    catCache.set(key, cats)
    return cats
  }

  let count = 0
  let downgrades = 0
  let recoverable = 0
  let totalBilled = 0
  let totalComputed = 0

  // Aggregations for recoverable_savings scopes.
  const byCause = new Map<string, { cents: number; count: number; fix: string }>()
  const byMcc = new Map<string, { cents: number; count: number }>()
  const byProduct = new Map<string, { cents: number; count: number }>()

  for (const txn of txns) {
    const cats = await loadCached(txn.card_brand)
    const out = runEngine(txn, cats)
    await persistResult(txn, out)
    count += 1
    totalBilled += out.billed_fee_cents
    totalComputed += out.optimal_fee_cents
    if (out.is_downgrade) {
      downgrades += 1
      recoverable += Math.max(0, out.delta_cents)
      for (const cause of out.causes) {
        const e = byCause.get(cause.cause_code) ?? { cents: 0, count: 0, fix: cause.required_fix }
        e.cents += cause.recoverable_cents
        e.count += 1
        byCause.set(cause.cause_code, e)
      }
      const mccKey = txn.mcc ?? 'unknown'
      const m = byMcc.get(mccKey) ?? { cents: 0, count: 0 }
      m.cents += Math.max(0, out.delta_cents)
      m.count += 1
      byMcc.set(mccKey, m)

      const prodKey = txn.card_product ?? 'unknown'
      const p = byProduct.get(prodKey) ?? { cents: 0, count: 0 }
      p.cents += Math.max(0, out.delta_cents)
      p.count += 1
      byProduct.set(prodKey, p)
    }
  }

  // Rebuild recoverable_savings rows for this batch's workspace scopes.
  // Clear prior batch-scoped rows, then re-insert. Scope keys are namespaced
  // by batch to keep per-run ledgers distinct from cross-batch aggregates.
  const annualize = (cents: number) => cents * 12

  await db
    .delete(recoverable_savings)
    .where(and(eq(recoverable_savings.workspace_id, batch.workspace_id), eq(recoverable_savings.scope, 'batch')))
    .catch(() => {})

  // Per-batch total.
  await db.insert(recoverable_savings).values({
    workspace_id: batch.workspace_id,
    scope: 'batch',
    scope_key: batchId,
    period_label: batch.filename,
    recoverable_cents: recoverable,
    annualized_cents: annualize(recoverable),
    txn_count: downgrades,
    required_fix: null,
  })

  for (const [cause, e] of byCause) {
    await db.insert(recoverable_savings).values({
      workspace_id: batch.workspace_id,
      scope: 'cause',
      scope_key: `${batchId}:${cause}`,
      period_label: cause,
      recoverable_cents: e.cents,
      annualized_cents: annualize(e.cents),
      txn_count: e.count,
      required_fix: e.fix,
    })
  }
  for (const [mcc, e] of byMcc) {
    await db.insert(recoverable_savings).values({
      workspace_id: batch.workspace_id,
      scope: 'mcc',
      scope_key: `${batchId}:${mcc}`,
      period_label: mcc,
      recoverable_cents: e.cents,
      annualized_cents: annualize(e.cents),
      txn_count: e.count,
      required_fix: null,
    })
  }
  for (const [prod, e] of byProduct) {
    await db.insert(recoverable_savings).values({
      workspace_id: batch.workspace_id,
      scope: 'product',
      scope_key: `${batchId}:${prod}`,
      period_label: prod,
      recoverable_cents: e.cents,
      annualized_cents: annualize(e.cents),
      txn_count: e.count,
      required_fix: null,
    })
  }

  // Upsert a reconciliation row for the batch.
  const discrepancy = totalBilled - totalComputed
  const [existingRecon] = await db.select().from(reconciliations).where(eq(reconciliations.batch_id, batchId))
  if (existingRecon) {
    await db
      .update(reconciliations)
      .set({
        total_billed_cents: totalBilled,
        total_computed_cents: totalComputed,
        discrepancy_cents: discrepancy,
        txn_count: count,
        downgrade_count: downgrades,
      })
      .where(eq(reconciliations.id, existingRecon.id))
  } else {
    await db.insert(reconciliations).values({
      workspace_id: batch.workspace_id,
      batch_id: batchId,
      total_billed_cents: totalBilled,
      total_computed_cents: totalComputed,
      discrepancy_cents: discrepancy,
      txn_count: count,
      downgrade_count: downgrades,
      status: 'open',
    })
  }

  // Mark the batch analyzed.
  await db.update(upload_batches).set({ status: 'analyzed' }).where(eq(upload_batches.id, batchId))

  return c.json({ count, downgrades, recoverable_cents: recoverable })
})

// Auth: run engine on a single transaction
router.post('/run/transaction/:txnId', authMiddleware, async (c) => {
  getUserId(c)
  const txnId = c.req.param('txnId')
  const [txn] = await db.select().from(transactions).where(eq(transactions.id, txnId))
  if (!txn) return c.json({ error: 'Transaction not found' }, 404)

  const cats = await loadCategories(txn.workspace_id, txn.card_brand)
  const out = runEngine(txn, cats)
  const resultId = await persistResult(txn, out)

  const [result] = await db.select().from(qualification_results).where(eq(qualification_results.id, resultId))
  return c.json(result)
})

export default router
