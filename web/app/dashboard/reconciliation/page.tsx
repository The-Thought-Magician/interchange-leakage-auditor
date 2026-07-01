'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Stat } from '@/components/ui/Stat'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type ReconciliationRow = {
  id: string
  workspace_id: string
  batch_id: string
  total_billed_cents: number
  total_computed_cents: number
  discrepancy_cents: number
  txn_count: number
  downgrade_count: number
  status: string
  notes?: string | null
  created_at?: string
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  open: 'warning',
  reviewing: 'info',
  resolved: 'success',
  disputed: 'danger',
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

export default function ReconciliationPage() {
  const [rows, setRows] = useState<ReconciliationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)

  const load = useCallback(async (wsId: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listReconciliations(wsId)
      setRows(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load reconciliations')
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
      await load(wsId)
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  const totals = useMemo(() => {
    const totalDiscrepancy = rows.reduce((s, r) => s + (r.discrepancy_cents ?? 0), 0)
    const openCount = rows.filter((r) => r.status === 'open').length
    const totalTxns = rows.reduce((s, r) => s + (r.txn_count ?? 0), 0)
    return { totalDiscrepancy, openCount, totalTxns }
  }, [rows])

  if (loading && rows.length === 0 && !error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading reconciliation batches..." />
      </div>
    )
  }

  if (noWorkspace) {
    return (
      <EmptyState
        title="No workspace found"
        description="Create a workspace and upload a settlement batch to run reconciliation."
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
        <h1 className="text-2xl font-bold text-white">Reconciliation</h1>
        <p className="text-sm text-slate-400">
          Billed-vs-computed interchange totals per uploaded batch, with the discrepancy flagged for review.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Open batches" value={totals.openCount.toLocaleString()} tone="warning" />
        <Stat label="Total discrepancy" value={fmtUsd(totals.totalDiscrepancy)} tone="danger" />
        <Stat label="Transactions reconciled" value={totals.totalTxns.toLocaleString()} />
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-white">Batches</h2>
        </CardHeader>
        <CardBody className="p-0">
          {rows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No reconciliation batches yet"
                description="Upload a settlement file to generate a billed-vs-computed reconciliation."
                action={
                  <Link href="/dashboard/uploads">
                    <Button>Go to uploads</Button>
                  </Link>
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Batch</TH>
                  <TH className="text-right">Billed</TH>
                  <TH className="text-right">Computed</TH>
                  <TH className="text-right">Discrepancy</TH>
                  <TH className="text-right">Transactions</TH>
                  <TH className="text-right">Downgrades</TH>
                  <TH>Status</TH>
                  <TH>Notes</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-mono text-xs text-slate-400">{r.batch_id.slice(0, 8)}</TD>
                    <TD className="text-right tabular-nums">{fmtUsd(r.total_billed_cents)}</TD>
                    <TD className="text-right tabular-nums">{fmtUsd(r.total_computed_cents)}</TD>
                    <TD
                      className={`text-right font-semibold tabular-nums ${
                        r.discrepancy_cents > 0 ? 'text-rose-400' : r.discrepancy_cents < 0 ? 'text-emerald-400' : 'text-slate-400'
                      }`}
                    >
                      {fmtUsd(r.discrepancy_cents)}
                    </TD>
                    <TD className="text-right tabular-nums">{r.txn_count.toLocaleString()}</TD>
                    <TD className="text-right tabular-nums">{r.downgrade_count.toLocaleString()}</TD>
                    <TD>
                      <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge>
                    </TD>
                    <TD className="max-w-xs truncate text-xs text-slate-500">{r.notes ?? '—'}</TD>
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
