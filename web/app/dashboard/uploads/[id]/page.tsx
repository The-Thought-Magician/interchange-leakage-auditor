'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type UploadBatch = {
  id: string
  workspace_id: string
  processor_id?: string | null
  filename: string
  source_format?: string
  row_count?: number
  status?: string
  uploaded_by?: string
  error_message?: string | null
  created_at?: string
}

type Transaction = {
  id: string
  external_ref?: string
  amount_cents?: number
  currency?: string
  mcc?: string
  card_brand?: string
  card_product?: string
  entry_mode?: string
  auth_timestamp?: string
  settlement_timestamp?: string
  has_avs?: boolean
  has_cvv?: boolean
  has_level2?: boolean
  has_level3?: boolean
  billed_category_code?: string
  billed_fee_cents?: number
}

type BatchRun = { count?: number; downgrades?: number; recoverable_cents?: number }

function statusTone(status?: string): 'neutral' | 'success' | 'warning' | 'danger' {
  switch ((status || '').toLowerCase()) {
    case 'parsed':
    case 'qualified':
    case 'complete':
    case 'completed':
      return 'success'
    case 'pending':
    case 'parsing':
      return 'warning'
    case 'error':
    case 'failed':
      return 'danger'
    default:
      return 'neutral'
  }
}

function fmtUsd(cents?: number) {
  return ((cents ?? 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function fmtDate(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toLocaleString()
}

function YesNo({ value }: { value?: boolean }) {
  return value ? (
    <span className="text-red-400">✓</span>
  ) : (
    <span className="text-neutral-600">—</span>
  )
}

export default function UploadDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id

  const [batch, setBatch] = useState<UploadBatch | null>(null)
  const [txnCount, setTxnCount] = useState<number>(0)
  const [transactions, setTransactions] = useState<Transaction[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const [parsing, setParsing] = useState(false)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<BatchRun | null>(null)

  const [search, setSearch] = useState('')
  const [brandFilter, setBrandFilter] = useState('all')

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const detail = await api.getUpload(id)
      const b: UploadBatch = detail?.batch ?? detail
      setBatch(b || null)
      setTxnCount(detail?.txnCount ?? 0)
      const wsId = b?.workspace_id
      if (wsId) {
        const txns = await api.listTransactions({ workspace_id: wsId, batch_id: id })
        setTransactions(Array.isArray(txns) ? txns : [])
      } else {
        setTransactions([])
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load batch')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function handleParse() {
    if (!id) return
    setParsing(true)
    setError(null)
    setActionMsg(null)
    try {
      await api.parseUpload(id)
      setActionMsg('Batch re-parsed and transaction flags re-derived.')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed to parse batch')
    } finally {
      setParsing(false)
    }
  }

  async function handleRun() {
    if (!id) return
    setRunning(true)
    setError(null)
    setActionMsg(null)
    try {
      const res: BatchRun = await api.runQualificationBatch(id)
      setRunResult(res || {})
      setActionMsg(
        `Qualification complete: ${res?.count ?? 0} scored, ${res?.downgrades ?? 0} downgrades, ${fmtUsd(res?.recoverable_cents)} recoverable.`,
      )
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed to run qualification')
    } finally {
      setRunning(false)
    }
  }

  const brands = useMemo(() => {
    const set = new Set<string>()
    transactions.forEach((t) => t.card_brand && set.add(t.card_brand))
    return Array.from(set).sort()
  }, [transactions])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return transactions.filter((t) => {
      if (brandFilter !== 'all' && (t.card_brand || '') !== brandFilter) return false
      if (!q) return true
      return (
        (t.external_ref || '').toLowerCase().includes(q) ||
        (t.mcc || '').toLowerCase().includes(q) ||
        (t.card_product || '').toLowerCase().includes(q) ||
        (t.billed_category_code || '').toLowerCase().includes(q)
      )
    })
  }, [transactions, search, brandFilter])

  const totals = useMemo(() => {
    let amount = 0
    let billed = 0
    transactions.forEach((t) => {
      amount += t.amount_cents ?? 0
      billed += t.billed_fee_cents ?? 0
    })
    return { amount, billed }
  }, [transactions])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading batch..." />
      </div>
    )
  }

  if (error && !batch) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/uploads" className="text-sm text-red-400 hover:text-red-300">
          ← Back to uploads
        </Link>
        <EmptyState title="Could not load batch" description={error} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/uploads" className="text-sm text-red-400 hover:text-red-300">
          ← Back to uploads
        </Link>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{batch?.filename || 'Batch'}</h1>
            <Badge tone={statusTone(batch?.status)}>{batch?.status || 'unknown'}</Badge>
          </div>
          <p className="mt-1 text-sm text-neutral-400">
            {(batch?.source_format || '').toUpperCase()} · created {fmtDate(batch?.created_at)}
          </p>
          {batch?.error_message && (
            <p className="mt-2 text-sm text-rose-400">{batch.error_message}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={handleParse} disabled={parsing}>
            {parsing ? 'Parsing...' : 'Re-parse'}
          </Button>
          <Button onClick={handleRun} disabled={running}>
            {running ? 'Running...' : 'Run qualification'}
          </Button>
        </div>
      </div>

      {error && batch && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}
      {actionMsg && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {actionMsg}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Transactions" value={(txnCount || transactions.length).toLocaleString()} />
        <Stat label="Total volume" value={fmtUsd(totals.amount)} />
        <Stat label="Total billed fees" value={fmtUsd(totals.billed)} tone="warning" />
        <Stat
          label="Recoverable (last run)"
          value={runResult ? fmtUsd(runResult.recoverable_cents) : '—'}
          hint={runResult ? `${runResult.downgrades ?? 0} downgrades` : 'Run qualification to compute'}
          tone="success"
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold text-white">
              Transactions <span className="text-neutral-500">({transactions.length})</span>
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search ref / MCC / product"
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-200 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <select
                value={brandFilter}
                onChange={(e) => setBrandFilter(e.target.value)}
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-200 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="all">All brands</option>
                {brands.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={transactions.length === 0 ? 'No transactions in this batch' : 'No transactions match your filters'}
                description={
                  transactions.length === 0
                    ? 'Try re-parsing the batch, or check the source statement for valid rows.'
                    : 'Adjust the search box or brand filter.'
                }
                action={
                  transactions.length === 0 ? (
                    <Button variant="secondary" onClick={handleParse} disabled={parsing}>
                      {parsing ? 'Parsing...' : 'Re-parse'}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Ref</TH>
                  <TH>Brand / Product</TH>
                  <TH>MCC</TH>
                  <TH>Entry</TH>
                  <TH className="text-right">Amount</TH>
                  <TH className="text-center">AVS</TH>
                  <TH className="text-center">L2</TH>
                  <TH className="text-center">L3</TH>
                  <TH>Billed cat</TH>
                  <TH className="text-right">Billed fee</TH>
                  <TH className="text-right">Detail</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((t) => (
                  <TR key={t.id}>
                    <TD className="font-mono text-xs text-neutral-200">{t.external_ref || t.id.slice(0, 8)}</TD>
                    <TD>
                      <div className="text-neutral-200">{t.card_brand || '—'}</div>
                      <div className="text-xs text-neutral-500">{t.card_product || ''}</div>
                    </TD>
                    <TD>{t.mcc || '—'}</TD>
                    <TD>{t.entry_mode || '—'}</TD>
                    <TD className="text-right tabular-nums">{fmtUsd(t.amount_cents)}</TD>
                    <TD className="text-center">
                      <YesNo value={t.has_avs} />
                    </TD>
                    <TD className="text-center">
                      <YesNo value={t.has_level2} />
                    </TD>
                    <TD className="text-center">
                      <YesNo value={t.has_level3} />
                    </TD>
                    <TD className="font-mono text-xs">{t.billed_category_code || '—'}</TD>
                    <TD className="text-right tabular-nums">{fmtUsd(t.billed_fee_cents)}</TD>
                    <TD className="text-right">
                      <Link href={`/dashboard/transactions/${t.id}`}>
                        <Button variant="ghost">View</Button>
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
