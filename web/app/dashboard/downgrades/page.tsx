'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Stat } from '@/components/ui/Stat'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type DowngradeRow = {
  id: string
  transaction_id: string
  qualification_result_id?: string
  cause_code: string
  severity?: string
  recoverable_cents: number
  required_fix?: string
  detail?: Record<string, any> | null
  created_at?: string
  external_ref?: string | null
  amount_cents?: number | null
  card_brand?: string | null
  card_product?: string | null
  mcc?: string | null
  billed_category_code?: string | null
}

type CauseBreakdown = {
  cause_code: string
  count: number
  recoverable_cents: number
}

const CAUSE_LABELS: Record<string, string> = {
  late_settlement: 'Late settlement',
  missing_avs: 'Missing AVS',
  missing_level2: 'Missing Level 2',
  missing_level3: 'Missing Level 3',
  mcc_mismatch: 'MCC mismatch',
  missing_card_present: 'Missing card-present',
  wrong_entry_mode: 'Wrong entry mode',
}

const SEVERITY_TONE: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  high: 'danger',
  medium: 'warning',
  low: 'info',
}

function causeLabel(code: string) {
  return CAUSE_LABELS[code] ?? code.replace(/_/g, ' ')
}

function fmtUsd(cents?: number | null) {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

async function resolveWorkspaceId(): Promise<string | null> {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem('ila_workspace_id')
    if (stored) return stored
  }
  try {
    const ws = await api.listWorkspaces()
    const first = Array.isArray(ws) ? ws[0] : null
    if (first?.id) {
      if (typeof window !== 'undefined') window.localStorage.setItem('ila_workspace_id', first.id)
      return first.id
    }
  } catch {
    /* fall through */
  }
  return null
}

function PalettePip({ idx }: { idx: number }) {
  const colors = ['bg-red-400', 'bg-neutral-400', 'bg-amber-400', 'bg-rose-400', 'bg-violet-400', 'bg-teal-400', 'bg-orange-400']
  return <span className={`inline-block h-2.5 w-2.5 rounded-sm ${colors[idx % colors.length]}`} />
}

export default function DowngradesPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [rows, setRows] = useState<DowngradeRow[]>([])
  const [breakdown, setBreakdown] = useState<CauseBreakdown[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)

  const [causeFilter, setCauseFilter] = useState<string>('')
  const [search, setSearch] = useState('')

  const load = useCallback(async (wsId: string, cause: string) => {
    setLoading(true)
    setError(null)
    try {
      const [rowData, breakdownData] = await Promise.all([
        api.listDowngrades({ workspace_id: wsId, cause: cause || undefined }),
        api.getCauseBreakdown(wsId),
      ])
      setRows(Array.isArray(rowData) ? rowData : [])
      setBreakdown(Array.isArray(breakdownData) ? breakdownData : [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load downgrades')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const wsId = await resolveWorkspaceId()
      if (cancelled) return
      if (!wsId) {
        setNoWorkspace(true)
        setLoading(false)
        return
      }
      setWorkspaceId(wsId)
      await load(wsId, '')
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  // Refetch the flagged-list when the cause filter changes (server-side filter).
  useEffect(() => {
    if (!workspaceId) return
    load(workspaceId, causeFilter)
  }, [causeFilter, workspaceId, load])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      [r.external_ref, r.card_brand, r.card_product, r.mcc, r.billed_category_code, r.required_fix, r.cause_code]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q)),
    )
  }, [rows, search])

  const totals = useMemo(() => {
    const totalRecoverable = breakdown.reduce((s, b) => s + (b.recoverable_cents ?? 0), 0)
    const totalCount = breakdown.reduce((s, b) => s + (b.count ?? 0), 0)
    const topCause = [...breakdown].sort((a, b) => (b.recoverable_cents ?? 0) - (a.recoverable_cents ?? 0))[0]
    return { totalRecoverable, totalCount, topCause }
  }, [breakdown])

  const maxBreakdown = useMemo(
    () => Math.max(1, ...breakdown.map((b) => b.recoverable_cents ?? 0)),
    [breakdown],
  )

  if (loading && rows.length === 0 && breakdown.length === 0 && !error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading downgrade detector..." />
      </div>
    )
  }

  if (noWorkspace) {
    return (
      <EmptyState
        title="No workspace found"
        description="Create a workspace and seed sample data from the dashboard to run the downgrade detector."
        action={
          <a href="/dashboard">
            <Button>Go to dashboard</Button>
          </a>
        }
      />
    )
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-white">Downgrade Detector</h1>
        <p className="text-sm text-neutral-400">
          Transactions billed at a worse interchange category than they qualified for, attributed to a root cause.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Flagged downgrades" value={totals.totalCount.toLocaleString()} tone="danger" />
        <Stat label="Recoverable leakage" value={fmtUsd(totals.totalRecoverable)} tone="warning" hint="Across all causes" />
        <Stat
          label="Top cause"
          value={totals.topCause ? causeLabel(totals.topCause.cause_code) : '—'}
          hint={totals.topCause ? `${fmtUsd(totals.topCause.recoverable_cents)} recoverable` : 'No causes yet'}
        />
      </div>

      {/* Cause breakdown */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Cause breakdown</h2>
          {causeFilter && (
            <Button variant="ghost" onClick={() => setCauseFilter('')}>
              Clear filter
            </Button>
          )}
        </CardHeader>
        <CardBody>
          {breakdown.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500">
              No downgrade causes yet. Run qualification on a batch to populate the detector.
            </p>
          ) : (
            <div className="space-y-3">
              {[...breakdown]
                .sort((a, b) => (b.recoverable_cents ?? 0) - (a.recoverable_cents ?? 0))
                .map((b, i) => {
                  const pct = ((b.recoverable_cents ?? 0) / maxBreakdown) * 100
                  const active = causeFilter === b.cause_code
                  return (
                    <button
                      key={b.cause_code}
                      onClick={() => setCauseFilter(active ? '' : b.cause_code)}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                        active
                          ? 'border-red-500/50 bg-red-500/10'
                          : 'border-neutral-800 bg-neutral-900/40 hover:border-neutral-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex items-center gap-2 font-medium text-neutral-200">
                          <PalettePip idx={i} />
                          {causeLabel(b.cause_code)}
                        </span>
                        <span className="flex items-center gap-3 tabular-nums">
                          <span className="text-neutral-500">{b.count} txns</span>
                          <span className="font-semibold text-amber-400">{fmtUsd(b.recoverable_cents)}</span>
                        </span>
                      </div>
                      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-800">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-red-500 to-amber-400"
                          style={{ width: `${Math.max(2, pct)}%` }}
                        />
                      </div>
                    </button>
                  )
                })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Flagged transactions */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-white">Flagged transactions</h2>
            {causeFilter && <Badge tone="info">{causeLabel(causeFilter)}</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ref, brand, MCC, fix..."
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 focus:border-red-500 focus:outline-none sm:w-64"
            />
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="py-10">
              <Spinner label="Loading flagged transactions..." />
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={rows.length === 0 ? 'No downgrades flagged' : 'No matches'}
                description={
                  rows.length === 0
                    ? 'No transactions were downgraded for this workspace and filter.'
                    : 'No flagged transactions match your search.'
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Transaction</TH>
                  <TH>Brand / Product</TH>
                  <TH>MCC</TH>
                  <TH>Billed cat.</TH>
                  <TH>Cause</TH>
                  <TH>Severity</TH>
                  <TH className="text-right">Amount</TH>
                  <TH className="text-right">Recoverable</TH>
                  <TH>Required fix</TH>
                </TR>
              </THead>
              <TBody>
                {filteredRows.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-mono text-xs text-neutral-400">
                      {r.external_ref || r.transaction_id.slice(0, 8)}
                    </TD>
                    <TD>
                      <span className="text-neutral-200">{r.card_brand ?? '—'}</span>
                      {r.card_product && <span className="text-neutral-500"> · {r.card_product}</span>}
                    </TD>
                    <TD className="tabular-nums">{r.mcc ?? '—'}</TD>
                    <TD className="font-mono text-xs">{r.billed_category_code ?? '—'}</TD>
                    <TD>
                      <Badge tone="warning">{causeLabel(r.cause_code)}</Badge>
                    </TD>
                    <TD>
                      <Badge tone={SEVERITY_TONE[r.severity ?? ''] ?? 'neutral'}>{r.severity ?? 'n/a'}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums text-neutral-300">{fmtUsd(r.amount_cents)}</TD>
                    <TD className="text-right font-semibold tabular-nums text-amber-400">
                      {fmtUsd(r.recoverable_cents)}
                    </TD>
                    <TD className="max-w-xs text-xs text-neutral-400">{r.required_fix ?? '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
