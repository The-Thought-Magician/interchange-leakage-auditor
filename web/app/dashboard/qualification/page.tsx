'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type UploadBatch = {
  id: string
  filename: string | null
  source_format: string | null
  row_count: number | null
  status: string | null
  created_at: string | null
}

type QualificationResult = {
  id: string
  transaction_id: string
  optimal_category_code: string | null
  optimal_fee_cents: number | null
  billed_fee_cents: number | null
  delta_cents: number | null
  delta_bps: number | null
  is_downgrade: boolean | null
  computed_at: string | null
}

const WS_KEY = 'ila_workspace_id'

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
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtBps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return '—'
  return `${bps.toFixed(1)} bps`
}

function statusTone(s: string | null): 'success' | 'warning' | 'info' | 'neutral' {
  switch ((s || '').toLowerCase()) {
    case 'qualified':
    case 'parsed':
      return 'success'
    case 'pending':
      return 'warning'
    case 'error':
      return 'neutral'
    default:
      return 'info'
  }
}

export default function QualificationPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [batches, setBatches] = useState<UploadBatch[]>([])
  const [results, setResults] = useState<QualificationResult[]>([])

  const [batchFilter, setBatchFilter] = useState<string>('')
  const [downgradeOnly, setDowngradeOnly] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)

  // Resolve workspace
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const stored = typeof window !== 'undefined' ? localStorage.getItem(WS_KEY) : null
        if (stored) {
          if (active) setWorkspaceId(stored)
          return
        }
        const ws = await api.listWorkspaces()
        const first = Array.isArray(ws) && ws.length ? ws[0].id : null
        if (active) {
          if (first && typeof window !== 'undefined') localStorage.setItem(WS_KEY, first)
          setWorkspaceId(first)
          if (!first) setLoading(false)
        }
      } catch (e: any) {
        if (active) {
          setError(e?.message || 'Failed to resolve workspace')
          setLoading(false)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const loadResults = useCallback(
    async (ws: string, batch: string, downgrade: boolean, isReload: boolean) => {
      if (isReload) setReloading(true)
      try {
        const res = await api.listQualifications({
          workspace_id: ws,
          batch_id: batch || undefined,
          downgrade_only: downgrade || undefined,
        })
        setResults(Array.isArray(res) ? res : [])
      } catch (e: any) {
        setError(e?.message || 'Failed to load qualification results')
      } finally {
        setReloading(false)
      }
    },
    [],
  )

  // Initial load
  useEffect(() => {
    if (!workspaceId) return
    let active = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [b, r] = await Promise.all([
          api.listUploads(workspaceId),
          api.listQualifications({ workspace_id: workspaceId }),
        ])
        if (!active) return
        setBatches(Array.isArray(b) ? b : [])
        setResults(Array.isArray(r) ? r : [])
      } catch (e: any) {
        if (active) setError(e?.message || 'Failed to load data')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [workspaceId])

  // Refetch results when filters change (after initial load)
  useEffect(() => {
    if (!workspaceId || loading) return
    loadResults(workspaceId, batchFilter, downgradeOnly, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchFilter, downgradeOnly])

  const runBatch = async (batchId: string) => {
    setRunningId(batchId)
    setMsg(null)
    try {
      const res = await api.runQualificationBatch(batchId)
      setMsg(
        `Ran ${res?.count ?? 0} transactions · ${res?.downgrades ?? 0} downgrades · ${fmtMoney(res?.recoverable_cents)} recoverable`,
      )
      if (workspaceId) {
        const [b, r] = await Promise.all([
          api.listUploads(workspaceId),
          api.listQualifications({
            workspace_id: workspaceId,
            batch_id: batchFilter || undefined,
            downgrade_only: downgradeOnly || undefined,
          }),
        ])
        setBatches(Array.isArray(b) ? b : [])
        setResults(Array.isArray(r) ? r : [])
      }
    } catch (e: any) {
      setMsg(e?.message || 'Failed to run qualification batch')
    } finally {
      setRunningId(null)
    }
  }

  const summary = useMemo(() => {
    const count = results.length
    const downgrades = results.filter((r) => r.is_downgrade).length
    const leakage = results.reduce((a, r) => a + Math.max(0, r.delta_cents || 0), 0)
    const rate = count ? (downgrades / count) * 100 : 0
    return { count, downgrades, leakage, rate }
  }, [results])

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner label="Loading qualification results…" />
      </div>
    )
  }

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-2xl py-16">
        <EmptyState
          title="No workspace yet"
          description="Create or seed a workspace from the dashboard, then run the qualification engine over an upload batch."
          action={
            <Link href="/dashboard">
              <Button>Go to dashboard</Button>
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Qualification</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Run the deterministic interchange engine over upload batches and review per-transaction optimal vs billed results.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => workspaceId && loadResults(workspaceId, batchFilter, downgradeOnly, true)}
          disabled={reloading}
        >
          {reloading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Results" value={summary.count.toLocaleString()} />
        <Stat label="Downgrades" value={summary.downgrades.toLocaleString()} tone="danger" />
        <Stat label="Downgrade rate" value={`${summary.rate.toFixed(1)}%`} tone={summary.rate > 20 ? 'danger' : 'warning'} />
        <Stat label="Leakage" value={fmtMoney(summary.leakage)} tone="danger" />
      </div>

      {msg && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">{msg}</div>}

      {/* Run engine per batch */}
      <Card>
        <CardHeader>
          <span className="text-sm font-semibold text-neutral-200">Run engine per batch</span>
        </CardHeader>
        <CardBody>
          {batches.length === 0 ? (
            <EmptyState
              title="No upload batches"
              description="Upload a settlement file first, then run the qualification engine over it."
              action={
                <Link href="/dashboard/uploads">
                  <Button>Go to uploads</Button>
                </Link>
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Batch</TH>
                  <TH>Format</TH>
                  <TH className="text-right">Rows</TH>
                  <TH>Status</TH>
                  <TH>Uploaded</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {batches.map((b) => (
                  <TR key={b.id}>
                    <TD>
                      <Link href={`/dashboard/uploads/${b.id}`} className="font-medium text-red-400 hover:underline">
                        {b.filename || b.id.slice(0, 8)}
                      </Link>
                    </TD>
                    <TD className="text-xs uppercase text-neutral-500">{b.source_format || '—'}</TD>
                    <TD className="text-right tabular-nums">{b.row_count ?? '—'}</TD>
                    <TD>
                      <Badge tone={statusTone(b.status)}>{b.status || 'unknown'}</Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-neutral-500">{fmtDate(b.created_at)}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => setBatchFilter(b.id)}>
                          View results
                        </Button>
                        <Button onClick={() => runBatch(b.id)} disabled={runningId !== null}>
                          {runningId === b.id ? 'Running…' : 'Run engine'}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Results list */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-semibold text-neutral-200">Qualification results</span>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={batchFilter}
              onChange={(e) => setBatchFilter(e.target.value)}
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 focus:border-red-500 focus:outline-none"
            >
              <option value="">All batches</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.filename || b.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={downgradeOnly}
                onChange={(e) => setDowngradeOnly(e.target.checked)}
                className="h-4 w-4 rounded border-neutral-600 bg-neutral-950 text-red-500 focus:ring-red-500"
              />
              Downgrades only
            </label>
          </div>
        </CardHeader>
        <CardBody>
          {error ? (
            <EmptyState
              title="Could not load results"
              description={error}
              action={
                <Button variant="secondary" onClick={() => loadResults(workspaceId, batchFilter, downgradeOnly, true)}>
                  Retry
                </Button>
              }
            />
          ) : results.length === 0 ? (
            <EmptyState
              title="No qualification results"
              description="Run the engine over a batch above to compute optimal interchange and surface downgrades."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Transaction</TH>
                  <TH>Optimal category</TH>
                  <TH className="text-right">Billed</TH>
                  <TH className="text-right">Optimal</TH>
                  <TH className="text-right">Delta</TH>
                  <TH className="text-right">Delta bps</TH>
                  <TH>Status</TH>
                  <TH>Computed</TH>
                </TR>
              </THead>
              <TBody>
                {results.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <Link
                        href={`/dashboard/transactions/${r.transaction_id}`}
                        className="font-mono text-xs text-red-400 hover:underline"
                      >
                        {r.transaction_id.slice(0, 10)}
                      </Link>
                    </TD>
                    <TD className="font-mono text-xs text-neutral-400">{r.optimal_category_code || '—'}</TD>
                    <TD className="text-right tabular-nums text-amber-400">{fmtMoney(r.billed_fee_cents)}</TD>
                    <TD className="text-right tabular-nums text-red-400">{fmtMoney(r.optimal_fee_cents)}</TD>
                    <TD className={`text-right tabular-nums ${(r.delta_cents || 0) > 0 ? 'text-rose-400' : 'text-neutral-400'}`}>
                      {fmtMoney(r.delta_cents)}
                    </TD>
                    <TD className="text-right tabular-nums text-neutral-400">{fmtBps(r.delta_bps)}</TD>
                    <TD>{r.is_downgrade ? <Badge tone="danger">downgrade</Badge> : <Badge tone="success">optimal</Badge>}</TD>
                    <TD className="whitespace-nowrap text-xs text-neutral-500">{fmtDate(r.computed_at)}</TD>
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
