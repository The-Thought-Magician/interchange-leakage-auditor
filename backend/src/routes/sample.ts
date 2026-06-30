import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  workspaces,
  workspace_members,
  processors,
  rate_table_versions,
  interchange_categories,
  upload_batches,
  transactions,
  qualification_results,
  downgrade_causes,
  recoverable_savings,
  reconciliations,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Deterministic qualification engine (mirrors qualification.ts engine notes).
// Self-contained here so the seeder can immediately qualify the planted batch.
// ---------------------------------------------------------------------------

type CategoryRow = typeof interchange_categories.$inferSelect
type TxnRow = typeof transactions.$inferSelect

function computeFee(cat: { percent_rate: number | null; per_item_cents: number | null }, amountCents: number): number {
  const pct = cat.percent_rate ?? 0
  const perItem = cat.per_item_cents ?? 0
  return Math.round((pct * amountCents) / 100) + perItem
}

function isCardPresent(entryMode: string | null): boolean {
  if (!entryMode) return false
  const m = entryMode.toLowerCase()
  return m === 'card_present' || m === 'swipe' || m === 'chip' || m === 'contactless' || m === 'emv'
}

function settlementHours(txn: TxnRow): number | null {
  if (!txn.auth_timestamp || !txn.settlement_timestamp) return null
  const ms = new Date(txn.settlement_timestamp).getTime() - new Date(txn.auth_timestamp).getTime()
  return ms / 3_600_000
}

interface RequirementCheck {
  reachable: boolean
  failed: string[]
}

function checkRequirements(cat: CategoryRow, txn: TxnRow): RequirementCheck {
  const failed: string[] = []
  const mccSet = (cat.mcc_set ?? []) as string[]
  if (mccSet.length > 0 && txn.mcc && !mccSet.includes(txn.mcc)) failed.push('mcc_mismatch')
  if (cat.card_product && txn.card_product && cat.card_product !== txn.card_product) failed.push('card_product_mismatch')
  if (cat.requires_avs && !txn.has_avs) failed.push('missing_avs')
  if (cat.requires_card_present && !isCardPresent(txn.entry_mode)) failed.push('missing_card_present')
  if (cat.requires_level2 && !txn.has_level2) failed.push('missing_level2')
  if (cat.requires_level3 && !txn.has_level3) failed.push('missing_level3')
  if (cat.max_settlement_hours != null) {
    const sh = settlementHours(txn)
    if (sh != null && sh > cat.max_settlement_hours) failed.push('late_settlement')
  }
  return { reachable: failed.length === 0, failed }
}

const CAUSE_FIX: Record<string, { fix: string; severity: string }> = {
  late_settlement: { fix: 'Settle authorizations within the category window (typically 24-48h).', severity: 'high' },
  missing_avs: { fix: 'Submit AVS (address verification) data with the authorization.', severity: 'medium' },
  missing_level2: { fix: 'Send Level 2 data (tax amount, customer code) for commercial cards.', severity: 'high' },
  missing_level3: { fix: 'Send Level 3 line-item detail for commercial/government cards.', severity: 'high' },
  mcc_mismatch: { fix: 'Verify the merchant MCC is correctly registered for this category.', severity: 'medium' },
  missing_card_present: { fix: 'Capture card-present entry (chip/contactless) where possible.', severity: 'medium' },
  card_product_mismatch: { fix: 'Confirm card product classification matches the qualifying category.', severity: 'low' },
}

async function qualifyBatch(workspaceId: string, batchId: string) {
  const txns = await db.select().from(transactions).where(eq(transactions.batch_id, batchId))

  let downgrades = 0
  let recoverableTotal = 0
  let totalBilled = 0
  let totalComputed = 0

  // cause_code -> { recoverable, count }
  const byCause = new Map<string, { recoverable: number; count: number }>()

  for (const txn of txns) {
    const billedFee = txn.billed_fee_cents ?? 0
    totalBilled += billedFee

    // Load active rate-table version for this card brand within the workspace.
    const versionConds = [eq(rate_table_versions.workspace_id, workspaceId), eq(rate_table_versions.is_active, true)]
    if (txn.card_brand) versionConds.push(eq(rate_table_versions.brand, txn.card_brand))
    const [version] = await db
      .select()
      .from(rate_table_versions)
      .where(and(...versionConds))
      .limit(1)

    const cats = version
      ? await db.select().from(interchange_categories).where(eq(interchange_categories.version_id, version.id))
      : []

    const trace: Array<Record<string, unknown>> = []
    let best: { cat: CategoryRow; fee: number } | null = null

    for (const cat of cats) {
      const check = checkRequirements(cat, txn)
      const fee = computeFee(cat, txn.amount_cents)
      trace.push({ category_code: cat.code, reachable: check.reachable, failed_requirements: check.failed, computed_fee_cents: fee })
      if (!check.reachable) continue
      if (
        best === null ||
        fee < best.fee ||
        (fee === best.fee && (cat.tier_rank ?? 0) < (best.cat.tier_rank ?? 0))
      ) {
        best = { cat, fee }
      }
    }

    const optimalFee = best ? best.fee : billedFee
    totalComputed += optimalFee
    const delta = billedFee - optimalFee
    const deltaBps = txn.amount_cents > 0 ? (delta / txn.amount_cents) * 10000 : 0
    const isDowngrade = delta > 0

    // Upsert qualification_result (UNIQUE on transaction_id).
    const [existing] = await db
      .select()
      .from(qualification_results)
      .where(eq(qualification_results.transaction_id, txn.id))
      .limit(1)

    let resultId: string
    const resultValues = {
      workspace_id: workspaceId,
      transaction_id: txn.id,
      optimal_category_id: best ? best.cat.id : null,
      optimal_category_code: best ? best.cat.code : null,
      optimal_fee_cents: optimalFee,
      optimal_percent_rate: best ? best.cat.percent_rate ?? 0 : 0,
      billed_fee_cents: billedFee,
      delta_cents: delta,
      delta_bps: deltaBps,
      is_downgrade: isDowngrade,
      rule_trace: trace,
      computed_at: new Date(),
    }

    if (existing) {
      await db.update(qualification_results).set(resultValues).where(eq(qualification_results.id, existing.id))
      resultId = existing.id
      await db.delete(downgrade_causes).where(eq(downgrade_causes.qualification_result_id, resultId))
    } else {
      const [created] = await db.insert(qualification_results).values(resultValues).returning()
      resultId = created.id
    }

    if (isDowngrade) {
      downgrades += 1
      recoverableTotal += delta

      // Attribute causes from the billed category's failed requirements,
      // falling back to the union of all blocking requirements observed.
      const billedTrace = trace.find((t) => t.category_code === txn.billed_category_code)
      let causes = (billedTrace?.failed_requirements as string[] | undefined) ?? []
      if (causes.length === 0) {
        const all = new Set<string>()
        for (const t of trace) for (const f of (t.failed_requirements as string[]) ?? []) all.add(f)
        causes = Array.from(all)
      }
      if (causes.length === 0) causes = ['mcc_mismatch']

      const share = Math.round(delta / causes.length)
      for (const cause of causes) {
        const meta = CAUSE_FIX[cause] ?? { fix: 'Review qualification requirements.', severity: 'medium' }
        await db.insert(downgrade_causes).values({
          workspace_id: workspaceId,
          qualification_result_id: resultId,
          transaction_id: txn.id,
          cause_code: cause,
          severity: meta.severity,
          recoverable_cents: share,
          required_fix: meta.fix,
          detail: { delta_cents: delta, billed_category_code: txn.billed_category_code },
        })
        const acc = byCause.get(cause) ?? { recoverable: 0, count: 0 }
        acc.recoverable += share
        acc.count += 1
        byCause.set(cause, acc)
      }
    }
  }

  // Rebuild recoverable_savings rows for this workspace by cause scope.
  await db
    .delete(recoverable_savings)
    .where(and(eq(recoverable_savings.workspace_id, workspaceId), eq(recoverable_savings.scope, 'cause')))
  for (const [cause, agg] of byCause) {
    await db.insert(recoverable_savings).values({
      workspace_id: workspaceId,
      scope: 'cause',
      scope_key: cause,
      period_label: 'sample',
      recoverable_cents: agg.recoverable,
      annualized_cents: agg.recoverable * 12,
      txn_count: agg.count,
      required_fix: (CAUSE_FIX[cause] ?? { fix: '' }).fix,
    })
  }

  // Reconciliation row for the batch.
  const reconValues = {
    workspace_id: workspaceId,
    batch_id: batchId,
    total_billed_cents: totalBilled,
    total_computed_cents: totalComputed,
    discrepancy_cents: totalBilled - totalComputed,
    txn_count: txns.length,
    downgrade_count: downgrades,
    status: 'open',
    notes: 'Generated by sample seeder.',
  }
  const [existingRecon] = await db
    .select()
    .from(reconciliations)
    .where(eq(reconciliations.batch_id, batchId))
    .limit(1)
  if (existingRecon) {
    await db.update(reconciliations).set(reconValues).where(eq(reconciliations.id, existingRecon.id))
  } else {
    await db.insert(reconciliations).values(reconValues)
  }

  return { count: txns.length, downgrades, recoverable_cents: recoverableTotal }
}

// ---------------------------------------------------------------------------
// POST /seed — plant a complete demo workspace + qualify it.
// ---------------------------------------------------------------------------

router.post('/seed', authMiddleware, async (c) => {
  const userId = getUserId(c)

  // 1. Workspace + owner membership.
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Sample Merchant Portfolio', owner_id: userId })
    .returning()

  await db.insert(workspace_members).values({ workspace_id: ws.id, user_id: userId, role: 'owner' })

  // 2. Processor.
  const [processor] = await db
    .insert(processors)
    .values({
      workspace_id: ws.id,
      name: 'Sample Acquirer',
      mid: 'MID-SAMPLE-0001',
      pricing_model: 'interchange_plus',
      plus_bps: 15,
      plus_per_item_cents: 10,
      notes: 'Demo interchange-plus processor.',
    })
    .returning()

  // 3. Active Visa rate-table version + categories (best -> worst).
  const [version] = await db
    .insert(rate_table_versions)
    .values({
      workspace_id: ws.id,
      brand: 'visa',
      name: 'Visa Sample Rates 2026',
      effective_date: new Date('2026-01-01T00:00:00Z'),
      is_active: true,
      source_note: 'Synthetic demo rate table.',
    })
    .returning()

  const categorySeed = [
    {
      code: 'CPS_RETAIL',
      name: 'CPS / Retail (card present)',
      card_product: null,
      mcc_set: [] as string[],
      percent_rate: 1.51,
      per_item_cents: 10,
      requires_level2: false,
      requires_level3: false,
      requires_avs: false,
      requires_card_present: true,
      max_settlement_hours: 24,
      tier_rank: 1,
      notes: 'Lowest qualified retail rate.',
    },
    {
      code: 'CPS_ECI',
      name: 'CPS / e-Commerce Basic',
      card_product: null,
      mcc_set: [] as string[],
      percent_rate: 1.8,
      per_item_cents: 10,
      requires_level2: false,
      requires_level3: false,
      requires_avs: true,
      requires_card_present: false,
      max_settlement_hours: 48,
      tier_rank: 2,
      notes: 'Card-not-present with AVS.',
    },
    {
      code: 'COMMERCIAL_L2',
      name: 'Commercial Card Level 2',
      card_product: 'commercial',
      mcc_set: [] as string[],
      percent_rate: 2.05,
      per_item_cents: 10,
      requires_level2: true,
      requires_level3: false,
      requires_avs: false,
      requires_card_present: false,
      max_settlement_hours: 48,
      tier_rank: 3,
      notes: 'Commercial card with Level 2 data.',
    },
    {
      code: 'EIRF',
      name: 'Electronic Interchange Reimbursement Fee',
      card_product: null,
      mcc_set: [] as string[],
      percent_rate: 2.3,
      per_item_cents: 10,
      requires_level2: false,
      requires_level3: false,
      requires_avs: false,
      requires_card_present: false,
      max_settlement_hours: null as number | null,
      tier_rank: 8,
      notes: 'Mid-tier downgrade.',
    },
    {
      code: 'STANDARD',
      name: 'Standard (worst case)',
      card_product: null,
      mcc_set: [] as string[],
      percent_rate: 2.95,
      per_item_cents: 10,
      requires_level2: false,
      requires_level3: false,
      requires_avs: false,
      requires_card_present: false,
      max_settlement_hours: null as number | null,
      tier_rank: 9,
      notes: 'Non-qualified standard rate.',
    },
  ]

  for (const cat of categorySeed) {
    await db.insert(interchange_categories).values({
      version_id: version.id,
      brand: 'visa',
      ...cat,
    })
  }

  // 4. Upload batch.
  const [batch] = await db
    .insert(upload_batches)
    .values({
      workspace_id: ws.id,
      processor_id: processor.id,
      filename: 'sample-statement.csv',
      source_format: 'csv',
      row_count: 0,
      status: 'parsed',
      uploaded_by: userId,
    })
    .returning()

  // 5. Transactions with planted downgrades.
  const authBase = new Date('2026-06-01T12:00:00Z')
  const hoursLater = (h: number) => new Date(authBase.getTime() + h * 3_600_000)

  const txnSeed = [
    // Clean card-present retail txn billed at CPS_RETAIL -> no downgrade.
    {
      external_ref: 'TXN-0001',
      amount_cents: 10000,
      mcc: '5411',
      card_brand: 'visa',
      card_product: 'consumer',
      entry_mode: 'chip',
      has_avs: true,
      has_cvv: true,
      has_level2: false,
      has_level3: false,
      settlement_offset_h: 6,
      billed_category_code: 'CPS_RETAIL',
      billed_percent_rate: 1.51,
    },
    // Planted: LATE SETTLEMENT. Card present but settled 72h late -> falls to EIRF/STANDARD.
    {
      external_ref: 'TXN-0002',
      amount_cents: 25000,
      mcc: '5812',
      card_brand: 'visa',
      card_product: 'consumer',
      entry_mode: 'chip',
      has_avs: true,
      has_cvv: true,
      has_level2: false,
      has_level3: false,
      settlement_offset_h: 72,
      billed_category_code: 'STANDARD',
      billed_percent_rate: 2.95,
    },
    // Planted: MISSING LEVEL 2 on a commercial card -> billed STANDARD instead of COMMERCIAL_L2.
    {
      external_ref: 'TXN-0003',
      amount_cents: 50000,
      mcc: '5045',
      card_brand: 'visa',
      card_product: 'commercial',
      entry_mode: 'keyed',
      has_avs: true,
      has_cvv: false,
      has_level2: false,
      has_level3: false,
      settlement_offset_h: 12,
      billed_category_code: 'STANDARD',
      billed_percent_rate: 2.95,
    },
    // Planted: MISSING AVS on e-commerce -> can't reach CPS_ECI, billed EIRF.
    {
      external_ref: 'TXN-0004',
      amount_cents: 8000,
      mcc: '5999',
      card_brand: 'visa',
      card_product: 'consumer',
      entry_mode: 'ecommerce',
      has_avs: false,
      has_cvv: true,
      has_level2: false,
      has_level3: false,
      settlement_offset_h: 10,
      billed_category_code: 'EIRF',
      billed_percent_rate: 2.3,
    },
    // Clean commercial txn with Level 2 -> billed COMMERCIAL_L2 correctly, no downgrade.
    {
      external_ref: 'TXN-0005',
      amount_cents: 30000,
      mcc: '5045',
      card_brand: 'visa',
      card_product: 'commercial',
      entry_mode: 'keyed',
      has_avs: true,
      has_cvv: false,
      has_level2: true,
      has_level3: false,
      settlement_offset_h: 18,
      billed_category_code: 'COMMERCIAL_L2',
      billed_percent_rate: 2.05,
    },
  ]

  let inserted = 0
  for (const t of txnSeed) {
    const authTs = authBase
    const settlementTs = hoursLater(t.settlement_offset_h)
    const billedFee = Math.round((t.billed_percent_rate * t.amount_cents) / 100) + 10
    await db.insert(transactions).values({
      workspace_id: ws.id,
      batch_id: batch.id,
      processor_id: processor.id,
      external_ref: t.external_ref,
      amount_cents: t.amount_cents,
      currency: 'USD',
      mcc: t.mcc,
      card_brand: t.card_brand,
      card_product: t.card_product,
      entry_mode: t.entry_mode,
      auth_timestamp: authTs,
      settlement_timestamp: settlementTs,
      has_avs: t.has_avs,
      has_cvv: t.has_cvv,
      has_level2: t.has_level2,
      has_level3: t.has_level3,
      billed_category_code: t.billed_category_code,
      billed_fee_cents: billedFee,
      billed_percent_rate: t.billed_percent_rate,
    })
    inserted += 1
  }

  await db.update(upload_batches).set({ row_count: inserted }).where(eq(upload_batches.id, batch.id))

  // 6. Qualify the planted batch immediately.
  await qualifyBatch(ws.id, batch.id)

  return c.json({ workspace_id: ws.id, batch_id: batch.id, txnCount: inserted }, 201)
})

export default router
