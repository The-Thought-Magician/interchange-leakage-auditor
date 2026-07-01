'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type RateTableVersion = {
  id: string
  workspace_id: string
  brand: string
  name: string
  effective_date: string | null
  is_active: boolean
  source_note: string | null
  created_at: string
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

export default function RateTablesPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [rows, setRows] = useState<RateTableVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)
  const [brandFilter, setBrandFilter] = useState('')

  const load = useCallback(async (wsId: string, brand: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listRateTables({ workspace_id: wsId, brand: brand || undefined })
      setRows(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load rate tables')
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
    load(workspaceId, brandFilter)
  }, [brandFilter, workspaceId, load])

  if (loading && rows.length === 0 && !error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading rate tables..." />
      </div>
    )
  }

  if (noWorkspace) {
    return (
      <EmptyState
        title="No workspace found"
        description="Create a workspace and seed sample data from the dashboard to manage rate tables."
        action={
          <a href="/dashboard">
            <Button>Go to dashboard</Button>
          </a>
        }
      />
    )
  }

  const brands = Array.from(new Set(rows.map((r) => r.brand))).sort()

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Rate Tables</h1>
          <p className="text-sm text-slate-400">
            Interchange category rate table versions by card brand, used to compute qualification and effective rate.
          </p>
        </div>
        <select
          value={brandFilter}
          onChange={(e) => setBrandFilter(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
        >
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-white">Versions</h2>
        </CardHeader>
        <CardBody className="p-0">
          {rows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No rate tables yet"
                description="Seed sample data from the dashboard to populate rate table versions, or create one from a processor upload."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Brand</TH>
                  <TH>Name</TH>
                  <TH>Effective date</TH>
                  <TH>Status</TH>
                  <TH>Source</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium text-slate-200">{r.brand}</TD>
                    <TD>{r.name}</TD>
                    <TD className="tabular-nums text-slate-400">
                      {r.effective_date ? new Date(r.effective_date).toLocaleDateString() : '—'}
                    </TD>
                    <TD>
                      <Badge tone={r.is_active ? 'success' : 'neutral'}>{r.is_active ? 'active' : 'inactive'}</Badge>
                    </TD>
                    <TD className="max-w-xs truncate text-xs text-slate-500">{r.source_note ?? '—'}</TD>
                    <TD className="text-right">
                      <Link href={`/dashboard/rate-tables/${r.id}`} className="text-sm text-emerald-400 hover:text-emerald-300">
                        Open →
                      </Link>
                    </TD>
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
