'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'ila.workspace_id'

interface Workspace { id: string; name: string }
interface Webhook {
  id: string
  workspace_id?: string
  url?: string
  events?: string[]
  secret?: string
  is_active?: boolean
  created_at?: string
}
interface WebhookDelivery {
  id: string
  webhook_id?: string
  event?: string
  payload?: any
  status_code?: number
  success?: boolean
  error?: string | null
  created_at?: string
}

const EVENT_OPTIONS = [
  'upload.created',
  'upload.parsed',
  'qualification.completed',
  'downgrade.detected',
  'savings.updated',
  'reconciliation.created',
]

function fmtTime(iso?: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

interface FormState { url: string; events: string[]; secret: string; is_active: boolean }
const emptyForm: FormState = { url: '', events: [], secret: '', is_active: true }

export default function WebhooksPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsId, setWsId] = useState('')
  const [hooks, setHooks] = useState<Webhook[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingData, setLoadingData] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // create / edit modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Webhook | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // per-row action state
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Webhook | null>(null)
  const [deleting, setDeleting] = useState(false)

  // deliveries panel
  const [deliveriesFor, setDeliveriesFor] = useState<Webhook | null>(null)
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])
  const [loadingDeliveries, setLoadingDeliveries] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list: Workspace[] = await api.listWorkspaces()
        if (cancelled) return
        setWorkspaces(list || [])
        const stored = typeof window !== 'undefined' ? localStorage.getItem(WS_KEY) : null
        const initial = (stored && (list || []).some((w) => w.id === stored)) ? stored : (list?.[0]?.id ?? '')
        setWsId(initial)
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load workspaces')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const loadHooks = useCallback(async (id: string) => {
    if (!id) return
    setLoadingData(true)
    setError(null)
    try {
      const list: Webhook[] = await api.listWebhooks(id)
      setHooks(Array.isArray(list) ? list : [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load webhooks')
    } finally {
      setLoadingData(false)
    }
  }, [])

  useEffect(() => {
    if (wsId) {
      if (typeof window !== 'undefined') localStorage.setItem(WS_KEY, wsId)
      setDeliveriesFor(null)
      loadHooks(wsId)
    }
  }, [wsId, loadHooks])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }
  const openEdit = (h: Webhook) => {
    setEditing(h)
    setForm({
      url: h.url ?? '',
      events: Array.isArray(h.events) ? h.events : [],
      secret: h.secret ?? '',
      is_active: h.is_active ?? true,
    })
    setFormError(null)
    setModalOpen(true)
  }

  const toggleEvent = (ev: string) => {
    setForm((f) => ({
      ...f,
      events: f.events.includes(ev) ? f.events.filter((e) => e !== ev) : [...f.events, ev],
    }))
  }

  const submitForm = async () => {
    setFormError(null)
    const url = form.url.trim()
    if (!url) { setFormError('URL is required'); return }
    try {
      // eslint-disable-next-line no-new
      new URL(url)
    } catch {
      setFormError('Enter a valid URL (including https://)')
      return
    }
    if (form.events.length === 0) { setFormError('Select at least one event'); return }

    setSaving(true)
    try {
      if (editing) {
        const updated: Webhook = await api.updateWebhook(editing.id, {
          url,
          events: form.events,
          secret: form.secret || undefined,
          is_active: form.is_active,
        })
        setHooks((prev) => prev.map((h) => (h.id === editing.id ? { ...h, ...updated } : h)))
        setNotice('Webhook updated')
      } else {
        const created: Webhook = await api.createWebhook({
          workspace_id: wsId,
          url,
          events: form.events,
          secret: form.secret || undefined,
          is_active: form.is_active,
        })
        setHooks((prev) => [created, ...prev])
        setNotice('Webhook created')
      }
      setModalOpen(false)
    } catch (e: any) {
      setFormError(e?.message ?? 'Failed to save webhook')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (h: Webhook) => {
    setBusyId(h.id)
    setError(null)
    const next = !h.is_active
    setHooks((prev) => prev.map((x) => (x.id === h.id ? { ...x, is_active: next } : x)))
    try {
      await api.updateWebhook(h.id, { is_active: next })
    } catch (e: any) {
      setError(e?.message ?? 'Failed to update')
      setHooks((prev) => prev.map((x) => (x.id === h.id ? { ...x, is_active: h.is_active } : x)))
    } finally {
      setBusyId(null)
    }
  }

  const testFire = async (h: Webhook) => {
    setBusyId(h.id)
    setError(null)
    setNotice(null)
    try {
      const delivery: WebhookDelivery = await api.testWebhook(h.id)
      setNotice(
        delivery?.success
          ? `Test fired to ${h.url} (HTTP ${delivery.status_code ?? '—'})`
          : `Test delivery failed${delivery?.error ? `: ${delivery.error}` : ` (HTTP ${delivery?.status_code ?? '—'})`}`
      )
      if (deliveriesFor?.id === h.id) {
        setDeliveries((prev) => [delivery, ...prev])
      }
    } catch (e: any) {
      setError(e?.message ?? 'Test-fire failed')
    } finally {
      setBusyId(null)
    }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    setError(null)
    try {
      await api.deleteWebhook(confirmDelete.id)
      setHooks((prev) => prev.filter((h) => h.id !== confirmDelete.id))
      if (deliveriesFor?.id === confirmDelete.id) setDeliveriesFor(null)
      setNotice('Webhook deleted')
      setConfirmDelete(null)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete')
    } finally {
      setDeleting(false)
    }
  }

  const viewDeliveries = useCallback(async (h: Webhook) => {
    setDeliveriesFor(h)
    setLoadingDeliveries(true)
    setDeliveries([])
    try {
      const list: WebhookDelivery[] = await api.listWebhookDeliveries(h.id)
      setDeliveries(Array.isArray(list) ? list : [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load deliveries')
    } finally {
      setLoadingDeliveries(false)
    }
  }, [])

  const sortedDeliveries = useMemo(
    () => [...deliveries].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()),
    [deliveries]
  )

  if (loading) {
    return <div className="py-20"><Spinner label="Loading webhooks..." /></div>
  }

  if (workspaces.length === 0) {
    return (
      <EmptyState
        title="No workspace yet"
        description="Create a workspace from the dashboard before configuring webhooks."
        icon="🪝"
        action={<a href="/dashboard"><Button>Go to dashboard</Button></a>}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Webhooks</h1>
          <p className="text-sm text-neutral-500">Stream audit events to external endpoints.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={wsId}
            onChange={(e) => setWsId(e.target.value)}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:border-red-500 focus:outline-none"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => loadHooks(wsId)} disabled={loadingData}>
            {loadingData ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button onClick={openCreate}>New webhook</Button>
        </div>
      </div>

      {notice && (
        <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-red-400/70 hover:text-red-200">✕</button>
        </div>
      )}
      {error && (
        <div className="flex items-center justify-between rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400/70 hover:text-rose-200">✕</button>
        </div>
      )}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Endpoints</h2>
          <Badge tone="info">{hooks.length}</Badge>
        </CardHeader>
        <CardBody className="p-0">
          {loadingData && hooks.length === 0 ? (
            <div className="py-16"><Spinner label="Loading…" /></div>
          ) : hooks.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No webhooks configured"
                description="Add an endpoint to receive POSTs when uploads parse, qualification runs, or downgrades are detected."
                icon="🪝"
                action={<Button onClick={openCreate}>New webhook</Button>}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Endpoint</TH>
                  <TH>Events</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {hooks.map((h) => (
                  <TR key={h.id}>
                    <TD>
                      <div className="max-w-xs truncate font-mono text-xs text-neutral-200">{h.url}</div>
                      <div className="mt-0.5 text-xs text-neutral-600">Added {fmtTime(h.created_at)}</div>
                    </TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {(h.events && h.events.length > 0)
                          ? h.events.map((ev) => <Badge key={ev} tone="neutral">{ev}</Badge>)
                          : <span className="text-xs text-neutral-600">none</span>}
                      </div>
                    </TD>
                    <TD>
                      <button onClick={() => toggleActive(h)} disabled={busyId === h.id} className="disabled:opacity-50">
                        <Badge tone={h.is_active ? 'success' : 'neutral'}>
                          {h.is_active ? '● Active' : '○ Paused'}
                        </Badge>
                      </button>
                    </TD>
                    <TD>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" className="text-xs" onClick={() => testFire(h)} disabled={busyId === h.id}>
                          {busyId === h.id ? '…' : 'Test'}
                        </Button>
                        <Button variant="ghost" className="text-xs" onClick={() => viewDeliveries(h)}>
                          Log
                        </Button>
                        <Button variant="ghost" className="text-xs" onClick={() => openEdit(h)}>
                          Edit
                        </Button>
                        <Button variant="ghost" className="text-xs text-rose-400 hover:text-rose-300" onClick={() => setConfirmDelete(h)}>
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

      {deliveriesFor && (
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-white">Delivery log</h2>
              <p className="truncate font-mono text-xs text-neutral-500">{deliveriesFor.url}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" className="text-xs" onClick={() => viewDeliveries(deliveriesFor)} disabled={loadingDeliveries}>
                {loadingDeliveries ? 'Refreshing…' : 'Refresh'}
              </Button>
              <Button variant="ghost" className="text-xs" onClick={() => setDeliveriesFor(null)}>Close</Button>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {loadingDeliveries ? (
              <div className="py-12"><Spinner label="Loading deliveries…" /></div>
            ) : sortedDeliveries.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="No deliveries yet"
                  description="Fire a test or trigger an event to populate the delivery log."
                  icon="📜"
                  action={<Button className="text-xs" onClick={() => testFire(deliveriesFor)} disabled={busyId === deliveriesFor.id}>Test-fire now</Button>}
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>When</TH>
                    <TH>Event</TH>
                    <TH>Result</TH>
                    <TH>HTTP</TH>
                    <TH>Detail</TH>
                  </TR>
                </THead>
                <TBody>
                  {sortedDeliveries.map((d) => (
                    <TR key={d.id}>
                      <TD className="whitespace-nowrap text-xs text-neutral-400">{fmtTime(d.created_at)}</TD>
                      <TD><span className="font-mono text-xs text-neutral-300">{d.event || '—'}</span></TD>
                      <TD>
                        <Badge tone={d.success ? 'success' : 'danger'}>{d.success ? 'Delivered' : 'Failed'}</Badge>
                      </TD>
                      <TD className="tabular-nums text-neutral-300">{d.status_code ?? '—'}</TD>
                      <TD className="max-w-xs truncate text-xs text-neutral-500">
                        {d.error ? d.error : (d.payload ? JSON.stringify(d.payload).slice(0, 80) : '—')}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit webhook' : 'New webhook'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={submitForm} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create webhook'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{formError}</div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Endpoint URL</label>
            <input
              type="url"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://example.com/webhooks/ila"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-red-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Signing secret (optional)</label>
            <input
              type="text"
              value={form.secret}
              onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
              placeholder="whsec_…"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-red-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-neutral-600">Used to sign the payload so receivers can verify authenticity.</p>
          </div>
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-500">Events</label>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {EVENT_OPTIONS.map((ev) => (
                <label
                  key={ev}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    form.events.includes(ev)
                      ? 'border-red-500/40 bg-red-500/10 text-red-300'
                      : 'border-neutral-700 bg-neutral-950 text-neutral-400 hover:border-neutral-600'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={form.events.includes(ev)}
                    onChange={() => toggleEvent(ev)}
                    className="accent-red-500"
                  />
                  <span className="font-mono text-xs">{ev}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="accent-red-500"
            />
            Active (deliver events immediately)
          </label>
        </div>
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete webhook"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)} disabled={deleting}>Cancel</Button>
            <Button variant="danger" onClick={doDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</Button>
          </>
        }
      >
        <p className="text-sm text-neutral-400">
          Delete the webhook for{' '}
          <span className="font-mono text-neutral-200">{confirmDelete?.url}</span>? Its delivery history will be removed. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
