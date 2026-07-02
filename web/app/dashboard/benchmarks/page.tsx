'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'ila_workspace_id'

type Benchmark = {
  id: string
  workspace_id: string
  dimension: string
  dimension_key: string | null
  band_low_bps: number | null
  band_target_bps: number | null
  band_high_bps: number | null
  source_note: string | null
  created_at: string
}

const DIMENSIONS = ['card_brand', 'card_product', 'mcc', 'processor', 'overall']

function prettyDim(d: string): string {
  return d.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function dimTone(d: string): 'success' | 'info' | 'warning' | 'neutral' {
  switch (d) {
    case 'card_brand':
      return 'info'
    case 'card_product':
      return 'success'
    case 'mcc':
      return 'warning'
    default:
      return 'neutral'
  }
}

// Small SVG band visualization: low → target → high across a shared scale.
function BandBar({ low, target, high, max }: { low: number; high: number; target: number; max: number }) {
  const scale = (v: number) => (max > 0 ? Math.min(100, Math.max(0, (v / max) * 100)) : 0)
  const x0 = scale(low)
  const x1 = scale(high)
  const xt = scale(target)
  const width = Math.max(1, x1 - x0)
  return (
    <svg viewBox="0 0 100 12" preserveAspectRatio="none" className="h-3 w-full">
      <rect x={0} y={5} width={100} height={2} rx={1} className="fill-neutral-800" />
      <rect x={x0} y={3} width={width} height={6} rx={2} className="fill-red-500/40" />
      <line x1={xt} x2={xt} y1={1} y2={11} className="stroke-red-400" strokeWidth={1.5} />
    </svg>
  )
}

type FormState = {
  dimension: string
  dimension_key: string
  band_low_bps: string
  band_target_bps: string
  band_high_bps: string
  source_note: string
}

const EMPTY_FORM: FormState = {
  dimension: 'card_brand',
  dimension_key: '',
  band_low_bps: '',
  band_target_bps: '',
  band_high_bps: '',
  source_note: '',
}

export default function BenchmarksPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [dimFilter, setDimFilter] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Benchmark | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [deleting, setDeleting] = useState<Benchmark | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
        if (stored) {
          if (!cancelled) setWorkspaceId(stored)
          return
        }
        const ws = await api.listWorkspaces()
        const first = Array.isArray(ws) && ws.length ? ws[0].id : null
        if (!cancelled) {
          if (first && typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, first)
          setWorkspaceId(first)
          if (!first) setLoading(false)
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? 'Failed to resolve workspace')
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(async (wsId: string, dimension?: string) => {
    setLoading(true)
    setError(null)
    try {
      const rows = await api.listBenchmarks({ workspace_id: wsId, dimension: dimension || undefined })
      setBenchmarks(Array.isArray(rows) ? rows : [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load benchmarks')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (workspaceId) load(workspaceId, dimFilter)
  }, [workspaceId, dimFilter, load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return benchmarks
    return benchmarks.filter(
      (b) =>
        (b.dimension_key ?? '').toLowerCase().includes(q) ||
        b.dimension.toLowerCase().includes(q) ||
        (b.source_note ?? '').toLowerCase().includes(q),
    )
  }, [benchmarks, search])

  const maxBps = useMemo(() => {
    const vals = benchmarks.flatMap((b) => [b.band_low_bps ?? 0, b.band_high_bps ?? 0, b.band_target_bps ?? 0])
    return Math.max(1, ...vals)
  }, [benchmarks])

  const stats = useMemo(() => {
    const count = benchmarks.length
    const dims = new Set(benchmarks.map((b) => b.dimension)).size
    const targets = benchmarks.map((b) => b.band_target_bps ?? 0).filter((v) => v > 0)
    const avgTarget = targets.length ? targets.reduce((a, b) => a + b, 0) / targets.length : 0
    return { count, dims, avgTarget }
  }, [benchmarks])

  function openCreate() {
    setEditing(null)
    setForm({ ...EMPTY_FORM, dimension: dimFilter || 'card_brand' })
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(b: Benchmark) {
    setEditing(b)
    setForm({
      dimension: b.dimension,
      dimension_key: b.dimension_key ?? '',
      band_low_bps: b.band_low_bps != null ? String(b.band_low_bps) : '',
      band_target_bps: b.band_target_bps != null ? String(b.band_target_bps) : '',
      band_high_bps: b.band_high_bps != null ? String(b.band_high_bps) : '',
      source_note: b.source_note ?? '',
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function submit() {
    if (!workspaceId) return
    if (!form.dimension) {
      setFormError('Dimension is required')
      return
    }
    const low = form.band_low_bps === '' ? null : Number(form.band_low_bps)
    const target = form.band_target_bps === '' ? null : Number(form.band_target_bps)
    const high = form.band_high_bps === '' ? null : Number(form.band_high_bps)
    if (low != null && high != null && low > high) {
      setFormError('Band low must be ≤ band high')
      return
    }
    setSaving(true)
    setFormError(null)
    const body: Record<string, any> = {
      workspace_id: workspaceId,
      dimension: form.dimension,
      dimension_key: form.dimension_key.trim() || null,
      band_low_bps: low,
      band_target_bps: target,
      band_high_bps: high,
      source_note: form.source_note.trim() || null,
    }
    try {
      if (editing) {
        await api.updateBenchmark(editing.id, body)
      } else {
        await api.createBenchmark(body)
      }
      setModalOpen(false)
      await load(workspaceId, dimFilter)
    } catch (e: any) {
      setFormError(e?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleting || !workspaceId) return
    setDeleteBusy(true)
    try {
      await api.deleteBenchmark(deleting.id)
      setDeleting(null)
      await load(workspaceId, dimFilter)
    } catch (e: any) {
      setError(e?.message ?? 'Delete failed')
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Benchmark Bands</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Target effective-rate bands (bps) per dimension, used to flag over-cost areas.
          </p>
        </div>
        <Button onClick={openCreate} disabled={!workspaceId}>
          + New Band
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Bands" value={stats.count} />
        <Stat label="Dimensions" value={stats.dims} tone="success" />
        <Stat
          label="Avg Target"
          value={`${stats.avgTarget.toFixed(0)} bps`}
          hint="Mean of band targets"
          tone="warning"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search key, dimension, note…"
              className="w-64 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-red-500 focus:outline-none"
            />
            <select
              value={dimFilter}
              onChange={(e) => setDimFilter(e.target.value)}
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-red-500 focus:outline-none"
            >
              <option value="">All dimensions</option>
              {DIMENSIONS.map((d) => (
                <option key={d} value={d}>
                  {prettyDim(d)}
                </option>
              ))}
            </select>
            {(search || dimFilter) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch('')
                  setDimFilter('')
                }}
              >
                Clear
              </Button>
            )}
          </div>
          <span className="text-xs text-neutral-500">
            {filtered.length} of {benchmarks.length}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="p-12">
              <Spinner label="Loading benchmarks…" />
            </div>
          ) : error ? (
            <div className="p-6">
              <EmptyState
                title="Could not load benchmarks"
                description={error}
                action={
                  workspaceId ? (
                    <Button variant="secondary" onClick={() => load(workspaceId, dimFilter)}>
                      Retry
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : !workspaceId ? (
            <div className="p-6">
              <EmptyState
                title="No workspace selected"
                description="Create or pick a workspace on the dashboard first."
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={benchmarks.length === 0 ? 'No benchmark bands yet' : 'No matches'}
                description={
                  benchmarks.length === 0
                    ? 'Define target bps bands so the effective-rate report can flag outliers.'
                    : 'Try a different search or filter.'
                }
                action={
                  benchmarks.length === 0 ? (
                    <Button onClick={openCreate}>+ New Band</Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Dimension</TH>
                  <TH>Key</TH>
                  <TH className="text-right">Low</TH>
                  <TH className="text-right">Target</TH>
                  <TH className="text-right">High</TH>
                  <TH className="w-48">Band</TH>
                  <TH>Source</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((b) => (
                  <TR key={b.id}>
                    <TD>
                      <Badge tone={dimTone(b.dimension)}>{prettyDim(b.dimension)}</Badge>
                    </TD>
                    <TD className="font-mono text-xs text-neutral-300">{b.dimension_key || '—'}</TD>
                    <TD className="text-right tabular-nums text-neutral-400">
                      {b.band_low_bps != null ? b.band_low_bps.toFixed(0) : '—'}
                    </TD>
                    <TD className="text-right tabular-nums font-semibold text-red-400">
                      {b.band_target_bps != null ? b.band_target_bps.toFixed(0) : '—'}
                    </TD>
                    <TD className="text-right tabular-nums text-neutral-400">
                      {b.band_high_bps != null ? b.band_high_bps.toFixed(0) : '—'}
                    </TD>
                    <TD>
                      {b.band_low_bps != null && b.band_high_bps != null ? (
                        <BandBar
                          low={b.band_low_bps}
                          high={b.band_high_bps}
                          target={b.band_target_bps ?? (b.band_low_bps + b.band_high_bps) / 2}
                          max={maxBps}
                        />
                      ) : (
                        <span className="text-xs text-neutral-600">—</span>
                      )}
                    </TD>
                    <TD className="max-w-xs truncate text-neutral-500">{b.source_note || '—'}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" onClick={() => openEdit(b)}>
                          Edit
                        </Button>
                        <Button variant="danger" onClick={() => setDeleting(b)}>
                          Delete
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

      <Modal
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={editing ? 'Edit Band' : 'New Band'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
              {formError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dimension">
              <select
                value={form.dimension}
                onChange={(e) => setForm({ ...form, dimension: e.target.value })}
                className={inputCls}
              >
                {DIMENSIONS.map((d) => (
                  <option key={d} value={d}>
                    {prettyDim(d)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Key">
              <input
                value={form.dimension_key}
                onChange={(e) => setForm({ ...form, dimension_key: e.target.value })}
                placeholder="e.g. visa, 5411, MC-World"
                className={inputCls}
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Low (bps)">
              <input
                type="number"
                step="1"
                value={form.band_low_bps}
                onChange={(e) => setForm({ ...form, band_low_bps: e.target.value })}
                placeholder="150"
                className={inputCls}
              />
            </Field>
            <Field label="Target (bps)">
              <input
                type="number"
                step="1"
                value={form.band_target_bps}
                onChange={(e) => setForm({ ...form, band_target_bps: e.target.value })}
                placeholder="175"
                className={inputCls}
              />
            </Field>
            <Field label="High (bps)">
              <input
                type="number"
                step="1"
                value={form.band_high_bps}
                onChange={(e) => setForm({ ...form, band_high_bps: e.target.value })}
                placeholder="210"
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Source Note">
            <textarea
              value={form.source_note}
              onChange={(e) => setForm({ ...form, source_note: e.target.value })}
              rows={2}
              placeholder="Industry data, internal target, etc."
              className={inputCls}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => !deleteBusy && setDeleting(null)}
        title="Delete Band"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={deleteBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleteBusy}>
              {deleteBusy ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-300">
          Delete the{' '}
          <span className="font-semibold text-white">
            {deleting ? prettyDim(deleting.dimension) : ''} {deleting?.dimension_key || ''}
          </span>{' '}
          band? This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-red-500 focus:outline-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</span>
      {children}
    </label>
  )
}
