'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'ila.workspace_id'

interface Workspace { id: string; name: string }
interface Overview {
  leakage_cents?: number
  downgrade_rate?: number
  recoverable_cents?: number
  txn_count?: number
  batch_count?: number
}
interface CauseBreakdown {
  cause_code?: string
  cause?: string
  count?: number
  txn_count?: number
  recoverable_cents?: number
  dollars_cents?: number
}
interface MccLeakage {
  mcc?: string
  txn_count?: number
  count?: number
  leakage_cents?: number
  recoverable_cents?: number
}

function fmtMoney(cents?: number) {
  const v = (cents ?? 0) / 100
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function fmtMoneyCents(cents?: number) {
  const v = (cents ?? 0) / 100
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtNum(n?: number) {
  return (n ?? 0).toLocaleString()
}
function fmtPct(rate?: number) {
  if (rate == null) return '0%'
  // accept either fraction (0.12) or percent (12)
  const pct = rate <= 1 ? rate * 100 : rate
  return `${pct.toFixed(1)}%`
}

const CAUSE_LABELS: Record<string, string> = {
  late_settlement: 'Late settlement',
  missing_avs: 'Missing AVS',
  missing_level2: 'Missing Level 2',
  missing_level3: 'Missing Level 3',
  mcc_mismatch: 'MCC mismatch',
  missing_card_present: 'Card-not-present',
  wrong_entry_mode: 'Wrong entry mode',
}
function causeLabel(code?: string) {
  if (!code) return 'Unknown'
  return CAUSE_LABELS[code] ?? code.replace(/_/g, ' ')
}

function HBar({ value, max, tone = 'emerald' }: { value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  const color = tone === 'rose' ? 'bg-rose-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function AnalyticsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsId, setWsId] = useState<string>('')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [causes, setCauses] = useState<CauseBreakdown[]>([])
  const [mccs, setMccs] = useState<MccLeakage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingData, setLoadingData] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Resolve workspaces once.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list: Workspace[] = await api.listWorkspaces()
        if (cancelled) return
        setWorkspaces(list || [])
        const stored = typeof window !== 'undefined' ? localStorage.getItem(WS_KEY) : null
        const initial = (stored && (list || []).some((w) => w.id === stored)) ? stored : (list?.[0]?.id ?? '')
        setWsId(initial)
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load workspaces')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const loadData = useCallback(async (id: string) => {
    if (!id) return
    setLoadingData(true)
    setError(null)
    try {
      const [ov, cz, mc] = await Promise.all([
        api.getAnalyticsOverview(id),
        api.getTopCauses(id),
        api.getTopMccs(id),
      ])
      setOverview(ov || null)
      setCauses(Array.isArray(cz) ? cz : [])
      setMccs(Array.isArray(mc) ? mc : [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load analytics')
    } finally {
      setLoadingData(false)
    }
  }, [])

  useEffect(() => {
    if (wsId) {
      if (typeof window !== 'undefined') localStorage.setItem(WS_KEY, wsId)
      loadData(wsId)
    }
  }, [wsId, loadData])

  const causeRows = useMemo(
    () => causes.map((c) => ({
      code: c.cause_code ?? c.cause ?? 'unknown',
      count: c.count ?? c.txn_count ?? 0,
      dollars: c.recoverable_cents ?? c.dollars_cents ?? 0,
    })).sort((a, b) => b.dollars - a.dollars),
    [causes]
  )
  const maxCause = causeRows.reduce((m, r) => Math.max(m, r.dollars), 0)

  const mccRows = useMemo(
    () => mccs.map((m) => ({
      mcc: m.mcc ?? '—',
      count: m.txn_count ?? m.count ?? 0,
      leak: m.leakage_cents ?? m.recoverable_cents ?? 0,
    })).sort((a, b) => b.leak - a.leak),
    [mccs]
  )
  const maxMcc = mccRows.reduce((m, r) => Math.max(m, r.leak), 0)

  if (loading) {
    return <div className="py-20"><Spinner label="Loading analytics..." /></div>
  }

  if (workspaces.length === 0) {
    return (
      <EmptyState
        title="No workspace yet"
        description="Create a workspace and seed sample data from the dashboard to see analytics."
        icon="📊"
        action={<a href="/dashboard"><Button>Go to dashboard</Button></a>}
      />
    )
  }

  const hasData = (overview?.txn_count ?? 0) > 0 || causeRows.length > 0 || mccRows.length > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Analytics</h1>
          <p className="text-sm text-slate-500">Aggregate interchange leakage across the workspace.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={wsId}
            onChange={(e) => setWsId(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => loadData(wsId)} disabled={loadingData}>
            {loadingData ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loadingData && !overview ? (
        <div className="py-16"><Spinner label="Crunching numbers..." /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Total leakage"
              value={fmtMoney(overview?.leakage_cents)}
              hint="Billed above optimal"
              tone="danger"
            />
            <Stat
              label="Recoverable"
              value={fmtMoney(overview?.recoverable_cents)}
              hint="Fixable downgrades"
              tone="success"
            />
            <Stat
              label="Downgrade rate"
              value={fmtPct(overview?.downgrade_rate)}
              hint={`${fmtNum(overview?.txn_count)} transactions`}
              tone="warning"
            />
            <Stat
              label="Batches analyzed"
              value={fmtNum(overview?.batch_count)}
              hint={`${fmtNum(overview?.txn_count)} txns total`}
            />
          </div>

          {!hasData ? (
            <EmptyState
              title="No analytics data yet"
              description="Upload a statement and run qualification, or seed sample data, to populate analytics."
              icon="📈"
              action={<a href="/dashboard/uploads"><Button>Upload a statement</Button></a>}
            />
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white">Top causes by recoverable $</h2>
                  <Badge tone="danger">{causeRows.length} causes</Badge>
                </CardHeader>
                <CardBody>
                  {causeRows.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-500">No downgrade causes detected.</p>
                  ) : (
                    <div className="space-y-4">
                      {causeRows.map((c) => (
                        <div key={c.code}>
                          <div className="mb-1.5 flex items-center justify-between text-sm">
                            <span className="font-medium text-slate-200">{causeLabel(c.code)}</span>
                            <span className="tabular-nums text-rose-400">{fmtMoneyCents(c.dollars)}</span>
                          </div>
                          <HBar value={c.dollars} max={maxCause} tone="rose" />
                          <div className="mt-1 text-xs text-slate-500">{fmtNum(c.count)} transactions</div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white">Top MCCs by leakage</h2>
                  <Badge tone="warning">{mccRows.length} MCCs</Badge>
                </CardHeader>
                <CardBody>
                  {mccRows.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-500">No MCC leakage detected.</p>
                  ) : (
                    <div className="space-y-4">
                      {mccRows.map((m) => (
                        <div key={m.mcc}>
                          <div className="mb-1.5 flex items-center justify-between text-sm">
                            <span className="font-mono font-medium text-slate-200">MCC {m.mcc}</span>
                            <span className="tabular-nums text-amber-400">{fmtMoneyCents(m.leak)}</span>
                          </div>
                          <HBar value={m.leak} max={maxMcc} tone="amber" />
                          <div className="mt-1 text-xs text-slate-500">{fmtNum(m.count)} transactions</div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <h2 className="text-sm font-semibold text-white">Cause detail</h2>
                </CardHeader>
                <CardBody className="p-0">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Cause</TH>
                        <TH className="text-right">Transactions</TH>
                        <TH className="text-right">Recoverable</TH>
                        <TH className="text-right">Share</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {causeRows.map((c) => {
                        const share = maxCause > 0 ? Math.round((c.dollars / causeRows.reduce((s, r) => s + r.dollars, 0)) * 100) : 0
                        return (
                          <TR key={c.code}>
                            <TD><span className="font-medium text-slate-200">{causeLabel(c.code)}</span></TD>
                            <TD className="text-right tabular-nums">{fmtNum(c.count)}</TD>
                            <TD className="text-right tabular-nums text-rose-400">{fmtMoneyCents(c.dollars)}</TD>
                            <TD className="text-right tabular-nums text-slate-400">{share}%</TD>
                          </TR>
                        )
                      })}
                    </TBody>
                  </Table>
                </CardBody>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  )
}
