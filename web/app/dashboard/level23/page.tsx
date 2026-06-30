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

type Level23Gap = {
  id?: string
  transaction_id: string
  level: 'level2' | 'level3' | string
  external_ref?: string | null
  amount_cents?: number | null
  card_brand?: string | null
  card_product?: string | null
  mcc?: string | null
  billed_category_code?: string | null
  optimal_category_code?: string | null
  recoverable_cents?: number | null
  has_level2?: boolean | null
  has_level3?: boolean | null
  required_fix?: string | null
}

type Level23Summary = {
  level2: { txn_count: number; recoverable_cents: number }
  level3: { txn_count: number; recoverable_cents: number }
  total: { txn_count: number; recoverable_cents: number }
}

const LEVELS: { key: string; label: string }[] = [
  { key: '', label: 'All levels' },
  { key: 'level2', label: 'Level 2' },
  { key: 'level3', label: 'Level 3' },
]

function fmtUsd(cents?: number | null) {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

function levelLabel(level: string) {
  if (level === 'level2') return 'Level 2'
  if (level === 'level3') return 'Level 3'
  return level
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

function OpportunityBar({
  label,
  recoverable,
  count,
  max,
  tone,
}: {
  label: string
  recoverable: number
  count: number
  max: number
  tone: 'l2' | 'l3'
}) {
  const pct = max > 0 ? (recoverable / max) * 100 : 0
  const barColor = tone === 'l2' ? 'from-sky-500 to-sky-400' : 'from-emerald-500 to-emerald-400'
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-200">{label}</span>
        <span className="tabular-nums text-slate-500">{count.toLocaleString()} txns</span>
      </div>
      <div className="mt-2 text-xl font-bold tabular-nums text-white">{fmtUsd(recoverable)}</div>
      <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full bg-gradient-to-r ${barColor}`} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
    </div>
  )
}

export default function Level23Page() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [gaps, setGaps] = useState<Level23Gap[]>([])
  const [summary, setSummary] = useState<Level23Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)

  const [levelFilter, setLevelFilter] = useState('')
  const [search, setSearch] = useState('')

  const loadGaps = useCallback(async (wsId: string, level: string) => {
    const data = await api.getLevel23Gaps({ workspace_id: wsId, level: level || undefined })
    setGaps(Array.isArray(data) ? data : [])
  }, [])

  const loadAll = useCallback(
    async (wsId: string, level: string) => {
      setLoading(true)
      setError(null)
      try {
        const [, summaryData] = await Promise.all([loadGaps(wsId, level), api.getLevel23Summary(wsId)])
        setSummary(summaryData ?? null)
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load Level 2/3 gaps')
      } finally {
        setLoading(false)
      }
    },
    [loadGaps],
  )

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
      await loadAll(wsId, '')
    })()
    return () => {
      cancelled = true
    }
  }, [loadAll])

  // Re-fetch gaps when level filter changes (server-side filter), summary stays workspace-wide.
  useEffect(() => {
    if (!workspaceId) return
    setLoading(true)
    setError(null)
    loadGaps(workspaceId, levelFilter)
      .catch((e: any) => setError(e?.message ?? 'Failed to load gaps'))
      .finally(() => setLoading(false))
  }, [levelFilter, workspaceId, loadGaps])

  const filteredGaps = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return gaps
    return gaps.filter((g) =>
      [g.external_ref, g.card_brand, g.card_product, g.mcc, g.billed_category_code, g.optimal_category_code, g.required_fix]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q)),
    )
  }, [gaps, search])

  const maxOpp = useMemo(() => {
    if (!summary) return 1
    return Math.max(1, summary.level2?.recoverable_cents ?? 0, summary.level3?.recoverable_cents ?? 0)
  }, [summary])

  if (loading && gaps.length === 0 && !summary && !error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading Level 2/3 gap report..." />
      </div>
    )
  }

  if (noWorkspace) {
    return (
      <EmptyState
        title="No workspace found"
        description="Create a workspace and seed sample data from the dashboard to see Level 2/3 eligibility gaps."
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
        <h1 className="text-2xl font-bold text-white">Level 2/3 Eligibility Gaps</h1>
        <p className="text-sm text-slate-400">
          Commercial-card transactions that would qualify for a lower Level 2 or Level 3 rate if the missing data
          fields were submitted.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          label="Total opportunity"
          value={fmtUsd(summary?.total?.recoverable_cents)}
          tone="warning"
          hint={`${(summary?.total?.txn_count ?? 0).toLocaleString()} txns with gaps`}
        />
        <Stat
          label="Level 2 opportunity"
          value={fmtUsd(summary?.level2?.recoverable_cents)}
          tone="success"
          hint={`${(summary?.level2?.txn_count ?? 0).toLocaleString()} txns`}
        />
        <Stat
          label="Level 3 opportunity"
          value={fmtUsd(summary?.level3?.recoverable_cents)}
          tone="success"
          hint={`${(summary?.level3?.txn_count ?? 0).toLocaleString()} txns`}
        />
      </div>

      {/* L2 vs L3 opportunity comparison */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-white">L2 vs L3 opportunity</h2>
        </CardHeader>
        <CardBody>
          {summary && (summary.level2?.recoverable_cents || summary.level3?.recoverable_cents) ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <OpportunityBar
                label="Level 2"
                recoverable={summary.level2?.recoverable_cents ?? 0}
                count={summary.level2?.txn_count ?? 0}
                max={maxOpp}
                tone="l2"
              />
              <OpportunityBar
                label="Level 3"
                recoverable={summary.level3?.recoverable_cents ?? 0}
                count={summary.level3?.txn_count ?? 0}
                max={maxOpp}
                tone="l3"
              />
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-slate-500">
              No Level 2/3 opportunity detected. Seed sample data or run qualification to populate this report.
            </p>
          )}
        </CardBody>
      </Card>

      {/* Gaps table */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-white">Eligibility gaps</h2>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex rounded-lg border border-slate-700 p-0.5">
              {LEVELS.map((l) => (
                <button
                  key={l.key || 'all'}
                  onClick={() => setLevelFilter(l.key)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    levelFilter === l.key ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ref, brand, MCC..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none sm:w-56"
            />
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="py-10">
              <Spinner label="Loading gaps..." />
            </div>
          ) : filteredGaps.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={gaps.length === 0 ? 'No eligibility gaps' : 'No matches'}
                description={
                  gaps.length === 0
                    ? 'Every commercial transaction is submitting the data needed for its best rate.'
                    : 'No gaps match your search.'
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Transaction</TH>
                  <TH>Level</TH>
                  <TH>Brand / Product</TH>
                  <TH>MCC</TH>
                  <TH>Billed → Optimal</TH>
                  <TH>L2</TH>
                  <TH>L3</TH>
                  <TH className="text-right">Amount</TH>
                  <TH className="text-right">Opportunity</TH>
                  <TH>Required fix</TH>
                </TR>
              </THead>
              <TBody>
                {filteredGaps.map((g) => (
                  <TR key={g.id ?? g.transaction_id}>
                    <TD className="font-mono text-xs text-slate-400">
                      {g.external_ref || g.transaction_id.slice(0, 8)}
                    </TD>
                    <TD>
                      <Badge tone={g.level === 'level3' ? 'success' : 'info'}>{levelLabel(g.level)}</Badge>
                    </TD>
                    <TD>
                      <span className="text-slate-200">{g.card_brand ?? '—'}</span>
                      {g.card_product && <span className="text-slate-500"> · {g.card_product}</span>}
                    </TD>
                    <TD className="tabular-nums">{g.mcc ?? '—'}</TD>
                    <TD className="font-mono text-xs">
                      <span className="text-rose-400">{g.billed_category_code ?? '—'}</span>
                      <span className="text-slate-600"> → </span>
                      <span className="text-emerald-400">{g.optimal_category_code ?? '—'}</span>
                    </TD>
                    <TD>
                      <Badge tone={g.has_level2 ? 'success' : 'danger'}>{g.has_level2 ? 'yes' : 'no'}</Badge>
                    </TD>
                    <TD>
                      <Badge tone={g.has_level3 ? 'success' : 'danger'}>{g.has_level3 ? 'yes' : 'no'}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums text-slate-300">{fmtUsd(g.amount_cents)}</TD>
                    <TD className="text-right font-semibold tabular-nums text-amber-400">
                      {fmtUsd(g.recoverable_cents)}
                    </TD>
                    <TD className="max-w-xs text-xs text-slate-400">{g.required_fix ?? '—'}</TD>
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
