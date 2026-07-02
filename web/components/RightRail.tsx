'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'

type Overview = {
  leakage_cents?: number
  downgrade_rate?: number
  recoverable_cents?: number
  txn_count?: number
}

type SavingsSummary = {
  recoverable_cents?: number
  annualized_cents?: number
}

type CauseRow = { cause?: string; count?: number; amount_cents?: number }

function fmtUsd(cents?: number) {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtPct(rate?: number) {
  if (rate == null) return '0.0%'
  const pct = rate <= 1 ? rate * 100 : rate
  return `${pct.toFixed(1)}%`
}

/**
 * Right-rail companion panel. Pulls the same summary endpoints already used
 * by the dashboard/savings pages (analytics overview, savings summary, top
 * downgrade causes) — no new backend routes, no mock data.
 */
export default function RightRail({ workspaceId }: { workspaceId: string | null }) {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [savings, setSavings] = useState<SavingsSummary | null>(null)
  const [causes, setCauses] = useState<CauseRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId) {
      setOverview(null)
      setSavings(null)
      setCauses([])
      return
    }
    let active = true
    setLoading(true)
    setError(null)
    Promise.all([
      api.getAnalyticsOverview(workspaceId).catch(() => null),
      api.getSavingsSummary(workspaceId).catch(() => null),
      api.getTopCauses(workspaceId).catch(() => []),
    ])
      .then(([ov, sv, tc]) => {
        if (!active) return
        setOverview(ov || {})
        setSavings(sv || {})
        setCauses(Array.isArray(tc) ? tc.slice(0, 4) : [])
      })
      .catch((e) => {
        if (active) setError(e?.message || 'Failed to load summary')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [workspaceId])

  return (
    <aside className="hidden w-72 shrink-0 flex-col gap-4 xl:flex">
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Audit snapshot</h2>
        </CardHeader>
        <CardBody className="space-y-3">
          {!workspaceId ? (
            <p className="text-xs text-neutral-500">Select a workspace to see live totals.</p>
          ) : loading ? (
            <Spinner label="Loading…" />
          ) : error ? (
            <p className="text-xs text-red-400">{error}</p>
          ) : (
            <>
              <div>
                <div className="text-xs uppercase tracking-wide text-neutral-500">Total leakage</div>
                <div className="text-lg font-semibold text-red-400">{fmtUsd(overview?.leakage_cents)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-neutral-500">Recoverable</div>
                <div className="text-lg font-semibold text-white">
                  {fmtUsd(savings?.recoverable_cents ?? overview?.recoverable_cents)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-neutral-500">Annualized recovery</div>
                <div className="text-sm font-medium text-neutral-200">{fmtUsd(savings?.annualized_cents)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-neutral-500">Downgrade rate</div>
                <div className="text-sm font-medium text-neutral-200">{fmtPct(overview?.downgrade_rate)}</div>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Top downgrade causes</h2>
        </CardHeader>
        <CardBody className="space-y-2">
          {!workspaceId ? (
            <p className="text-xs text-neutral-500">No workspace selected.</p>
          ) : loading ? (
            <Spinner label="Loading…" />
          ) : causes.length === 0 ? (
            <p className="text-xs text-neutral-500">No downgrades recorded yet.</p>
          ) : (
            causes.map((c, i) => (
              <div key={c.cause || i} className="flex items-center justify-between gap-2 border-b border-neutral-800 pb-2 last:border-0 last:pb-0">
                <span className="text-xs text-neutral-300">{c.cause || 'Unknown'}</span>
                <Badge tone="danger">{fmtUsd(c.amount_cents)}</Badge>
              </div>
            ))
          )}
          <Link href="/dashboard/downgrades" className="mt-1 inline-block text-xs font-medium text-red-400 hover:text-red-300">
            View all downgrades →
          </Link>
        </CardBody>
      </Card>
    </aside>
  )
}
