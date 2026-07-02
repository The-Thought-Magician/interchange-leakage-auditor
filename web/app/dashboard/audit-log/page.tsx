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
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WORKSPACE_KEY = 'ila.workspace_id'

type Workspace = { id: string; name: string }

type AuditEntry = {
  id: string
  workspace_id?: string
  user_id?: string | null
  action: string
  entity_type?: string | null
  entity_id?: string | null
  metadata?: any
  created_at?: string
}

function fmtDate(ts?: string) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' })
}

function actionTone(action: string): 'success' | 'danger' | 'warning' | 'info' | 'neutral' {
  const a = action.toLowerCase()
  if (a.includes('delete') || a.includes('revoke') || a.includes('remove')) return 'danger'
  if (a.includes('create') || a.includes('issue') || a.includes('add') || a.includes('seed')) return 'success'
  if (a.includes('update') || a.includes('activate') || a.includes('parse') || a.includes('run')) return 'warning'
  return 'info'
}

export default function AuditLogPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')

  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [dataLoading, setDataLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // filters
  const [actionFilter, setActionFilter] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const [search, setSearch] = useState('')

  const [detail, setDetail] = useState<AuditEntry | null>(null)

  const loadWorkspaces = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list: Workspace[] = await api.listWorkspaces()
      const arr = Array.isArray(list) ? list : []
      setWorkspaces(arr)
      const stored = typeof window !== 'undefined' ? localStorage.getItem(WORKSPACE_KEY) : null
      const next = (stored && arr.find((w) => w.id === stored)?.id) || (arr[0] && arr[0].id) || ''
      setWorkspaceId(next)
    } catch (e: any) {
      setError(e?.message || 'Failed to load workspaces')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadEntries = useCallback(
    async (wsId: string, action: string, entityType: string) => {
      if (!wsId) {
        setEntries([])
        return
      }
      setDataLoading(true)
      setError(null)
      try {
        const list: AuditEntry[] = await api.listAuditLog({
          workspace_id: wsId,
          action: action || undefined,
          entity_type: entityType || undefined,
        })
        setEntries(Array.isArray(list) ? list : [])
      } catch (e: any) {
        setError(e?.message || 'Failed to load audit log')
        setEntries([])
      } finally {
        setDataLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    loadWorkspaces()
  }, [loadWorkspaces])

  useEffect(() => {
    if (workspaceId && typeof window !== 'undefined') {
      localStorage.setItem(WORKSPACE_KEY, workspaceId)
    }
    loadEntries(workspaceId, actionFilter, entityFilter)
  }, [workspaceId, actionFilter, entityFilter, loadEntries])

  // distinct actions/entity types for filter dropdowns (derived from loaded set)
  const actionOptions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.action).filter(Boolean))).sort(),
    [entries],
  )
  const entityOptions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.entity_type).filter(Boolean) as string[])).sort(),
    [entries],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(
      (e) =>
        e.action?.toLowerCase().includes(q) ||
        e.entity_type?.toLowerCase().includes(q) ||
        e.entity_id?.toLowerCase().includes(q) ||
        e.user_id?.toLowerCase().includes(q),
    )
  }, [entries, search])

  const uniqueActors = useMemo(
    () => new Set(entries.map((e) => e.user_id).filter(Boolean)).size,
    [entries],
  )

  function clearFilters() {
    setActionFilter('')
    setEntityFilter('')
    setSearch('')
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading audit log..." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Audit Log</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Immutable record of every write action across the workspace.
          </p>
        </div>
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
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {workspaces.length === 0 ? (
        <EmptyState
          title="No workspaces yet"
          description="Create a workspace from the dashboard to start recording audit events."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Entries" value={entries.length} hint="Matching current filters" />
            <Stat label="Action types" value={actionOptions.length} hint="Distinct actions" tone="success" />
            <Stat label="Actors" value={uniqueActors} hint="Distinct users" />
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <h2 className="text-sm font-semibold text-white">Activity</h2>
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    value={actionFilter}
                    onChange={(e) => setActionFilter(e.target.value)}
                    className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="">All actions</option>
                    {actionOptions.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                  <select
                    value={entityFilter}
                    onChange={(e) => setEntityFilter(e.target.value)}
                    className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="">All entities</option>
                    {entityOptions.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search..."
                    className="w-48 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                  {(actionFilter || entityFilter || search) && (
                    <Button variant="ghost" onClick={clearFilters}>
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {dataLoading ? (
                <div className="flex min-h-[30vh] items-center justify-center">
                  <Spinner label="Loading entries..." />
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title={entries.length === 0 ? 'No audit entries' : 'No entries match your filters'}
                    description={
                      entries.length === 0
                        ? 'Audit events appear here as members create, update, and delete records.'
                        : 'Try clearing the action, entity, or search filters.'
                    }
                    action={
                      entries.length > 0 && (actionFilter || entityFilter || search) ? (
                        <Button variant="secondary" onClick={clearFilters}>
                          Clear filters
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Time</TH>
                      <TH>Action</TH>
                      <TH>Entity</TH>
                      <TH>Entity ID</TH>
                      <TH>Actor</TH>
                      <TH className="text-right">Details</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((e) => (
                      <TR key={e.id}>
                        <TD className="whitespace-nowrap text-xs text-neutral-400">{fmtDate(e.created_at)}</TD>
                        <TD>
                          <Badge tone={actionTone(e.action)}>{e.action}</Badge>
                        </TD>
                        <TD className="text-neutral-300">{e.entity_type || '—'}</TD>
                        <TD>
                          <span className="font-mono text-xs text-neutral-500">
                            {e.entity_id ? `${e.entity_id.slice(0, 12)}…` : '—'}
                          </span>
                        </TD>
                        <TD>
                          <span className="font-mono text-xs text-neutral-400">
                            {e.user_id ? `${e.user_id.slice(0, 10)}…` : 'system'}
                          </span>
                        </TD>
                        <TD className="text-right">
                          {e.metadata && Object.keys(e.metadata || {}).length > 0 ? (
                            <Button
                              variant="ghost"
                              className="px-3 py-1 text-xs"
                              onClick={() => setDetail(e)}
                            >
                              View
                            </Button>
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
        </>
      )}

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title="Audit entry"
        footer={<Button onClick={() => setDetail(null)}>Close</Button>}
      >
        {detail && (
          <div className="space-y-3 text-sm">
            <Field label="Action" value={detail.action} />
            <Field label="Entity type" value={detail.entity_type || '—'} />
            <Field label="Entity ID" value={detail.entity_id || '—'} mono />
            <Field label="Actor" value={detail.user_id || 'system'} mono />
            <Field label="Time" value={fmtDate(detail.created_at)} />
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-500">Metadata</div>
              <pre className="mt-1 max-h-64 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 font-mono text-xs text-neutral-300">
                {JSON.stringify(detail.metadata ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`mt-0.5 break-all text-neutral-200 ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
    </div>
  )
}
