'use client'

import { useCallback, useEffect, useState, use } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Transaction = {
  id: string
  external_ref: string | null
  amount_cents: number
  currency: string | null
  mcc: string | null
  card_brand: string | null
  card_product: string | null
  entry_mode: string | null
  auth_timestamp: string | null
  settlement_timestamp: string | null
  has_avs: boolean | null
  has_cvv: boolean | null
  has_level2: boolean | null
  has_level3: boolean | null
  level2_data: any
  level3_data: any
  billed_category_code: string | null
  billed_fee_cents: number | null
  billed_percent_rate: number | null
  tags: string[] | null
  batch_id: string | null
  processor_id: string | null
}

type RuleTraceEntry = {
  category_code: string
  reachable: boolean
  failed_requirements?: string[]
}

type QualificationResult = {
  id: string
  optimal_category_code: string | null
  optimal_fee_cents: number | null
  optimal_percent_rate: number | null
  billed_fee_cents: number | null
  delta_cents: number | null
  delta_bps: number | null
  is_downgrade: boolean | null
  rule_trace: RuleTraceEntry[] | null
  computed_at: string | null
}

type DowngradeCause = {
  id: string
  cause_code: string
  severity: string | null
  recoverable_cents: number | null
  required_fix: string | null
  detail: any
}

type Detail = {
  transaction: Transaction
  result: QualificationResult | null
  causes: DowngradeCause[]
}

function fmtMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  const sign = cents < 0 ? '-' : ''
  const v = Math.abs(cents) / 100
  return `${sign}$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(ts: string | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function fmtBps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return '—'
  return `${bps.toFixed(1)} bps`
}

const CAUSE_LABELS: Record<string, string> = {
  late_settlement: 'Late settlement',
  missing_avs: 'Missing AVS',
  missing_level2: 'Missing Level 2 data',
  missing_level3: 'Missing Level 3 data',
  mcc_mismatch: 'MCC mismatch',
  missing_card_present: 'Card-not-present',
  wrong_entry_mode: 'Wrong entry mode',
}

function severityTone(sev: string | null): 'danger' | 'warning' | 'info' | 'neutral' {
  switch ((sev || '').toLowerCase()) {
    case 'high':
    case 'critical':
      return 'danger'
    case 'medium':
      return 'warning'
    case 'low':
      return 'info'
    default:
      return 'neutral'
  }
}

export default function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const [tagInput, setTagInput] = useState('')
  const [savingTags, setSavingTags] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await api.getTransaction(id)
      setData(d)
    } catch (e: any) {
      setError(e?.message || 'Failed to load transaction')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const runQualification = async () => {
    setRunning(true)
    setMsg(null)
    try {
      await api.runQualificationTransaction(id)
      setMsg('Qualification engine re-run complete')
      await load()
    } catch (e: any) {
      setMsg(e?.message || 'Failed to run qualification')
    } finally {
      setRunning(false)
    }
  }

  const addTag = async () => {
    const tag = tagInput.trim()
    if (!tag || !data) return
    const current = Array.isArray(data.transaction.tags) ? data.transaction.tags : []
    if (current.includes(tag)) {
      setTagInput('')
      return
    }
    setSavingTags(true)
    setMsg(null)
    try {
      const updated = await api.setTransactionTags(id, { tags: [...current, tag] })
      setData((prev) => (prev ? { ...prev, transaction: { ...prev.transaction, tags: updated.tags ?? [...current, tag] } } : prev))
      setTagInput('')
    } catch (e: any) {
      setMsg(e?.message || 'Failed to set tags')
    } finally {
      setSavingTags(false)
    }
  }

  const removeTag = async (tag: string) => {
    if (!data) return
    const current = Array.isArray(data.transaction.tags) ? data.transaction.tags : []
    const next = current.filter((t) => t !== tag)
    setSavingTags(true)
    setMsg(null)
    try {
      const updated = await api.setTransactionTags(id, { tags: next })
      setData((prev) => (prev ? { ...prev, transaction: { ...prev.transaction, tags: updated.tags ?? next } } : prev))
    } catch (e: any) {
      setMsg(e?.message || 'Failed to set tags')
    } finally {
      setSavingTags(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner label="Loading transaction…" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-2xl py-16">
        <EmptyState
          title="Transaction not found"
          description={error || 'This transaction could not be loaded.'}
          action={
            <Link href="/dashboard/transactions">
              <Button variant="secondary">Back to transactions</Button>
            </Link>
          }
        />
      </div>
    )
  }

  const t = data.transaction
  const r = data.result
  const causes = data.causes || []
  const trace = r?.rule_trace || []
  const isDowngrade = !!r?.is_downgrade
  const tags = Array.isArray(t.tags) ? t.tags : []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/transactions" className="text-xs text-neutral-500 hover:text-red-400">
            ← Transactions
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-bold text-white">
            {t.external_ref || t.id.slice(0, 12)}
            {r ? (
              isDowngrade ? (
                <Badge tone="danger">Downgrade</Badge>
              ) : (
                <Badge tone="success">Optimal</Badge>
              )
            ) : (
              <Badge tone="neutral">Not qualified</Badge>
            )}
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            {t.card_brand || 'Unknown brand'} · {t.card_product || 'product n/a'} · MCC {t.mcc || '—'}
          </p>
        </div>
        <Button onClick={runQualification} disabled={running}>
          {running ? 'Running…' : r ? 'Re-run qualification' : 'Run qualification'}
        </Button>
      </div>

      {msg && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">{msg}</div>}

      {/* Qualification stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Amount" value={fmtMoney(t.amount_cents)} hint={t.currency || 'USD'} />
        <Stat label="Billed fee" value={fmtMoney(r?.billed_fee_cents ?? t.billed_fee_cents)} tone="warning" />
        <Stat label="Optimal fee" value={fmtMoney(r?.optimal_fee_cents)} tone="success" />
        <Stat
          label="Leakage (delta)"
          value={fmtMoney(r?.delta_cents)}
          tone={isDowngrade ? 'danger' : 'neutral'}
          hint={fmtBps(r?.delta_bps)}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Transaction details */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <span className="text-sm font-semibold text-neutral-200">Transaction</span>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <Field label="External ref" value={t.external_ref || '—'} mono />
            <Field label="Entry mode" value={t.entry_mode || '—'} />
            <Field label="Auth time" value={fmtDate(t.auth_timestamp)} />
            <Field label="Settlement" value={fmtDate(t.settlement_timestamp)} />
            <Field label="Billed category" value={t.billed_category_code || '—'} mono />
            <Field
              label="Billed rate"
              value={t.billed_percent_rate != null ? `${t.billed_percent_rate}%` : '—'}
            />
            <div className="border-t border-neutral-800 pt-3">
              <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Eligibility flags</div>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={t.has_avs ? 'success' : 'neutral'}>AVS {t.has_avs ? '✓' : '✕'}</Badge>
                <Badge tone={t.has_cvv ? 'success' : 'neutral'}>CVV {t.has_cvv ? '✓' : '✕'}</Badge>
                <Badge tone={t.has_level2 ? 'success' : 'neutral'}>L2 {t.has_level2 ? '✓' : '✕'}</Badge>
                <Badge tone={t.has_level3 ? 'success' : 'neutral'}>L3 {t.has_level3 ? '✓' : '✕'}</Badge>
              </div>
            </div>
            <div className="border-t border-neutral-800 pt-3">
              <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Tags</div>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {tags.length === 0 && <span className="text-xs text-neutral-600">No tags</span>}
                {tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 rounded-md border border-neutral-500/30 bg-neutral-500/10 px-2 py-0.5 text-xs text-neutral-400">
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      disabled={savingTags}
                      aria-label={`Remove ${tag}`}
                      className="text-neutral-500/70 hover:text-rose-400"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTag()}
                  placeholder="add tag"
                  className="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-red-500 focus:outline-none"
                />
                <Button variant="secondary" onClick={addTag} disabled={savingTags || !tagInput.trim()}>
                  Add
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Qualification result + causes */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <span className="text-sm font-semibold text-neutral-200">Qualification result</span>
              {r?.computed_at && <span className="text-xs text-neutral-500">computed {fmtDate(r.computed_at)}</span>}
            </CardHeader>
            <CardBody>
              {!r ? (
                <EmptyState
                  title="Not qualified yet"
                  description="Run the qualification engine to compute the optimal interchange category and any leakage."
                  action={
                    <Button onClick={runQualification} disabled={running}>
                      {running ? 'Running…' : 'Run qualification'}
                    </Button>
                  }
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-4">
                    <div className="text-xs uppercase tracking-wide text-neutral-500">Billed</div>
                    <div className="mt-1 font-mono text-sm text-amber-400">{t.billed_category_code || '—'}</div>
                    <div className="mt-1 text-lg font-bold tabular-nums text-amber-400">{fmtMoney(r.billed_fee_cents)}</div>
                  </div>
                  <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
                    <div className="text-xs uppercase tracking-wide text-neutral-500">Optimal</div>
                    <div className="mt-1 font-mono text-sm text-red-400">{r.optimal_category_code || '—'}</div>
                    <div className="mt-1 text-lg font-bold tabular-nums text-red-400">{fmtMoney(r.optimal_fee_cents)}</div>
                  </div>
                  <div className="sm:col-span-2">
                    <DeltaBar billed={r.billed_fee_cents} optimal={r.optimal_fee_cents} />
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Downgrade causes */}
          <Card>
            <CardHeader>
              <span className="text-sm font-semibold text-neutral-200">Downgrade causes</span>
            </CardHeader>
            <CardBody>
              {causes.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  {r && !isDowngrade
                    ? 'This transaction qualified at the optimal rate. No recoverable leakage.'
                    : 'No downgrade causes recorded.'}
                </p>
              ) : (
                <div className="space-y-3">
                  {causes.map((c) => (
                    <div key={c.id} className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge tone={severityTone(c.severity)}>{c.severity || 'cause'}</Badge>
                          <span className="font-medium text-neutral-200">{CAUSE_LABELS[c.cause_code] || c.cause_code}</span>
                        </div>
                        <span className="font-bold tabular-nums text-rose-400">{fmtMoney(c.recoverable_cents)} recoverable</span>
                      </div>
                      {c.required_fix && <p className="mt-2 text-sm text-neutral-400">Fix: {c.required_fix}</p>}
                      {c.detail && (
                        <pre className="mt-2 overflow-x-auto rounded-md border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-400">
                          {JSON.stringify(c.detail, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Rule trace */}
          <Card>
            <CardHeader>
              <span className="text-sm font-semibold text-neutral-200">Rule trace</span>
            </CardHeader>
            <CardBody>
              {trace.length === 0 ? (
                <p className="text-sm text-neutral-500">No rule trace available. Run the qualification engine to generate one.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Category</TH>
                      <TH>Reachable</TH>
                      <TH>Failed requirements</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {trace.map((entry, i) => (
                      <TR key={`${entry.category_code}-${i}`}>
                        <TD className="font-mono text-xs">{entry.category_code}</TD>
                        <TD>
                          {entry.reachable ? <Badge tone="success">reachable</Badge> : <Badge tone="danger">blocked</Badge>}
                        </TD>
                        <TD>
                          {entry.failed_requirements && entry.failed_requirements.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {entry.failed_requirements.map((fr) => (
                                <Badge key={fr} tone="warning">
                                  {fr}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-neutral-600">—</span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-neutral-500">{label}</span>
      <span className={`text-right text-neutral-200 ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  )
}

function DeltaBar({ billed, optimal }: { billed: number | null; optimal: number | null }) {
  const b = billed ?? 0
  const o = optimal ?? 0
  const max = Math.max(b, o, 1)
  const billedPct = (b / max) * 100
  const optimalPct = (o / max) * 100
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wide text-neutral-500">Billed vs optimal</div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="w-16 text-xs text-neutral-500">Billed</span>
          <div className="h-3 flex-1 overflow-hidden rounded bg-neutral-800">
            <div className="h-full rounded bg-amber-500" style={{ width: `${billedPct}%` }} />
          </div>
          <span className="w-20 text-right text-xs tabular-nums text-amber-400">{fmtMoney(b)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-16 text-xs text-neutral-500">Optimal</span>
          <div className="h-3 flex-1 overflow-hidden rounded bg-neutral-800">
            <div className="h-full rounded bg-red-500" style={{ width: `${optimalPct}%` }} />
          </div>
          <span className="w-20 text-right text-xs tabular-nums text-red-400">{fmtMoney(o)}</span>
        </div>
      </div>
    </div>
  )
}
