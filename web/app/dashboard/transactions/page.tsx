'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import RightRail from '@/components/RightRail'

type Transaction = {
  id: string
  external_ref: string | null
  amount_cents: number
  currency: string | null
  mcc: string | null
  card_brand: string | null
  card_product: string | null
  entry_mode: string | null
  billed_category_code: string | null
  billed_fee_cents: number | null
  billed_percent_rate: number | null
  auth_timestamp: string | null
  settlement_timestamp: string | null
  has_avs: boolean | null
  has_cvv: boolean | null
  has_level2: boolean | null
  has_level3: boolean | null
  tags: string[] | null
  processor_id: string | null
  batch_id: string | null
}

type Tag = { id: string; name: string; color: string | null }
type Processor = { id: string; name: string; mid: string | null }
type SavedFilter = { id: string; name: string; query: FilterState; is_shared: boolean }

type FilterState = {
  q: string
  brand: string
  product: string
  mcc: string
  processor_id: string
  downgrade_only: boolean
  from: string
  to: string
}

const EMPTY_FILTER: FilterState = {
  q: '',
  brand: '',
  product: '',
  mcc: '',
  processor_id: '',
  downgrade_only: false,
  from: '',
  to: '',
}

const WS_KEY = 'ila_workspace_id'

function fmtMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  const sign = cents < 0 ? '-' : ''
  const v = Math.abs(cents) / 100
  return `${sign}$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(ts: string | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function brandTone(brand: string | null): 'info' | 'warning' | 'neutral' {
  const b = (brand || '').toLowerCase()
  if (b.includes('visa')) return 'info'
  if (b.includes('master') || b.includes('mc')) return 'warning'
  return 'neutral'
}

export default function TransactionsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [txns, setTxns] = useState<Transaction[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [processors, setProcessors] = useState<Processor[]>([])
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([])

  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER)
  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTER)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveShared, setSaveShared] = useState(false)
  const [bulkTag, setBulkTag] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  // Resolve workspace
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const stored = typeof window !== 'undefined' ? localStorage.getItem(WS_KEY) : null
        if (stored) {
          if (active) setWorkspaceId(stored)
          return
        }
        const ws = await api.listWorkspaces()
        const first = Array.isArray(ws) && ws.length ? ws[0].id : null
        if (active) {
          if (first && typeof window !== 'undefined') localStorage.setItem(WS_KEY, first)
          setWorkspaceId(first)
          if (!first) setLoading(false)
        }
      } catch (e: any) {
        if (active) {
          setError(e?.message || 'Failed to resolve workspace')
          setLoading(false)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const loadTxns = useCallback(
    async (ws: string, f: FilterState, isRefresh: boolean) => {
      if (isRefresh) setRefreshing(true)
      else setLoading(true)
      setError(null)
      try {
        const list = await api.listTransactions({
          workspace_id: ws,
          q: f.q || undefined,
          brand: f.brand || undefined,
          product: f.product || undefined,
          mcc: f.mcc || undefined,
          processor_id: f.processor_id || undefined,
          downgrade_only: f.downgrade_only || undefined,
          from: f.from || undefined,
          to: f.to || undefined,
        })
        setTxns(Array.isArray(list) ? list : [])
        setSelected(new Set())
      } catch (e: any) {
        setError(e?.message || 'Failed to load transactions')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [],
  )

  // Initial reference data + transactions once workspace known
  useEffect(() => {
    if (!workspaceId) return
    let active = true
    ;(async () => {
      try {
        const [tg, pr, sf] = await Promise.all([
          api.listTags(workspaceId).catch(() => []),
          api.listProcessors(workspaceId).catch(() => []),
          api.listSavedFilters(workspaceId).catch(() => []),
        ])
        if (!active) return
        setTags(Array.isArray(tg) ? tg : [])
        setProcessors(Array.isArray(pr) ? pr : [])
        setSavedFilters(Array.isArray(sf) ? sf : [])
      } catch {
        /* reference data is best-effort */
      }
    })()
    loadTxns(workspaceId, EMPTY_FILTER, false)
    return () => {
      active = false
    }
  }, [workspaceId, loadTxns])

  const applyFilters = () => {
    if (!workspaceId) return
    setFilter(draft)
    loadTxns(workspaceId, draft, true)
  }

  const resetFilters = () => {
    setDraft(EMPTY_FILTER)
    setFilter(EMPTY_FILTER)
    if (workspaceId) loadTxns(workspaceId, EMPTY_FILTER, true)
  }

  const applySaved = (sf: SavedFilter) => {
    const merged = { ...EMPTY_FILTER, ...(sf.query || {}) }
    setDraft(merged)
    setFilter(merged)
    if (workspaceId) loadTxns(workspaceId, merged, true)
  }

  const reloadSavedFilters = async () => {
    if (!workspaceId) return
    try {
      const sf = await api.listSavedFilters(workspaceId)
      setSavedFilters(Array.isArray(sf) ? sf : [])
    } catch {
      /* ignore */
    }
  }

  const saveCurrentFilter = async () => {
    if (!workspaceId || !saveName.trim()) return
    try {
      await api.createSavedFilter({
        workspace_id: workspaceId,
        name: saveName.trim(),
        query: draft,
        is_shared: saveShared,
      })
      setSaveOpen(false)
      setSaveName('')
      setSaveShared(false)
      setActionMsg('Filter saved')
      await reloadSavedFilters()
    } catch (e: any) {
      setActionMsg(e?.message || 'Failed to save filter')
    }
  }

  const deleteSaved = async (id: string) => {
    try {
      await api.deleteSavedFilter(id)
      await reloadSavedFilters()
    } catch (e: any) {
      setActionMsg(e?.message || 'Failed to delete filter')
    }
  }

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelected((prev) => {
      if (prev.size === txns.length) return new Set()
      return new Set(txns.map((t) => t.id))
    })
  }

  const runBulkTag = async (mode: 'add' | 'remove') => {
    if (!bulkTag.trim() || selected.size === 0) return
    setBulkBusy(true)
    setActionMsg(null)
    try {
      const res = await api.bulkTagTransactions({
        ids: Array.from(selected),
        tag: bulkTag.trim(),
        mode,
      })
      setActionMsg(`${mode === 'add' ? 'Tagged' : 'Untagged'} ${res?.updated ?? selected.size} transactions`)
      if (workspaceId) await loadTxns(workspaceId, filter, true)
    } catch (e: any) {
      setActionMsg(e?.message || 'Bulk tag failed')
    } finally {
      setBulkBusy(false)
    }
  }

  const runBulkDelete = async () => {
    if (selected.size === 0) return
    if (!confirm(`Delete ${selected.size} transaction(s)? This also removes their qualification results.`)) return
    setBulkBusy(true)
    setActionMsg(null)
    try {
      const res = await api.bulkDeleteTransactions({ ids: Array.from(selected) })
      setActionMsg(`Deleted ${res?.deleted ?? selected.size} transactions`)
      if (workspaceId) await loadTxns(workspaceId, filter, true)
    } catch (e: any) {
      setActionMsg(e?.message || 'Bulk delete failed')
    } finally {
      setBulkBusy(false)
    }
  }

  const totals = useMemo(() => {
    const amount = txns.reduce((a, t) => a + (t.amount_cents || 0), 0)
    const billed = txns.reduce((a, t) => a + (t.billed_fee_cents || 0), 0)
    const tagged = txns.filter((t) => Array.isArray(t.tags) && t.tags.length > 0).length
    return { amount, billed, count: txns.length, tagged }
  }, [txns])

  const allSelected = txns.length > 0 && selected.size === txns.length

  if (loading && !refreshing) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner label="Loading transactions…" />
      </div>
    )
  }

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-2xl py-16">
        <EmptyState
          title="No workspace yet"
          description="Create or seed a workspace from the dashboard, then return to explore transactions."
          action={
            <Link href="/dashboard">
              <Button>Go to dashboard</Button>
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
    <div className="min-w-0 flex-1 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Transactions</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Explore settled transactions, filter by brand, product, MCC and downgrade status, then tag or remove in bulk.
          </p>
        </div>
        <Button variant="secondary" onClick={() => workspaceId && loadTxns(workspaceId, filter, true)} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Transactions" value={totals.count.toLocaleString()} />
        <Stat label="Total volume" value={fmtMoney(totals.amount)} />
        <Stat label="Billed fees" value={fmtMoney(totals.billed)} tone="warning" />
        <Stat label="Tagged" value={totals.tagged.toLocaleString()} hint={`${tags.length} tags defined`} />
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-neutral-200">Filters</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={resetFilters}>
              Reset
            </Button>
            <Button variant="secondary" onClick={() => setSaveOpen(true)}>
              Save filter
            </Button>
            <Button onClick={applyFilters} disabled={refreshing}>
              Apply
            </Button>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              Search (ref / category)
              <input
                value={draft.q}
                onChange={(e) => setDraft({ ...draft, q: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                placeholder="external ref or category code"
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-red-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              Card brand
              <input
                value={draft.brand}
                onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
                placeholder="Visa, Mastercard…"
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-red-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              Card product
              <input
                value={draft.product}
                onChange={(e) => setDraft({ ...draft, product: e.target.value })}
                placeholder="Corporate, Rewards…"
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-red-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              MCC
              <input
                value={draft.mcc}
                onChange={(e) => setDraft({ ...draft, mcc: e.target.value })}
                placeholder="5411"
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-red-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              Processor
              <select
                value={draft.processor_id}
                onChange={(e) => setDraft({ ...draft, processor_id: e.target.value })}
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-red-500 focus:outline-none"
              >
                <option value="">All processors</option>
                {processors.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              From
              <input
                type="date"
                value={draft.from}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-red-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              To
              <input
                type="date"
                value={draft.to}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-red-500 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={draft.downgrade_only}
                onChange={(e) => setDraft({ ...draft, downgrade_only: e.target.checked })}
                className="h-4 w-4 rounded border-neutral-600 bg-neutral-950 text-red-500 focus:ring-red-500"
              />
              Downgrades only
            </label>
          </div>

          {savedFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-3">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Saved</span>
              {savedFilters.map((sf) => (
                <span key={sf.id} className="inline-flex items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-900 pl-2 pr-1 py-1">
                  <button onClick={() => applySaved(sf)} className="text-xs font-medium text-neutral-200 hover:text-red-400">
                    {sf.name}
                  </button>
                  {sf.is_shared && <Badge tone="info">shared</Badge>}
                  <button
                    onClick={() => deleteSaved(sf.id)}
                    aria-label="Delete saved filter"
                    className="ml-0.5 px-1 text-neutral-600 hover:text-rose-400"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {actionMsg && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">{actionMsg}</div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <Card className="border-red-500/30">
          <CardBody className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-red-300">{selected.size} selected</span>
            <input
              list="ila-tag-list"
              value={bulkTag}
              onChange={(e) => setBulkTag(e.target.value)}
              placeholder="tag name"
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-red-500 focus:outline-none"
            />
            <datalist id="ila-tag-list">
              {tags.map((t) => (
                <option key={t.id} value={t.name} />
              ))}
            </datalist>
            <Button variant="secondary" onClick={() => runBulkTag('add')} disabled={bulkBusy || !bulkTag.trim()}>
              Add tag
            </Button>
            <Button variant="ghost" onClick={() => runBulkTag('remove')} disabled={bulkBusy || !bulkTag.trim()}>
              Remove tag
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              <Button variant="danger" onClick={runBulkDelete} disabled={bulkBusy}>
                Delete
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Table */}
      {error ? (
        <EmptyState
          title="Could not load transactions"
          description={error}
          action={
            <Button variant="secondary" onClick={() => workspaceId && loadTxns(workspaceId, filter, true)}>
              Retry
            </Button>
          }
        />
      ) : txns.length === 0 ? (
        <EmptyState
          title="No transactions match"
          description="Adjust your filters, or upload a settlement batch from the Uploads page to populate transactions."
          action={
            <Link href="/dashboard/uploads">
              <Button>Go to uploads</Button>
            </Link>
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH className="w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-neutral-600 bg-neutral-950 text-red-500 focus:ring-red-500"
                  aria-label="Select all"
                />
              </TH>
              <TH>Reference</TH>
              <TH>Brand / Product</TH>
              <TH>MCC</TH>
              <TH className="text-right">Amount</TH>
              <TH>Billed cat.</TH>
              <TH className="text-right">Billed fee</TH>
              <TH>Flags</TH>
              <TH>Tags</TH>
              <TH>Auth</TH>
            </TR>
          </THead>
          <TBody>
            {txns.map((t) => (
              <TR key={t.id} className={selected.has(t.id) ? 'bg-red-500/5' : undefined}>
                <TD>
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => toggleRow(t.id)}
                    className="h-4 w-4 rounded border-neutral-600 bg-neutral-950 text-red-500 focus:ring-red-500"
                    aria-label={`Select ${t.external_ref || t.id}`}
                  />
                </TD>
                <TD>
                  <Link href={`/dashboard/transactions/${t.id}`} className="font-medium text-red-400 hover:underline">
                    {t.external_ref || t.id.slice(0, 8)}
                  </Link>
                </TD>
                <TD>
                  <div className="flex flex-col gap-1">
                    <Badge tone={brandTone(t.card_brand)}>{t.card_brand || '—'}</Badge>
                    <span className="text-xs text-neutral-500">{t.card_product || '—'}</span>
                  </div>
                </TD>
                <TD className="tabular-nums">{t.mcc || '—'}</TD>
                <TD className="text-right tabular-nums">{fmtMoney(t.amount_cents)}</TD>
                <TD className="font-mono text-xs text-neutral-400">{t.billed_category_code || '—'}</TD>
                <TD className="text-right tabular-nums text-amber-400">{fmtMoney(t.billed_fee_cents)}</TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    {t.has_avs && <Badge tone="neutral">AVS</Badge>}
                    {t.has_level2 && <Badge tone="neutral">L2</Badge>}
                    {t.has_level3 && <Badge tone="neutral">L3</Badge>}
                    {!t.has_avs && !t.has_level2 && !t.has_level3 && <span className="text-xs text-neutral-600">—</span>}
                  </div>
                </TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    {(t.tags || []).map((tag) => (
                      <Badge key={tag} tone="info">
                        {tag}
                      </Badge>
                    ))}
                    {(!t.tags || t.tags.length === 0) && <span className="text-xs text-neutral-600">—</span>}
                  </div>
                </TD>
                <TD className="whitespace-nowrap text-xs text-neutral-500">{fmtDate(t.auth_timestamp)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {/* Save filter modal */}
      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save current filter"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveCurrentFilter} disabled={!saveName.trim()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="flex flex-col gap-1 text-sm text-neutral-300">
            Name
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="e.g. Visa downgrades this month"
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-red-500 focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={saveShared}
              onChange={(e) => setSaveShared(e.target.checked)}
              className="h-4 w-4 rounded border-neutral-600 bg-neutral-950 text-red-500 focus:ring-red-500"
            />
            Share with workspace
          </label>
          <p className="text-xs text-neutral-500">
            Stores the current draft filter values (search, brand, product, MCC, processor, dates, downgrade flag).
          </p>
        </div>
      </Modal>
    </div>
    <RightRail workspaceId={workspaceId} />
    </div>
  )
}
