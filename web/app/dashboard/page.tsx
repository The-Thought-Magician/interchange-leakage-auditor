'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import RightRail from '@/components/RightRail'

const WORKSPACE_KEY = 'ila.workspace_id'

type Workspace = { id: string; name: string; owner_id?: string; created_at?: string }

type Overview = {
  leakage_cents?: number
  downgrade_rate?: number
  recoverable_cents?: number
  txn_count?: number
  batch_count?: number
}

type SavingsSummary = {
  recoverable_cents?: number
  annualized_cents?: number
  txn_count?: number
}

function fmtUsd(cents?: number) {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

function fmtPct(rate?: number) {
  // rate may be a fraction (0..1) or already a percentage. Treat <=1 as fraction.
  if (rate == null) return '0.0%'
  const pct = rate <= 1 ? rate * 100 : rate
  return `${pct.toFixed(1)}%`
}

function fmtNum(n?: number) {
  return (n ?? 0).toLocaleString('en-US')
}

export default function DashboardPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [savings, setSavings] = useState<SavingsSummary | null>(null)

  const [loading, setLoading] = useState(true)
  const [dataLoading, setDataLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dataError, setDataError] = useState<string | null>(null)

  const [seeding, setSeeding] = useState(false)
  const [seedMsg, setSeedMsg] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)

  const selectedWorkspace = useMemo(
    () => workspaces.find((w) => w.id === workspaceId) || null,
    [workspaces, workspaceId],
  )

  const loadWorkspaces = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list: Workspace[] = await api.listWorkspaces()
      setWorkspaces(Array.isArray(list) ? list : [])
      const stored = typeof window !== 'undefined' ? localStorage.getItem(WORKSPACE_KEY) : null
      const next =
        (stored && list.find((w) => w.id === stored)?.id) || (list[0] && list[0].id) || ''
      setWorkspaceId(next)
    } catch (e: any) {
      setError(e?.message || 'Failed to load workspaces')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMetrics = useCallback(async (wsId: string) => {
    if (!wsId) {
      setOverview(null)
      setSavings(null)
      return
    }
    setDataLoading(true)
    setDataError(null)
    try {
      const [ov, sv] = await Promise.all([
        api.getAnalyticsOverview(wsId),
        api.getSavingsSummary(wsId),
      ])
      setOverview(ov || {})
      setSavings(sv || {})
    } catch (e: any) {
      setDataError(e?.message || 'Failed to load metrics')
      setOverview(null)
      setSavings(null)
    } finally {
      setDataLoading(false)
    }
  }, [])

  useEffect(() => {
    loadWorkspaces()
  }, [loadWorkspaces])

  useEffect(() => {
    if (workspaceId && typeof window !== 'undefined') {
      localStorage.setItem(WORKSPACE_KEY, workspaceId)
    }
    loadMetrics(workspaceId)
  }, [workspaceId, loadMetrics])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    setCreateErr(null)
    try {
      const ws: Workspace = await api.createWorkspace({ name: newName.trim() })
      setWorkspaces((prev) => [ws, ...prev])
      setWorkspaceId(ws.id)
      setCreateOpen(false)
      setNewName('')
    } catch (e: any) {
      setCreateErr(e?.message || 'Failed to create workspace')
    } finally {
      setCreating(false)
    }
  }

  async function handleSeed() {
    setSeeding(true)
    setSeedMsg(null)
    setError(null)
    try {
      const res = await api.seedSample(workspaceId ? { workspace_id: workspaceId } : undefined)
      setSeedMsg(
        `Seeded demo data: ${fmtNum(res?.txnCount)} transactions in batch ${String(res?.batch_id || '').slice(0, 8)}.`,
      )
      // The seeder may create a fresh workspace; pick it up.
      await loadWorkspaces()
      if (res?.workspace_id) setWorkspaceId(res.workspace_id)
      else await loadMetrics(workspaceId)
    } catch (e: any) {
      setError(e?.message || 'Failed to seed sample data')
    } finally {
      setSeeding(false)
    }
  }

  const downgradeRate = overview?.downgrade_rate
  const downgradeTone =
    downgradeRate == null ? 'neutral' : (downgradeRate <= 1 ? downgradeRate : downgradeRate / 100) > 0.1 ? 'danger' : 'warning'

  // Recoverable bar split for a simple SVG-free visual.
  const recoverable = savings?.recoverable_cents ?? overview?.recoverable_cents ?? 0
  const leakage = overview?.leakage_cents ?? 0
  const recoverPct = leakage > 0 ? Math.min(100, Math.round((recoverable / leakage) * 100)) : 0

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading dashboard..." />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
    <div className="min-w-0 flex-1 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Overview</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Interchange leakage, downgrade exposure, and recoverable savings at a glance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium uppercase tracking-wide text-neutral-500">Workspace</label>
            <select
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              disabled={workspaces.length === 0}
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
            >
              {workspaces.length === 0 && <option value="">No workspaces</option>}
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <Button variant="secondary" onClick={() => setCreateOpen(true)}>
            + Workspace
          </Button>
          <Button onClick={handleSeed} disabled={seeding}>
            {seeding ? 'Seeding...' : 'Seed sample data'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}
      {seedMsg && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {seedMsg}
        </div>
      )}

      {workspaces.length === 0 ? (
        <EmptyState
          title="No workspaces yet"
          description="Create a workspace and seed sample data to explore an interchange-leakage audit end to end."
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setCreateOpen(true)}>
                Create workspace
              </Button>
              <Button onClick={handleSeed} disabled={seeding}>
                {seeding ? 'Seeding...' : 'Seed sample data'}
              </Button>
            </div>
          }
        />
      ) : (
        <>
          {dataError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              {dataError}
            </div>
          )}

          {dataLoading ? (
            <div className="flex min-h-[30vh] items-center justify-center">
              <Spinner label="Loading metrics..." />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat
                  label="Total leakage"
                  value={fmtUsd(overview?.leakage_cents)}
                  hint="Billed above optimal interchange"
                  tone="danger"
                />
                <Stat
                  label="Downgrade rate"
                  value={fmtPct(overview?.downgrade_rate)}
                  hint={`${fmtNum(overview?.txn_count)} transactions analyzed`}
                  tone={downgradeTone as any}
                />
                <Stat
                  label="Recoverable"
                  value={fmtUsd(savings?.recoverable_cents ?? overview?.recoverable_cents)}
                  hint="Addressable with fixes"
                  tone="success"
                />
                <Stat
                  label="Annualized"
                  value={fmtUsd(savings?.annualized_cents)}
                  hint="Projected 12-month recovery"
                  tone="success"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-white">Leakage recovery potential</h2>
                      <Badge tone="success">{recoverPct}% recoverable</Badge>
                    </div>
                  </CardHeader>
                  <CardBody className="space-y-4">
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-neutral-400">
                        <span>Recoverable {fmtUsd(recoverable)}</span>
                        <span>Total leakage {fmtUsd(leakage)}</span>
                      </div>
                      <div className="h-3 w-full overflow-hidden rounded-full bg-neutral-800">
                        <div
                          className="h-full rounded-full bg-red-500 transition-all"
                          style={{ width: `${recoverPct}%` }}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 pt-2 sm:grid-cols-4">
                      <MiniStat label="Transactions" value={fmtNum(overview?.txn_count)} />
                      <MiniStat label="Batches" value={fmtNum(overview?.batch_count)} />
                      <MiniStat label="Recoverable txns" value={fmtNum(savings?.txn_count)} />
                      <MiniStat label="Downgrade rate" value={fmtPct(overview?.downgrade_rate)} />
                    </div>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <h2 className="text-sm font-semibold text-white">Current workspace</h2>
                  </CardHeader>
                  <CardBody className="space-y-3 text-sm">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-neutral-500">Name</div>
                      <div className="text-neutral-200">{selectedWorkspace?.name || '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-neutral-500">ID</div>
                      <div className="break-all font-mono text-xs text-neutral-400">{workspaceId || '—'}</div>
                    </div>
                    <div className="pt-2">
                      <a
                        href="/dashboard/uploads"
                        className="inline-flex items-center text-sm font-medium text-red-400 hover:text-red-300"
                      >
                        Go to uploads →
                      </a>
                    </div>
                  </CardBody>
                </Card>
              </div>
            </>
          )}
        </>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create workspace"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate as any} disabled={creating || !newName.trim()}>
              {creating ? 'Creating...' : 'Create'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreate} className="space-y-3">
          {createErr && <div className="text-sm text-rose-400">{createErr}</div>}
          <label className="block text-sm text-neutral-300">
            Workspace name
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Acme Payments"
              className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </label>
        </form>
      </Modal>
    </div>
    <RightRail workspaceId={workspaceId || null} />
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-neutral-100">{value}</div>
    </div>
  )
}
