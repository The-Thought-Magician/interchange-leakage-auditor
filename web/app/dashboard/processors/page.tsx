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

type Processor = {
  id: string
  workspace_id: string
  name: string
  mid: string | null
  pricing_model: string | null
  plus_bps: number | null
  plus_per_item_cents: number | null
  notes: string | null
  created_at: string
}

const PRICING_MODELS = ['interchange_plus', 'flat_rate', 'tiered', 'blended']

function pricingTone(model: string | null): 'success' | 'info' | 'warning' | 'neutral' {
  switch (model) {
    case 'interchange_plus':
      return 'success'
    case 'flat_rate':
      return 'info'
    case 'tiered':
      return 'warning'
    default:
      return 'neutral'
  }
}

function prettyModel(model: string | null): string {
  if (!model) return '—'
  return model.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

type FormState = {
  name: string
  mid: string
  pricing_model: string
  plus_bps: string
  plus_per_item_cents: string
  notes: string
}

const EMPTY_FORM: FormState = {
  name: '',
  mid: '',
  pricing_model: 'interchange_plus',
  plus_bps: '',
  plus_per_item_cents: '',
  notes: '',
}

export default function ProcessorsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [processors, setProcessors] = useState<Processor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [modelFilter, setModelFilter] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Processor | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [deleting, setDeleting] = useState<Processor | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  // Resolve the active workspace from localStorage, falling back to the first workspace.
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

  const load = useCallback(async (wsId: string) => {
    setLoading(true)
    setError(null)
    try {
      const rows = await api.listProcessors(wsId)
      setProcessors(Array.isArray(rows) ? rows : [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load processors')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (workspaceId) load(workspaceId)
  }, [workspaceId, load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return processors.filter((p) => {
      if (modelFilter && p.pricing_model !== modelFilter) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        (p.mid ?? '').toLowerCase().includes(q) ||
        (p.notes ?? '').toLowerCase().includes(q)
      )
    })
  }, [processors, search, modelFilter])

  const stats = useMemo(() => {
    const count = processors.length
    const bpsValues = processors.map((p) => p.plus_bps ?? 0).filter((v) => v > 0)
    const avgBps = bpsValues.length
      ? bpsValues.reduce((a, b) => a + b, 0) / bpsValues.length
      : 0
    const ipCount = processors.filter((p) => p.pricing_model === 'interchange_plus').length
    return { count, avgBps, ipCount }
  }, [processors])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(p: Processor) {
    setEditing(p)
    setForm({
      name: p.name ?? '',
      mid: p.mid ?? '',
      pricing_model: p.pricing_model ?? 'interchange_plus',
      plus_bps: p.plus_bps != null ? String(p.plus_bps) : '',
      plus_per_item_cents: p.plus_per_item_cents != null ? String(p.plus_per_item_cents) : '',
      notes: p.notes ?? '',
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function submit() {
    if (!workspaceId) return
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }
    setSaving(true)
    setFormError(null)
    const body: Record<string, any> = {
      workspace_id: workspaceId,
      name: form.name.trim(),
      mid: form.mid.trim() || null,
      pricing_model: form.pricing_model || null,
      plus_bps: form.plus_bps === '' ? null : Number(form.plus_bps),
      plus_per_item_cents: form.plus_per_item_cents === '' ? null : Math.round(Number(form.plus_per_item_cents)),
      notes: form.notes.trim() || null,
    }
    try {
      if (editing) {
        await api.updateProcessor(editing.id, body)
      } else {
        await api.createProcessor(body)
      }
      setModalOpen(false)
      await load(workspaceId)
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
      await api.deleteProcessor(deleting.id)
      setDeleting(null)
      await load(workspaceId)
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
          <h1 className="text-2xl font-bold text-white">Processors</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Payment processors and their pricing terms, used to compute markup over interchange.
          </p>
        </div>
        <Button onClick={openCreate} disabled={!workspaceId}>
          + New Processor
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Processors" value={stats.count} />
        <Stat
          label="Avg Markup"
          value={`${stats.avgBps.toFixed(1)} bps`}
          hint="Across processors with a plus-bps term"
          tone="warning"
        />
        <Stat
          label="Interchange-Plus"
          value={stats.ipCount}
          hint="Transparent pricing models"
          tone="success"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, MID, notes…"
              className="w-64 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-red-500 focus:outline-none"
            />
            <select
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-red-500 focus:outline-none"
            >
              <option value="">All pricing models</option>
              {PRICING_MODELS.map((m) => (
                <option key={m} value={m}>
                  {prettyModel(m)}
                </option>
              ))}
            </select>
            {(search || modelFilter) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch('')
                  setModelFilter('')
                }}
              >
                Clear
              </Button>
            )}
          </div>
          <span className="text-xs text-neutral-500">
            {filtered.length} of {processors.length}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="p-12">
              <Spinner label="Loading processors…" />
            </div>
          ) : error ? (
            <div className="p-6">
              <EmptyState
                title="Could not load processors"
                description={error}
                action={
                  workspaceId ? (
                    <Button variant="secondary" onClick={() => load(workspaceId)}>
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
                title={processors.length === 0 ? 'No processors yet' : 'No matches'}
                description={
                  processors.length === 0
                    ? 'Add a processor to start auditing its statements against interchange.'
                    : 'Try a different search or filter.'
                }
                action={
                  processors.length === 0 ? (
                    <Button onClick={openCreate}>+ New Processor</Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>MID</TH>
                  <TH>Pricing</TH>
                  <TH className="text-right">+ bps</TH>
                  <TH className="text-right">+ per item</TH>
                  <TH>Notes</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((p) => (
                  <TR key={p.id}>
                    <TD className="font-medium text-white">{p.name}</TD>
                    <TD className="font-mono text-xs text-neutral-400">{p.mid || '—'}</TD>
                    <TD>
                      <Badge tone={pricingTone(p.pricing_model)}>{prettyModel(p.pricing_model)}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums">
                      {p.plus_bps != null ? p.plus_bps.toFixed(1) : '—'}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {p.plus_per_item_cents != null ? `${p.plus_per_item_cents}¢` : '—'}
                    </TD>
                    <TD className="max-w-xs truncate text-neutral-500">{p.notes || '—'}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" onClick={() => openEdit(p)}>
                          Edit
                        </Button>
                        <Button variant="danger" onClick={() => setDeleting(p)}>
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
        title={editing ? 'Edit Processor' : 'New Processor'}
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
          <Field label="Name">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Acme Payments"
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="MID">
              <input
                value={form.mid}
                onChange={(e) => setForm({ ...form, mid: e.target.value })}
                placeholder="Merchant ID"
                className={inputCls}
              />
            </Field>
            <Field label="Pricing Model">
              <select
                value={form.pricing_model}
                onChange={(e) => setForm({ ...form, pricing_model: e.target.value })}
                className={inputCls}
              >
                {PRICING_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {prettyModel(m)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Markup (bps)">
              <input
                type="number"
                step="0.1"
                value={form.plus_bps}
                onChange={(e) => setForm({ ...form, plus_bps: e.target.value })}
                placeholder="e.g. 25"
                className={inputCls}
              />
            </Field>
            <Field label="Per-Item (cents)">
              <input
                type="number"
                step="1"
                value={form.plus_per_item_cents}
                onChange={(e) => setForm({ ...form, plus_per_item_cents: e.target.value })}
                placeholder="e.g. 10"
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              placeholder="Contract terms, contact, etc."
              className={inputCls}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => !deleteBusy && setDeleting(null)}
        title="Delete Processor"
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
          Delete <span className="font-semibold text-white">{deleting?.name}</span>? Statements and
          transactions referencing this processor may be affected. This cannot be undone.
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
