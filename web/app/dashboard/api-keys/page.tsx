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

type ApiKey = {
  id: string
  workspace_id?: string
  user_id?: string
  name: string
  key_prefix?: string
  last_used_at?: string | null
  revoked?: boolean
  created_at?: string
}

function fmtDate(ts?: string | null) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

function fmtRelative(ts?: string | null) {
  if (!ts) return 'Never used'
  const d = new Date(ts)
  if (isNaN(d.getTime())) return 'Never used'
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return fmtDate(ts)
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showRevoked, setShowRevoked] = useState(true)

  // issue modal
  const [issueOpen, setIssueOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [issuing, setIssuing] = useState(false)
  const [issueErr, setIssueErr] = useState<string | null>(null)

  // reveal-once secret
  const [issuedKey, setIssuedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // revoke confirm
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null)
  const [revoking, setRevoking] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list: ApiKey[] = await api.listApiKeys()
      setKeys(Array.isArray(list) ? list : [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load API keys')
      setKeys([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return keys.filter((k) => {
      if (!showRevoked && k.revoked) return false
      if (!q) return true
      return (
        k.name?.toLowerCase().includes(q) ||
        k.key_prefix?.toLowerCase().includes(q)
      )
    })
  }, [keys, search, showRevoked])

  const activeCount = useMemo(() => keys.filter((k) => !k.revoked).length, [keys])
  const revokedCount = useMemo(() => keys.filter((k) => k.revoked).length, [keys])

  async function handleIssue(e?: React.FormEvent) {
    e?.preventDefault()
    if (!newName.trim()) return
    setIssuing(true)
    setIssueErr(null)
    try {
      const res = await api.createApiKey({ name: newName.trim() })
      // backend returns { key, record }
      const plaintext: string = res?.key || ''
      const record: ApiKey | undefined = res?.record
      if (record) setKeys((prev) => [record, ...prev])
      else await load()
      setIssueOpen(false)
      setNewName('')
      setCopied(false)
      setIssuedKey(plaintext || null)
      if (!plaintext) await load()
    } catch (e: any) {
      setIssueErr(e?.message || 'Failed to issue API key')
    } finally {
      setIssuing(false)
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return
    setRevoking(true)
    try {
      await api.revokeApiKey(revokeTarget.id)
      setKeys((prev) =>
        prev.map((k) => (k.id === revokeTarget.id ? { ...k, revoked: true } : k)),
      )
      setRevokeTarget(null)
    } catch (e: any) {
      setError(e?.message || 'Failed to revoke API key')
    } finally {
      setRevoking(false)
    }
  }

  async function copyKey() {
    if (!issuedKey) return
    try {
      await navigator.clipboard.writeText(issuedKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading API keys..." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">API Keys</h1>
          <p className="mt-1 text-sm text-slate-400">
            Programmatic credentials for the interchange-audit API. Secrets are shown once at creation.
          </p>
        </div>
        <Button onClick={() => { setIssueErr(null); setNewName(''); setIssueOpen(true) }}>
          + Issue key
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Total keys" value={keys.length} hint="All issued credentials" />
        <Stat label="Active" value={activeCount} hint="Currently usable" tone="success" />
        <Stat label="Revoked" value={revokedCount} hint="Disabled credentials" tone={revokedCount > 0 ? 'warning' : 'neutral'} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold text-white">Keys</h2>
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or prefix..."
                className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={showRevoked}
                  onChange={(e) => setShowRevoked(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-950 accent-emerald-500"
                />
                Show revoked
              </label>
            </div>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={keys.length === 0 ? 'No API keys yet' : 'No keys match your filters'}
                description={
                  keys.length === 0
                    ? 'Issue your first API key to call the interchange-audit API programmatically.'
                    : 'Adjust the search term or toggle revoked keys.'
                }
                action={
                  keys.length === 0 ? (
                    <Button onClick={() => setIssueOpen(true)}>Issue key</Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Prefix</TH>
                  <TH>Status</TH>
                  <TH>Last used</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((k) => (
                  <TR key={k.id}>
                    <TD className="font-medium text-slate-100">{k.name}</TD>
                    <TD>
                      <span className="font-mono text-xs text-slate-400">
                        {k.key_prefix ? `${k.key_prefix}…` : '—'}
                      </span>
                    </TD>
                    <TD>
                      {k.revoked ? (
                        <Badge tone="danger">Revoked</Badge>
                      ) : (
                        <Badge tone="success">Active</Badge>
                      )}
                    </TD>
                    <TD title={fmtDate(k.last_used_at)}>{fmtRelative(k.last_used_at)}</TD>
                    <TD>{fmtDate(k.created_at)}</TD>
                    <TD className="text-right">
                      {k.revoked ? (
                        <span className="text-xs text-slate-600">—</span>
                      ) : (
                        <Button
                          variant="danger"
                          className="px-3 py-1 text-xs"
                          onClick={() => setRevokeTarget(k)}
                        >
                          Revoke
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Issue modal */}
      <Modal
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        title="Issue API key"
        footer={
          <>
            <Button variant="ghost" onClick={() => setIssueOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => handleIssue()} disabled={issuing || !newName.trim()}>
              {issuing ? 'Issuing...' : 'Issue key'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleIssue} className="space-y-3">
          {issueErr && <div className="text-sm text-rose-400">{issueErr}</div>}
          <label className="block text-sm text-slate-300">
            Key name
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Production ingest"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </label>
          <p className="text-xs text-slate-500">
            The full secret is displayed only once after creation. Store it securely.
          </p>
        </form>
      </Modal>

      {/* Reveal-once secret */}
      <Modal
        open={!!issuedKey}
        onClose={() => setIssuedKey(null)}
        title="API key created"
        footer={
          <Button onClick={() => setIssuedKey(null)}>Done</Button>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Copy this secret now. You will not be able to see it again.
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-emerald-300">
              {issuedKey}
            </code>
            <Button variant="secondary" onClick={copyKey}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Revoke confirm */}
      <Modal
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        title="Revoke API key"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleRevoke} disabled={revoking}>
              {revoking ? 'Revoking...' : 'Revoke key'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Revoking <span className="font-semibold text-white">{revokeTarget?.name}</span> immediately
          disables it. Any integration using this key will stop working. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
