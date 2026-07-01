'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Stat } from '@/components/ui/Stat'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type SavingsRow = {
  id: string
  workspace_id: string
  scope: string
  scope_key: string
  period_label?: string | null
  recoverable_cents: number
  annualized_cents: number
  txn_count: number
  required_fix?: string | null
  created_at?: string
}

type Summary = {
  recoverable_cents: number
  annualized_cents: number
  txn_count: number
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

export default function SavingsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [rows, setRows] = useState<SavingsRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)
  const [scopeFilter, setScopeFilter] = useState('')

  const load = useCallback(async (wsId: string, scope: string) => {
    setLoading(true)
    setError(null)
    try {
      const [rowData, summaryData] = await Promise.all([
        api.listSavings({ workspace_id: wsId, scope: scope || undefined }),
        api.getSavingsSummary(wsId),
      ])
      setRows(Array.isArray(rowData) ? rowData : [])
      setSummary(summaryData ?? null)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load recoverable savings')
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

  useEffect(() => {
    if (!workspaceId) return
    load(workspaceId, scopeFilter)
  }, [scopeFilter, workspaceId, load])

  const scopes = useMemo(() => Array.from(new Set(rows.map((r) => r.scope))).sort(), [rows])

  if (loading && rows.length === 0 && !summary && !error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading recoverable savings..." />
      </div>
    )
  }

  if (noWorkspace) {
    return (
      <EmptyState
        title="No workspace found"
        description="Create a workspace and seed sample data from the dashboard to see recoverable savings."
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
        <h1 className="text-2xl font-bold text-white">Recoverable Savings</h1>
        <p className="text-sm text-slate-400">
          Estimated annual savings if downgrades and qualification gaps were fixed, broken down by scope.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Recoverable now" value={fmtUsd(summary?.recoverable_cents)} tone="warning" />
        <Stat label="Annualized" value={fmtUsd(summary?.annualized_cents)} tone="danger" hint="Projected over 12 months" />
        <Stat label="Transactions" value={(summary?.txn_count ?? 0).toLocaleString()} />
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">By scope</h2>
          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
          >
            <option value="">All scopes</option>
            {scopes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </CardHeader>
        <CardBody className="p-0">
          {rows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No recoverable savings yet"
                description="Run qualification and downgrade detection on an uploaded batch to populate this ledger."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Scope</TH>
                  <TH>Key</TH>
                  <TH>Period</TH>
                  <TH className="text-right">Transactions</TH>
                  <TH className="text-right">Recoverable</TH>
                  <TH className="text-right">Annualized</TH>
                  <TH>Required fix</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium text-slate-200">{r.scope}</TD>
                    <TD className="font-mono text-xs text-slate-400">{r.scope_key}</TD>
                    <TD className="text-slate-400">{r.period_label ?? '—'}</TD>
                    <TD className="text-right tabular-nums">{r.txn_count.toLocaleString()}</TD>
                    <TD className="text-right font-semibold tabular-nums text-amber-400">{fmtUsd(r.recoverable_cents)}</TD>
                    <TD className="text-right tabular-nums text-rose-400">{fmtUsd(r.annualized_cents)}</TD>
                    <TD className="max-w-xs text-xs text-slate-400">{r.required_fix ?? '—'}</TD>
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
