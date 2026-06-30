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

type EffectiveRateRow = {
  dimension?: string
  dimension_key: string
  billed_bps?: number | null
  optimal_bps?: number | null
  delta_bps?: number | null
  txn_count?: number | null
  volume_cents?: number | null
  leakage_cents?: number | null
}

type TrendPoint = {
  period_label?: string
  period?: string
  date?: string
  billed_bps?: number | null
  optimal_bps?: number | null
  txn_count?: number | null
  volume_cents?: number | null
}

type Benchmark = {
  id: string
  dimension: string
  dimension_key: string
  band_low_bps: number
  band_target_bps: number
  band_high_bps: number
  source_note?: string | null
}

const DIMENSIONS: { key: string; label: string }[] = [
  { key: 'overall', label: 'Overall' },
  { key: 'brand', label: 'Card brand' },
  { key: 'product', label: 'Card product' },
  { key: 'mcc', label: 'MCC' },
  { key: 'processor', label: 'Processor' },
]

function fmtBps(bps?: number | null) {
  if (bps === null || bps === undefined) return '—'
  return `${bps.toFixed(1)} bps`
}

function fmtPct(bps?: number | null) {
  if (bps === null || bps === undefined) return '—'
  return `${(bps / 100).toFixed(3)}%`
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

/** Classify an effective rate against its benchmark band. */
function bandStatus(bps: number | null | undefined, bench?: Benchmark) {
  if (bps === null || bps === undefined || !bench) return { tone: 'neutral' as const, label: 'No band' }
  if (bps <= bench.band_low_bps) return { tone: 'success' as const, label: 'Below band' }
  if (bps <= bench.band_target_bps) return { tone: 'success' as const, label: 'On target' }
  if (bps <= bench.band_high_bps) return { tone: 'warning' as const, label: 'Above target' }
  return { tone: 'danger' as const, label: 'Over band' }
}

/** Inline SVG dual-line chart for the effective-rate trend. */
function TrendChart({ points }: { points: TrendPoint[] }) {
  const W = 720
  const H = 240
  const padL = 48
  const padR = 16
  const padT = 16
  const padB = 36

  const series = useMemo(() => {
    const billed = points.map((p) => p.billed_bps ?? 0)
    const optimal = points.map((p) => p.optimal_bps ?? 0)
    const all = [...billed, ...optimal]
    const maxV = Math.max(1, ...all)
    const minV = Math.min(0, ...all)
    const range = maxV - minV || 1
    const innerW = W - padL - padR
    const innerH = H - padT - padB
    const x = (i: number) => padL + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
    const y = (v: number) => padT + innerH - ((v - minV) / range) * innerH
    const toPath = (vals: number[]) =>
      vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
    return { billed, optimal, maxV, minV, x, y, toPath, innerH }
  }, [points])

  if (points.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">No trend data yet. Run qualification to build history.</p>
    )
  }

  const gridLines = 4

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[480px]" role="img" aria-label="Effective rate trend">
        {/* horizontal grid */}
        {Array.from({ length: gridLines + 1 }).map((_, i) => {
          const gy = padT + (series.innerH / gridLines) * i
          const val = series.maxV - ((series.maxV - series.minV) / gridLines) * i
          return (
            <g key={i}>
              <line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="#1e293b" strokeWidth={1} />
              <text x={padL - 6} y={gy + 3} textAnchor="end" className="fill-slate-600" fontSize={10}>
                {val.toFixed(0)}
              </text>
            </g>
          )
        })}
        {/* optimal line */}
        <path d={series.toPath(series.optimal)} fill="none" stroke="#34d399" strokeWidth={2} />
        {/* billed line */}
        <path d={series.toPath(series.billed)} fill="none" stroke="#fb923c" strokeWidth={2} />
        {/* points + labels */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={series.x(i)} cy={series.y(p.optimal_bps ?? 0)} r={2.5} fill="#34d399" />
            <circle cx={series.x(i)} cy={series.y(p.billed_bps ?? 0)} r={2.5} fill="#fb923c" />
            {(points.length <= 8 || i % Math.ceil(points.length / 8) === 0) && (
              <text x={series.x(i)} y={H - padB + 16} textAnchor="middle" className="fill-slate-600" fontSize={9}>
                {(p.period_label || p.period || p.date || `#${i + 1}`).toString().slice(0, 7)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="mt-2 flex items-center gap-5 px-2 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-sm bg-orange-400" /> Billed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-sm bg-emerald-400" /> Optimal
        </span>
      </div>
    </div>
  )
}

/** Horizontal band visualization showing where the billed bps sits within the benchmark band. */
function BandMeter({ row, bench }: { row: EffectiveRateRow; bench?: Benchmark }) {
  if (!bench) return <span className="text-xs text-slate-600">No band</span>
  const billed = row.billed_bps ?? 0
  // Scale across [0, band_high * 1.4] so over-band values still render.
  const scaleMax = Math.max(bench.band_high_bps * 1.4, billed * 1.1, 1)
  const pos = (v: number) => `${Math.min(100, Math.max(0, (v / scaleMax) * 100))}%`
  const status = bandStatus(billed, bench)
  const markerColor =
    status.tone === 'danger' ? 'bg-rose-400' : status.tone === 'warning' ? 'bg-amber-400' : 'bg-emerald-400'
  return (
    <div className="w-44">
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-slate-800">
        {/* target band region */}
        <div
          className="absolute inset-y-0 bg-emerald-500/25"
          style={{ left: pos(bench.band_low_bps), right: `calc(100% - ${pos(bench.band_high_bps)})` }}
        />
        {/* target line */}
        <div className="absolute inset-y-0 w-px bg-emerald-400/70" style={{ left: pos(bench.band_target_bps) }} />
        {/* billed marker */}
        <div className={`absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded ${markerColor}`} style={{ left: pos(billed) }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-600">
        <span>{bench.band_low_bps.toFixed(0)}</span>
        <span className="text-emerald-500">{bench.band_target_bps.toFixed(0)}</span>
        <span>{bench.band_high_bps.toFixed(0)}</span>
      </div>
    </div>
  )
}

export default function EffectiveRatePage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [rows, setRows] = useState<EffectiveRateRow[]>([])
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)

  const [dimension, setDimension] = useState('overall')
  const [search, setSearch] = useState('')

  const loadRows = useCallback(async (wsId: string, dim: string) => {
    const data = await api.getEffectiveRate({ workspace_id: wsId, dimension: dim || undefined })
    setRows(Array.isArray(data) ? data : [])
  }, [])

  const loadAll = useCallback(
    async (wsId: string, dim: string) => {
      setLoading(true)
      setError(null)
      try {
        const [, trendData, benchData] = await Promise.all([
          loadRows(wsId, dim),
          api.getEffectiveRateTrend(wsId),
          api.listBenchmarks({ workspace_id: wsId }),
        ])
        setTrend(Array.isArray(trendData) ? trendData : [])
        setBenchmarks(Array.isArray(benchData) ? benchData : [])
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load effective-rate dashboard')
      } finally {
        setLoading(false)
      }
    },
    [loadRows],
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
      await loadAll(wsId, 'overall')
    })()
    return () => {
      cancelled = true
    }
  }, [loadAll])

  // Re-fetch the dimension breakdown when the dimension filter changes.
  useEffect(() => {
    if (!workspaceId) return
    setLoading(true)
    setError(null)
    loadRows(workspaceId, dimension)
      .catch((e: any) => setError(e?.message ?? 'Failed to load breakdown'))
      .finally(() => setLoading(false))
  }, [dimension, workspaceId, loadRows])

  // Index benchmarks by dimension_key for the active dimension.
  const benchByKey = useMemo(() => {
    const m = new Map<string, Benchmark>()
    for (const b of benchmarks) {
      if (b.dimension === dimension || dimension === 'overall') {
        m.set(b.dimension_key, b)
      }
      // Always index by key as a fallback so overall rows can match an "overall" benchmark.
      if (!m.has(b.dimension_key)) m.set(b.dimension_key, b)
    }
    return m
  }, [benchmarks, dimension])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => String(r.dimension_key ?? '').toLowerCase().includes(q))
  }, [rows, search])

  const totals = useMemo(() => {
    const totalVolume = rows.reduce((s, r) => s + (r.volume_cents ?? 0), 0)
    const totalLeakage = rows.reduce((s, r) => s + (r.leakage_cents ?? 0), 0)
    const totalTxns = rows.reduce((s, r) => s + (r.txn_count ?? 0), 0)
    // Volume-weighted billed/optimal effective rate.
    const wBilled =
      totalVolume > 0
        ? rows.reduce((s, r) => s + (r.billed_bps ?? 0) * (r.volume_cents ?? 0), 0) / totalVolume
        : rows.length
          ? rows.reduce((s, r) => s + (r.billed_bps ?? 0), 0) / rows.length
          : 0
    const wOptimal =
      totalVolume > 0
        ? rows.reduce((s, r) => s + (r.optimal_bps ?? 0) * (r.volume_cents ?? 0), 0) / totalVolume
        : rows.length
          ? rows.reduce((s, r) => s + (r.optimal_bps ?? 0), 0) / rows.length
          : 0
    return { totalVolume, totalLeakage, totalTxns, wBilled, wOptimal, deltaBps: wBilled - wOptimal }
  }, [rows])

  if (loading && rows.length === 0 && trend.length === 0 && !error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading effective-rate dashboard..." />
      </div>
    )
  }

  if (noWorkspace) {
    return (
      <EmptyState
        title="No workspace found"
        description="Create a workspace and seed sample data from the dashboard to see effective-rate analysis."
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
        <h1 className="text-2xl font-bold text-white">Effective Rate</h1>
        <p className="text-sm text-slate-400">
          Blended effective interchange rate (basis points of volume) compared to the optimal achievable rate and your
          benchmark bands.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Billed effective rate" value={fmtBps(totals.wBilled)} hint={fmtPct(totals.wBilled)} tone="warning" />
        <Stat label="Optimal effective rate" value={fmtBps(totals.wOptimal)} hint={fmtPct(totals.wOptimal)} tone="success" />
        <Stat
          label="Rate gap"
          value={fmtBps(totals.deltaBps)}
          hint="Billed minus optimal"
          tone={totals.deltaBps > 0 ? 'danger' : 'success'}
        />
        <Stat label="Leakage on volume" value={fmtUsd(totals.totalLeakage)} hint={fmtUsd(totals.totalVolume) + ' processed'} />
      </div>

      {/* Trend */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-white">Effective-rate trend</h2>
        </CardHeader>
        <CardBody>
          <TrendChart points={trend} />
        </CardBody>
      </Card>

      {/* Breakdown by dimension with benchmark bands */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-white">Breakdown with benchmark bands</h2>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={dimension}
              onChange={(e) => setDimension(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              {DIMENSIONS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search key..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none sm:w-48"
            />
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="py-10">
              <Spinner label="Loading breakdown..." />
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={rows.length === 0 ? 'No effective-rate data' : 'No matches'}
                description={
                  rows.length === 0
                    ? 'Run qualification on a batch to compute billed vs optimal effective rates.'
                    : 'No dimension keys match your search.'
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{DIMENSIONS.find((d) => d.key === dimension)?.label ?? 'Key'}</TH>
                  <TH className="text-right">Txns</TH>
                  <TH className="text-right">Billed</TH>
                  <TH className="text-right">Optimal</TH>
                  <TH className="text-right">Gap</TH>
                  <TH>Benchmark band</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Leakage</TH>
                </TR>
              </THead>
              <TBody>
                {filteredRows.map((r) => {
                  const bench = benchByKey.get(r.dimension_key)
                  const status = bandStatus(r.billed_bps, bench)
                  const delta = r.delta_bps ?? (r.billed_bps ?? 0) - (r.optimal_bps ?? 0)
                  return (
                    <TR key={`${r.dimension ?? dimension}-${r.dimension_key}`}>
                      <TD className="font-medium text-slate-200">{r.dimension_key || 'Overall'}</TD>
                      <TD className="text-right tabular-nums">{(r.txn_count ?? 0).toLocaleString()}</TD>
                      <TD className="text-right tabular-nums text-orange-300">{fmtBps(r.billed_bps)}</TD>
                      <TD className="text-right tabular-nums text-emerald-300">{fmtBps(r.optimal_bps)}</TD>
                      <TD className={`text-right tabular-nums ${delta > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {delta > 0 ? '+' : ''}
                        {fmtBps(delta)}
                      </TD>
                      <TD>
                        <BandMeter row={r} bench={bench} />
                      </TD>
                      <TD>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </TD>
                      <TD className="text-right font-semibold tabular-nums text-amber-400">{fmtUsd(r.leakage_cents)}</TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <p className="text-xs text-slate-600">
        Manage benchmark bands under{' '}
        <a href="/dashboard/benchmarks" className="text-emerald-400 hover:underline">
          Reference Data → Benchmarks
        </a>
        .
      </p>
    </div>
  )
}
