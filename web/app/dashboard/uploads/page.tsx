'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WORKSPACE_KEY = 'ila.workspace_id'

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

type Processor = { id: string; name: string; mid?: string }

type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

function statusTone(status?: string): StatusTone {
  switch ((status || '').toLowerCase()) {
    case 'parsed':
    case 'qualified':
    case 'complete':
    case 'completed':
      return 'success'
    case 'pending':
    case 'parsing':
    case 'processing':
      return 'warning'
    case 'error':
    case 'failed':
      return 'danger'
    default:
      return 'neutral'
  }
}

function fmtDate(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toLocaleString()
}

// Lightweight CSV parser: header row + comma-split rows into array of objects.
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []
  const splitLine = (line: string) => {
    const out: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQ = !inQ
      } else if (ch === ',' && !inQ) {
        out.push(cur)
        cur = ''
      } else cur += ch
    }
    out.push(cur)
    return out.map((c) => c.trim())
  }
  const headers = splitLine(lines[0])
  return lines.slice(1).map((line) => {
    const cells = splitLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? ''
    })
    return row
  })
}

export default function UploadsPage() {
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [batches, setBatches] = useState<UploadBatch[]>([])
  const [processors, setProcessors] = useState<Processor[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [filename, setFilename] = useState('')
  const [format, setFormat] = useState<'csv' | 'json'>('csv')
  const [processorId, setProcessorId] = useState('')
  const [raw, setRaw] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)
  const [previewCount, setPreviewCount] = useState<number | null>(null)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setWorkspaceId(localStorage.getItem(WORKSPACE_KEY) || '')
    }
  }, [])

  const load = useCallback(async (wsId: string) => {
    if (!wsId) {
      setBatches([])
      setProcessors([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [b, p] = await Promise.all([api.listUploads(wsId), api.listProcessors(wsId)])
      setBatches(Array.isArray(b) ? b : [])
      setProcessors(Array.isArray(p) ? p : [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load uploads')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(workspaceId)
  }, [workspaceId, load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return batches.filter((b) => {
      if (statusFilter !== 'all' && (b.status || '').toLowerCase() !== statusFilter) return false
      if (!q) return true
      return (
        b.filename.toLowerCase().includes(q) ||
        (b.source_format || '').toLowerCase().includes(q) ||
        (b.status || '').toLowerCase().includes(q)
      )
    })
  }, [batches, search, statusFilter])

  const statuses = useMemo(() => {
    const set = new Set<string>()
    batches.forEach((b) => b.status && set.add(b.status.toLowerCase()))
    return Array.from(set).sort()
  }, [batches])

  function buildRows(): { rows: any[]; error?: string } {
    if (!raw.trim()) return { rows: [], error: 'Paste CSV or JSON content' }
    try {
      if (format === 'json') {
        const parsed = JSON.parse(raw)
        const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rows) ? parsed.rows : null
        if (!rows) return { rows: [], error: 'JSON must be an array of rows (or { rows: [...] })' }
        return { rows }
      }
      const rows = parseCsv(raw)
      if (rows.length === 0) return { rows: [], error: 'CSV needs a header row plus at least one data row' }
      return { rows }
    } catch (e: any) {
      return { rows: [], error: e?.message || 'Could not parse content' }
    }
  }

  function handlePreview() {
    const { rows, error: err } = buildRows()
    if (err) {
      setCreateErr(err)
      setPreviewCount(null)
    } else {
      setCreateErr(null)
      setPreviewCount(rows.length)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const { rows, error: err } = buildRows()
    if (err) {
      setCreateErr(err)
      return
    }
    setSubmitting(true)
    setCreateErr(null)
    try {
      const res = await api.createUpload({
        workspace_id: workspaceId,
        filename: filename.trim() || `upload-${new Date().toISOString().slice(0, 10)}.${format}`,
        source_format: format,
        processor_id: processorId || null,
        rows,
      })
      const batch: UploadBatch | undefined = res?.batch
      if (batch) setBatches((prev) => [batch, ...prev])
      else await load(workspaceId)
      resetForm()
      setCreateOpen(false)
    } catch (e: any) {
      setCreateErr(e?.message || 'Failed to create upload')
    } finally {
      setSubmitting(false)
    }
  }

  function resetForm() {
    setFilename('')
    setFormat('csv')
    setProcessorId('')
    setRaw('')
    setPreviewCount(null)
    setCreateErr(null)
  }

  async function handleDelete(id: string) {
    if (typeof window !== 'undefined' && !window.confirm('Delete this batch and all its transactions and results?')) return
    setDeletingId(id)
    setError(null)
    try {
      await api.deleteUpload(id)
      setBatches((prev) => prev.filter((b) => b.id !== id))
    } catch (e: any) {
      setError(e?.message || 'Failed to delete batch')
    } finally {
      setDeletingId(null)
    }
  }

  const procName = (id?: string | null) => processors.find((p) => p.id === id)?.name || '—'

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Uploads</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Import processor statements as CSV or JSON, then parse and run qualification.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={!workspaceId}>
          + New upload
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {!workspaceId ? (
        <EmptyState
          title="No workspace selected"
          description="Pick or create a workspace on the dashboard first."
          action={
            <Link href="/dashboard">
              <Button variant="secondary">Go to dashboard</Button>
            </Link>
          }
        />
      ) : loading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Spinner label="Loading uploads..." />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold text-white">
                Batches <span className="text-neutral-500">({batches.length})</span>
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search filename / status"
                  className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="all">All statuses</option>
                  {statuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
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
                  title={batches.length === 0 ? 'No upload batches yet' : 'No batches match your filters'}
                  description={
                    batches.length === 0
                      ? 'Paste a CSV or JSON statement to create your first batch.'
                      : 'Try clearing the search box or status filter.'
                  }
                  action={
                    batches.length === 0 ? (
                      <Button onClick={() => setCreateOpen(true)}>+ New upload</Button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Filename</TH>
                    <TH>Processor</TH>
                    <TH>Format</TH>
                    <TH className="text-right">Rows</TH>
                    <TH>Status</TH>
                    <TH>Created</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {filtered.map((b) => (
                    <TR key={b.id}>
                      <TD>
                        <Link
                          href={`/dashboard/uploads/${b.id}`}
                          className="font-medium text-red-400 hover:text-red-300"
                        >
                          {b.filename}
                        </Link>
                        {b.error_message && (
                          <div className="mt-0.5 text-xs text-rose-400">{b.error_message}</div>
                        )}
                      </TD>
                      <TD>{procName(b.processor_id)}</TD>
                      <TD className="uppercase">{b.source_format || '—'}</TD>
                      <TD className="text-right tabular-nums">{(b.row_count ?? 0).toLocaleString()}</TD>
                      <TD>
                        <Badge tone={statusTone(b.status)}>{b.status || 'unknown'}</Badge>
                      </TD>
                      <TD className="whitespace-nowrap text-neutral-400">{fmtDate(b.created_at)}</TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-2">
                          <Link href={`/dashboard/uploads/${b.id}`}>
                            <Button variant="ghost">Open</Button>
                          </Link>
                          <Button
                            variant="danger"
                            onClick={() => handleDelete(b.id)}
                            disabled={deletingId === b.id}
                          >
                            {deletingId === b.id ? '...' : 'Delete'}
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
      )}

      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false)
          resetForm()
        }}
        title="New upload"
        className="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={handlePreview}>
              Preview rows
            </Button>
            <Button onClick={handleCreate as any} disabled={submitting || !raw.trim()}>
              {submitting ? 'Uploading...' : 'Create batch'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreate} className="space-y-4">
          {createErr && <div className="text-sm text-rose-400">{createErr}</div>}
          {previewCount != null && !createErr && (
            <div className="text-sm text-red-400">{previewCount} row(s) parsed and ready.</div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block text-sm text-neutral-300 sm:col-span-2">
              Filename
              <input
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                placeholder="march-statement.csv"
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </label>
            <label className="block text-sm text-neutral-300">
              Format
              <select
                value={format}
                onChange={(e) => {
                  setFormat(e.target.value as 'csv' | 'json')
                  setPreviewCount(null)
                }}
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
            </label>
          </div>
          <label className="block text-sm text-neutral-300">
            Processor (optional)
            <select
              value={processorId}
              onChange={(e) => setProcessorId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="">Unassigned</option>
              {processors.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.mid ? ` (${p.mid})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-neutral-300">
            Paste {format.toUpperCase()} content
            <textarea
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value)
                setPreviewCount(null)
              }}
              rows={10}
              placeholder={
                format === 'csv'
                  ? 'external_ref,amount_cents,currency,mcc,card_brand,card_product,entry_mode,...\nTXN-1,12500,USD,5411,visa,corporate,keyed,...'
                  : '[{ "external_ref": "TXN-1", "amount_cents": 12500, "card_brand": "visa", "mcc": "5411" }]'
              }
              className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-100 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </label>
        </form>
      </Modal>
    </div>
  )
}
