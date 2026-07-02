'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'

const WS_KEY = 'ila.workspace_id'

interface Workspace { id: string; name: string }
interface Notification {
  id: string
  type?: string
  title?: string
  body?: string
  entity_type?: string
  entity_id?: string
  read?: boolean
  created_at?: string
}

type Filter = 'all' | 'unread' | 'read'

function timeAgo(iso?: string) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

function typeTone(type?: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch ((type || '').toLowerCase()) {
    case 'downgrade':
    case 'alert':
    case 'error':
      return 'danger'
    case 'savings':
    case 'recovered':
    case 'success':
      return 'success'
    case 'reconciliation':
    case 'warning':
      return 'warning'
    case 'info':
    case 'upload':
    case 'qualification':
      return 'info'
    default:
      return 'neutral'
  }
}

function typeIcon(type?: string) {
  switch ((type || '').toLowerCase()) {
    case 'downgrade':
    case 'alert':
      return '⚠️'
    case 'savings':
    case 'recovered':
      return '💰'
    case 'reconciliation':
      return '🧾'
    case 'upload':
      return '📤'
    case 'qualification':
      return '⚙️'
    default:
      return '🔔'
  }
}

export default function NotificationsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsId, setWsId] = useState('')
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingData, setLoadingData] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

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

  const loadData = useCallback(async (id: string) => {
    if (!id) return
    setLoadingData(true)
    setError(null)
    try {
      const list: Notification[] = await api.listNotifications(id)
      setItems(Array.isArray(list) ? list : [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load notifications')
    } finally {
      setLoadingData(false)
    }
  }, [])

  useEffect(() => {
    if (wsId) {
      if (typeof window !== 'undefined') localStorage.setItem(WS_KEY, wsId)
      loadData(wsId)
    }
  }, [wsId, loadData])

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items
      .filter((n) => (filter === 'unread' ? !n.read : filter === 'read' ? n.read : true))
      .filter((n) => {
        if (!q) return true
        return (
          (n.title || '').toLowerCase().includes(q) ||
          (n.body || '').toLowerCase().includes(q) ||
          (n.type || '').toLowerCase().includes(q)
        )
      })
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
  }, [items, filter, search])

  const markRead = async (id: string) => {
    setBusyId(id)
    setError(null)
    // optimistic
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    try {
      await api.markNotificationRead(id)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to mark read')
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: false } : n)))
    } finally {
      setBusyId(null)
    }
  }

  const markAll = async () => {
    if (!wsId || unreadCount === 0) return
    setMarkingAll(true)
    setError(null)
    const snapshot = items
    setItems((prev) => prev.map((n) => ({ ...n, read: true })))
    try {
      await api.markAllNotificationsRead(wsId)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to mark all read')
      setItems(snapshot)
    } finally {
      setMarkingAll(false)
    }
  }

  if (loading) {
    return <div className="py-20"><Spinner label="Loading notifications..." /></div>
  }

  if (workspaces.length === 0) {
    return (
      <EmptyState
        title="No workspace yet"
        description="Create a workspace from the dashboard to start receiving notifications."
        icon="🔔"
        action={<a href="/dashboard"><Button>Go to dashboard</Button></a>}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Notifications</h1>
          <p className="text-sm text-neutral-500">
            {unreadCount > 0 ? `${unreadCount} unread of ${items.length}` : `${items.length} total`}
          </p>
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
          <Button variant="secondary" onClick={() => loadData(wsId)} disabled={loadingData}>
            {loadingData ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button onClick={markAll} disabled={markingAll || unreadCount === 0}>
            {markingAll ? 'Marking…' : 'Mark all read'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-950/40 p-1">
            {(['all', 'unread', 'read'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-3 py-1.5 text-sm capitalize transition-colors ${
                  filter === f ? 'bg-red-500/15 font-medium text-red-400' : 'text-neutral-400 hover:text-white'
                }`}
              >
                {f}
                {f === 'unread' && unreadCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-rose-500/20 px-1.5 text-xs text-rose-300">{unreadCount}</span>
                )}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notifications…"
            className="w-full max-w-xs rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-red-500 focus:outline-none"
          />
        </CardHeader>
        <CardBody className="p-0">
          {loadingData && items.length === 0 ? (
            <div className="py-16"><Spinner label="Loading…" /></div>
          ) : visible.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={items.length === 0 ? 'No notifications' : 'Nothing matches'}
                description={
                  items.length === 0
                    ? 'Notifications appear here when uploads parse, qualification runs, or downgrades are found.'
                    : 'Try a different filter or search term.'
                }
                icon="🔔"
              />
            </div>
          ) : (
            <ul className="divide-y divide-neutral-800">
              {visible.map((n) => (
                <li
                  key={n.id}
                  className={`flex items-start gap-3 px-5 py-4 transition-colors ${
                    n.read ? 'opacity-70' : 'bg-red-500/[0.03]'
                  }`}
                >
                  <div className="mt-0.5 text-lg">{typeIcon(n.type)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" />}
                      <span className="font-medium text-neutral-100">{n.title || n.type || 'Notification'}</span>
                      {n.type && <Badge tone={typeTone(n.type)}>{n.type}</Badge>}
                      {n.entity_type && (
                        <span className="text-xs text-neutral-500">{n.entity_type}{n.entity_id ? ` · ${n.entity_id.slice(0, 8)}` : ''}</span>
                      )}
                    </div>
                    {n.body && <p className="mt-1 text-sm text-neutral-400">{n.body}</p>}
                    <div className="mt-1 text-xs text-neutral-600">{timeAgo(n.created_at)}</div>
                  </div>
                  <div className="shrink-0">
                    {!n.read ? (
                      <Button
                        variant="ghost"
                        onClick={() => markRead(n.id)}
                        disabled={busyId === n.id}
                        className="text-xs"
                      >
                        {busyId === n.id ? '…' : 'Mark read'}
                      </Button>
                    ) : (
                      <span className="text-xs text-neutral-600">Read</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
