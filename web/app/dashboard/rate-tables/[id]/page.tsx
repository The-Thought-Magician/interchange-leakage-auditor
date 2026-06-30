'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
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

type Category = {
  id: string
  version_id: string
  brand: string
  code: string
  name: string
  card_product: string | null
  mcc_set: string[] | null
  percent_rate: number | null
  per_item_cents: number | null
  requires_level2: boolean
  requires_level3: boolean
  requires_avs: boolean
  requires_card_present: boolean
  max_settlement_hours: number | null
  tier_rank: number | null
  notes: string | null
  created_at: string
}

type CatForm = {
  code: string
  name: string
  card_product: string
  mcc_set: string
  percent_rate: string
  per_item_cents: string
  requires_level2: boolean
  requires_level3: boolean
  requires_avs: boolean
  requires_card_present: boolean
  max_settlement_hours: string
  tier_rank: string
  notes: string
}

const EMPTY_CAT: CatForm = {
  code: '',
  name: '',
  card_product: '',
  mcc_set: '',
  percent_rate: '',
  per_item_cents: '',
  requires_level2: false,
  requires_level3: false,
  requires_avs: false,
  requires_card_present: false,
  max_settlement_hours: '',
  tier_rank: '',
  notes: '',
}

function parseMccSet(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export default function RateTableVersionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [version, setVersion] = useState<RateTableVersion | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // version-meta edit
  const [metaOpen, setMetaOpen] = useState(false)
  const [metaForm, setMetaForm] = useState({ name: '', brand: '', effective_date: '', source_note: '' })
  const [metaSaving, setMetaSaving] = useState(false)
  const [metaError, setMetaError] = useState<string | null>(null)

  // category filters
  const [search, setSearch] = useState('')
  const [productFilter, setProductFilter] = useState('')

  // category create/edit
  const [catOpen, setCatOpen] = useState(false)
  const [editingCat, setEditingCat] = useState<Category | null>(null)
  const [catForm, setCatForm] = useState<CatForm>(EMPTY_CAT)
  const [catSaving, setCatSaving] = useState(false)
  const [catError, setCatError] = useState<string | null>(null)

  const [deletingCat, setDeletingCat] = useState<Category | null>(null)
  const [delBusy, setDelBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getRateTable(id)
      const v: RateTableVersion = data?.version ?? data
      const cats: Category[] = data?.categories ?? []
      setVersion(v ?? null)
      setCategories(Array.isArray(cats) ? cats : [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load rate table version')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const products = useMemo(() => {
    const set = new Set<string>()
    categories.forEach((c) => {
      if (c.card_product) set.add(c.card_product)
    })
    return Array.from(set).sort()
  }, [categories])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return categories
      .filter((c) => {
        if (productFilter) {
          if (productFilter === '__none__') {
            if (c.card_product) return false
          } else if (c.card_product !== productFilter) {
            return false
          }
        }
        if (!q) return true
        return (
          c.code.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          (c.card_product ?? '').toLowerCase().includes(q) ||
          (c.mcc_set ?? []).some((m) => m.toLowerCase().includes(q))
        )
      })
      .sort((a, b) => (a.tier_rank ?? 9999) - (b.tier_rank ?? 9999))
  }, [categories, search, productFilter])

  const stats = useMemo(() => {
    const count = categories.length
    const rates = categories.map((c) => c.percent_rate ?? 0).filter((r) => r > 0)
    const minRate = rates.length ? Math.min(...rates) : 0
    const reqCount = categories.filter(
      (c) => c.requires_level2 || c.requires_level3 || c.requires_avs || c.requires_card_present,
    ).length
    return { count, minRate, reqCount }
  }, [categories])

  // version meta
  function openMeta() {
    if (!version) return
    setMetaForm({
      name: version.name ?? '',
      brand: version.brand ?? '',
      effective_date: version.effective_date ? version.effective_date.slice(0, 10) : '',
      source_note: version.source_note ?? '',
    })
    setMetaError(null)
    setMetaOpen(true)
  }

  async function saveMeta() {
    if (!version) return
    if (!metaForm.name.trim()) {
      setMetaError('Name is required')
      return
    }
    setMetaSaving(true)
    setMetaError(null)
    try {
      await api.updateRateTable(version.id, {
        name: metaForm.name.trim(),
        brand: metaForm.brand.trim() || version.brand,
        effective_date: metaForm.effective_date ? new Date(metaForm.effective_date).toISOString() : null,
        source_note: metaForm.source_note.trim() || null,
      })
      setMetaOpen(false)
      await load()
    } catch (e: any) {
      setMetaError(e?.message ?? 'Save failed')
    } finally {
      setMetaSaving(false)
    }
  }

  // category form
  function openCreateCat() {
    setEditingCat(null)
    setCatForm(EMPTY_CAT)
    setCatError(null)
    setCatOpen(true)
  }

  function openEditCat(c: Category) {
    setEditingCat(c)
    setCatForm({
      code: c.code ?? '',
      name: c.name ?? '',
      card_product: c.card_product ?? '',
      mcc_set: (c.mcc_set ?? []).join(', '),
      percent_rate: c.percent_rate != null ? String(c.percent_rate) : '',
      per_item_cents: c.per_item_cents != null ? String(c.per_item_cents) : '',
      requires_level2: !!c.requires_level2,
      requires_level3: !!c.requires_level3,
      requires_avs: !!c.requires_avs,
      requires_card_present: !!c.requires_card_present,
      max_settlement_hours: c.max_settlement_hours != null ? String(c.max_settlement_hours) : '',
      tier_rank: c.tier_rank != null ? String(c.tier_rank) : '',
      notes: c.notes ?? '',
    })
    setCatError(null)
    setCatOpen(true)
  }

  async function saveCat() {
    if (!version) return
    if (!catForm.code.trim() || !catForm.name.trim()) {
      setCatError('Code and name are required')
      return
    }
    setCatSaving(true)
    setCatError(null)
    const body: Record<string, any> = {
      version_id: version.id,
      brand: version.brand,
      code: catForm.code.trim(),
      name: catForm.name.trim(),
      card_product: catForm.card_product.trim() || null,
      mcc_set: parseMccSet(catForm.mcc_set),
      percent_rate: catForm.percent_rate === '' ? null : Number(catForm.percent_rate),
      per_item_cents: catForm.per_item_cents === '' ? null : Math.round(Number(catForm.per_item_cents)),
      requires_level2: catForm.requires_level2,
      requires_level3: catForm.requires_level3,
      requires_avs: catForm.requires_avs,
      requires_card_present: catForm.requires_card_present,
      max_settlement_hours: catForm.max_settlement_hours === '' ? null : Math.round(Number(catForm.max_settlement_hours)),
      tier_rank: catForm.tier_rank === '' ? null : Math.round(Number(catForm.tier_rank)),
      notes: catForm.notes.trim() || null,
    }
    try {
      if (editingCat) {
        await api.updateCategory(editingCat.id, body)
      } else {
        await api.createCategory(body)
      }
      setCatOpen(false)
      await load()
    } catch (e: any) {
      setCatError(e?.message ?? 'Save failed')
    } finally {
      setCatSaving(false)
    }
  }

  async function confirmDeleteCat() {
    if (!deletingCat) return
    setDelBusy(true)
    try {
      await api.deleteCategory(deletingCat.id)
      setDeletingCat(null)
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Delete failed')
    } finally {
      setDelBusy(false)
    }
  }

  function reqBadges(c: Category) {
    const items: { label: string; on: boolean }[] = [
      { label: 'L2', on: c.requires_level2 },
      { label: 'L3', on: c.requires_level3 },
      { label: 'AVS', on: c.requires_avs },
      { label: 'CP', on: c.requires_card_present },
    ]
    const active = items.filter((i) => i.on)
    if (active.length === 0 && c.max_settlement_hours == null) {
      return <span className="text-xs text-slate-600">none</span>
    }
    return (
      <div className="flex flex-wrap gap-1">
        {active.map((i) => (
          <Badge key={i.label} tone="info">
            {i.label}
          </Badge>
        ))}
        {c.max_settlement_hours != null && <Badge tone="warning">≤{c.max_settlement_hours}h</Badge>}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-12">
        <Spinner label="Loading rate table version…" />
      </div>
    )
  }

  if (error && !version) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/rate-tables" className="text-sm text-emerald-400 hover:underline">
          ← Back to rate tables
        </Link>
        <EmptyState
          title="Could not load version"
          description={error}
          action={
            <Button variant="secondary" onClick={load}>
              Retry
            </Button>
          }
        />
      </div>
    )
  }

  if (!version) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/rate-tables" className="text-sm text-emerald-400 hover:underline">
          ← Back to rate tables
        </Link>
        <EmptyState title="Version not found" description="This rate table version may have been deleted." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/rate-tables" className="text-sm text-emerald-400 hover:underline">
          ← Back to rate tables
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{version.name}</h1>
            {version.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            <span className="font-medium text-slate-400">{version.brand}</span>
            {version.effective_date && (
              <> · effective {new Date(version.effective_date).toLocaleDateString()}</>
            )}
            {version.source_note && <> · {version.source_note}</>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={openMeta}>
            Edit Version
          </Button>
          <Button onClick={openCreateCat}>+ Add Category</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Categories" value={stats.count} />
        <Stat
          label="Best Rate"
          value={stats.minRate ? `${stats.minRate.toFixed(2)}%` : '—'}
          hint="Lowest percent rate in this version"
          tone="success"
        />
        <Stat
          label="With Requirements"
          value={stats.reqCount}
          hint="Categories gated on L2/L3/AVS/CP"
          tone="warning"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, name, MCC…"
              className="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
            />
            <select
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">All products</option>
              <option value="__none__">No product</option>
              {products.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            {(search || productFilter) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch('')
                  setProductFilter('')
                }}
              >
                Clear
              </Button>
            )}
          </div>
          <span className="text-xs text-slate-500">
            {filtered.length} of {categories.length}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={categories.length === 0 ? 'No interchange categories yet' : 'No matches'}
                description={
                  categories.length === 0
                    ? 'Add categories so the qualification engine can find the optimal rate per transaction.'
                    : 'Try a different search or filter.'
                }
                action={
                  categories.length === 0 ? (
                    <Button onClick={openCreateCat}>+ Add Category</Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="text-right">Tier</TH>
                  <TH>Code</TH>
                  <TH>Name</TH>
                  <TH>Product</TH>
                  <TH className="text-right">Rate</TH>
                  <TH className="text-right">Per Item</TH>
                  <TH>MCCs</TH>
                  <TH>Requirements</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((c) => (
                  <TR key={c.id}>
                    <TD className="text-right tabular-nums text-slate-500">{c.tier_rank ?? '—'}</TD>
                    <TD className="font-mono text-xs text-white">{c.code}</TD>
                    <TD className="text-slate-300">{c.name}</TD>
                    <TD className="text-slate-400">{c.card_product || '—'}</TD>
                    <TD className="text-right tabular-nums text-emerald-400">
                      {c.percent_rate != null ? `${c.percent_rate.toFixed(2)}%` : '—'}
                    </TD>
                    <TD className="text-right tabular-nums text-slate-400">
                      {c.per_item_cents != null ? `${c.per_item_cents}¢` : '—'}
                    </TD>
                    <TD className="max-w-[10rem] truncate font-mono text-xs text-slate-500">
                      {c.mcc_set && c.mcc_set.length ? c.mcc_set.join(', ') : 'any'}
                    </TD>
                    <TD>{reqBadges(c)}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" onClick={() => openEditCat(c)}>
                          Edit
                        </Button>
                        <Button variant="danger" onClick={() => setDeletingCat(c)}>
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

      {/* Version meta modal */}
      <Modal
        open={metaOpen}
        onClose={() => !metaSaving && setMetaOpen(false)}
        title="Edit Version"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMetaOpen(false)} disabled={metaSaving}>
              Cancel
            </Button>
            <Button onClick={saveMeta} disabled={metaSaving}>
              {metaSaving ? 'Saving…' : 'Save Changes'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {metaError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
              {metaError}
            </div>
          )}
          <Field label="Name">
            <input
              value={metaForm.name}
              onChange={(e) => setMetaForm({ ...metaForm, name: e.target.value })}
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Brand">
              <input
                value={metaForm.brand}
                onChange={(e) => setMetaForm({ ...metaForm, brand: e.target.value })}
                placeholder="visa / mastercard / amex"
                className={inputCls}
              />
            </Field>
            <Field label="Effective Date">
              <input
                type="date"
                value={metaForm.effective_date}
                onChange={(e) => setMetaForm({ ...metaForm, effective_date: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Source Note">
            <textarea
              value={metaForm.source_note}
              onChange={(e) => setMetaForm({ ...metaForm, source_note: e.target.value })}
              rows={2}
              className={inputCls}
            />
          </Field>
        </div>
      </Modal>

      {/* Category modal */}
      <Modal
        open={catOpen}
        onClose={() => !catSaving && setCatOpen(false)}
        title={editingCat ? 'Edit Category' : 'Add Category'}
        className="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCatOpen(false)} disabled={catSaving}>
              Cancel
            </Button>
            <Button onClick={saveCat} disabled={catSaving}>
              {catSaving ? 'Saving…' : editingCat ? 'Save Changes' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {catError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
              {catError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code">
              <input
                value={catForm.code}
                onChange={(e) => setCatForm({ ...catForm, code: e.target.value })}
                placeholder="e.g. CPS_RETAIL"
                className={inputCls}
              />
            </Field>
            <Field label="Tier Rank">
              <input
                type="number"
                step="1"
                value={catForm.tier_rank}
                onChange={(e) => setCatForm({ ...catForm, tier_rank: e.target.value })}
                placeholder="lower = better"
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Name">
            <input
              value={catForm.name}
              onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
              placeholder="e.g. CPS / Retail"
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Card Product">
              <input
                value={catForm.card_product}
                onChange={(e) => setCatForm({ ...catForm, card_product: e.target.value })}
                placeholder="e.g. credit, debit (blank = any)"
                className={inputCls}
              />
            </Field>
            <Field label="MCC Set">
              <input
                value={catForm.mcc_set}
                onChange={(e) => setCatForm({ ...catForm, mcc_set: e.target.value })}
                placeholder="comma list, blank = any"
                className={inputCls}
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Percent Rate (%)">
              <input
                type="number"
                step="0.01"
                value={catForm.percent_rate}
                onChange={(e) => setCatForm({ ...catForm, percent_rate: e.target.value })}
                placeholder="1.65"
                className={inputCls}
              />
            </Field>
            <Field label="Per Item (cents)">
              <input
                type="number"
                step="1"
                value={catForm.per_item_cents}
                onChange={(e) => setCatForm({ ...catForm, per_item_cents: e.target.value })}
                placeholder="10"
                className={inputCls}
              />
            </Field>
            <Field label="Max Settlement (h)">
              <input
                type="number"
                step="1"
                value={catForm.max_settlement_hours}
                onChange={(e) => setCatForm({ ...catForm, max_settlement_hours: e.target.value })}
                placeholder="e.g. 24"
                className={inputCls}
              />
            </Field>
          </div>
          <div>
            <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Requirements
            </span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Check
                label="Level 2"
                checked={catForm.requires_level2}
                onChange={(v) => setCatForm({ ...catForm, requires_level2: v })}
              />
              <Check
                label="Level 3"
                checked={catForm.requires_level3}
                onChange={(v) => setCatForm({ ...catForm, requires_level3: v })}
              />
              <Check
                label="AVS"
                checked={catForm.requires_avs}
                onChange={(v) => setCatForm({ ...catForm, requires_avs: v })}
              />
              <Check
                label="Card Present"
                checked={catForm.requires_card_present}
                onChange={(v) => setCatForm({ ...catForm, requires_card_present: v })}
              />
            </div>
          </div>
          <Field label="Notes">
            <textarea
              value={catForm.notes}
              onChange={(e) => setCatForm({ ...catForm, notes: e.target.value })}
              rows={2}
              className={inputCls}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!deletingCat}
        onClose={() => !delBusy && setDeletingCat(null)}
        title="Delete Category"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeletingCat(null)} disabled={delBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDeleteCat} disabled={delBusy}>
              {delBusy ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Delete category{' '}
          <span className="font-mono font-semibold text-white">{deletingCat?.code}</span>? This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  )
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300 hover:border-slate-600">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-emerald-500"
      />
      {label}
    </label>
  )
}
