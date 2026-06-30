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

const WORKSPACE_KEY = 'ila.workspace_id'

type Workspace = { id: string; name: string; owner_id?: string }
type Member = { id: string; workspace_id?: string; user_id: string; role: string; created_at?: string }
type Setting = { id?: string; workspace_id?: string; key: string; value: any; updated_at?: string }
type OnboardingState = {
  id?: string
  workspace_id?: string
  user_id?: string
  steps?: Record<string, boolean> | string[] | null
  completed?: boolean
}
type Plan = { id: string; name: string; price_cents?: number }
type Subscription = { id?: string; plan_id?: string; status?: string; current_period_end?: string | null }
type BillingPlan = { subscription?: Subscription | null; plan?: Plan | null; stripeEnabled?: boolean }

const ONBOARDING_STEPS: { key: string; label: string; href?: string }[] = [
  { key: 'create_workspace', label: 'Create a workspace' },
  { key: 'add_processor', label: 'Add a processor', href: '/dashboard/processors' },
  { key: 'import_rate_table', label: 'Import a rate table', href: '/dashboard/rate-tables' },
  { key: 'upload_batch', label: 'Upload a transaction batch', href: '/dashboard/uploads' },
  { key: 'run_qualification', label: 'Run qualification', href: '/dashboard/qualification' },
  { key: 'review_savings', label: 'Review recoverable savings', href: '/dashboard/savings' },
]

function fmtUsd(cents?: number) {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function fmtDate(ts?: string | null) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', { dateStyle: 'medium' })
}

function stepDone(steps: OnboardingState['steps'], key: string): boolean {
  if (!steps) return false
  if (Array.isArray(steps)) return steps.includes(key)
  return !!steps[key]
}

export default function SettingsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')

  const [members, setMembers] = useState<Member[]>([])
  const [settings, setSettings] = useState<Setting[]>([])
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null)
  const [billing, setBilling] = useState<BillingPlan | null>(null)

  const [loading, setLoading] = useState(true)
  const [dataLoading, setDataLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // workspace name editing
  const [wsName, setWsName] = useState('')
  const [savingName, setSavingName] = useState(false)

  // settings KV form
  const [settingKey, setSettingKey] = useState('')
  const [settingValue, setSettingValue] = useState('')
  const [savingSetting, setSavingSetting] = useState(false)

  // add member modal
  const [memberOpen, setMemberOpen] = useState(false)
  const [memberUserId, setMemberUserId] = useState('')
  const [memberRole, setMemberRole] = useState('member')
  const [addingMember, setAddingMember] = useState(false)
  const [memberErr, setMemberErr] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null)
  const [removing, setRemoving] = useState(false)

  // onboarding
  const [stepBusy, setStepBusy] = useState<string | null>(null)

  // billing
  const [billingBusy, setBillingBusy] = useState(false)

  // seed
  const [seeding, setSeeding] = useState(false)

  const selectedWorkspace = useMemo(
    () => workspaces.find((w) => w.id === workspaceId) || null,
    [workspaces, workspaceId],
  )

  const loadWorkspaces = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list: Workspace[] = await api.listWorkspaces()
      const arr = Array.isArray(list) ? list : []
      setWorkspaces(arr)
      const stored = typeof window !== 'undefined' ? localStorage.getItem(WORKSPACE_KEY) : null
      const next = (stored && arr.find((w) => w.id === stored)?.id) || (arr[0] && arr[0].id) || ''
      setWorkspaceId(next)
    } catch (e: any) {
      setError(e?.message || 'Failed to load workspaces')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadData = useCallback(async (wsId: string) => {
    if (!wsId) {
      setMembers([])
      setSettings([])
      setOnboarding(null)
      return
    }
    setDataLoading(true)
    setError(null)
    try {
      const [m, s, o] = await Promise.all([
        api.listMembers(wsId).catch(() => []),
        api.getSettings(wsId).catch(() => []),
        api.getOnboarding(wsId).catch(() => null),
      ])
      setMembers(Array.isArray(m) ? m : [])
      setSettings(Array.isArray(s) ? s : [])
      setOnboarding(o || null)
    } catch (e: any) {
      setError(e?.message || 'Failed to load workspace settings')
    } finally {
      setDataLoading(false)
    }
  }, [])

  const loadBilling = useCallback(async () => {
    try {
      const b: BillingPlan = await api.getBillingPlan()
      setBilling(b || {})
    } catch {
      setBilling({})
    }
  }, [])

  useEffect(() => {
    loadWorkspaces()
    loadBilling()
  }, [loadWorkspaces, loadBilling])

  useEffect(() => {
    if (workspaceId && typeof window !== 'undefined') {
      localStorage.setItem(WORKSPACE_KEY, workspaceId)
    }
    setWsName(selectedWorkspace?.name || '')
    loadData(workspaceId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, loadData])

  useEffect(() => {
    setWsName(selectedWorkspace?.name || '')
  }, [selectedWorkspace])

  function flash(msg: string) {
    setNotice(msg)
    setTimeout(() => setNotice(null), 4000)
  }

  async function handleRenameWorkspace(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId || !wsName.trim()) return
    setSavingName(true)
    setError(null)
    try {
      const updated: Workspace = await api.updateWorkspace(workspaceId, { name: wsName.trim() })
      setWorkspaces((prev) => prev.map((w) => (w.id === workspaceId ? { ...w, ...updated } : w)))
      flash('Workspace name updated.')
    } catch (e: any) {
      setError(e?.message || 'Failed to rename workspace')
    } finally {
      setSavingName(false)
    }
  }

  async function handleSaveSetting(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId || !settingKey.trim()) return
    setSavingSetting(true)
    setError(null)
    let parsed: any = settingValue
    try {
      parsed = JSON.parse(settingValue)
    } catch {
      parsed = settingValue
    }
    try {
      const saved: Setting = await api.upsertSetting({
        workspace_id: workspaceId,
        key: settingKey.trim(),
        value: parsed,
      })
      setSettings((prev) => {
        const exists = prev.some((s) => s.key === saved.key)
        return exists ? prev.map((s) => (s.key === saved.key ? saved : s)) : [saved, ...prev]
      })
      setSettingKey('')
      setSettingValue('')
      flash('Setting saved.')
    } catch (e: any) {
      setError(e?.message || 'Failed to save setting')
    } finally {
      setSavingSetting(false)
    }
  }

  function editSetting(s: Setting) {
    setSettingKey(s.key)
    setSettingValue(typeof s.value === 'string' ? s.value : JSON.stringify(s.value, null, 2))
  }

  async function handleAddMember(e?: React.FormEvent) {
    e?.preventDefault()
    if (!workspaceId || !memberUserId.trim()) return
    setAddingMember(true)
    setMemberErr(null)
    try {
      const m: Member = await api.addMember(workspaceId, {
        user_id: memberUserId.trim(),
        role: memberRole,
      })
      setMembers((prev) => [...prev, m])
      setMemberOpen(false)
      setMemberUserId('')
      setMemberRole('member')
      flash('Member added.')
    } catch (e: any) {
      setMemberErr(e?.message || 'Failed to add member')
    } finally {
      setAddingMember(false)
    }
  }

  async function handleRemoveMember() {
    if (!removeTarget || !workspaceId) return
    setRemoving(true)
    try {
      await api.removeMember(workspaceId, removeTarget.id)
      setMembers((prev) => prev.filter((m) => m.id !== removeTarget.id))
      setRemoveTarget(null)
      flash('Member removed.')
    } catch (e: any) {
      setError(e?.message || 'Failed to remove member')
    } finally {
      setRemoving(false)
    }
  }

  async function handleCompleteStep(stepKey: string) {
    if (!workspaceId) return
    setStepBusy(stepKey)
    setError(null)
    try {
      const next: OnboardingState = await api.completeOnboardingStep({
        workspace_id: workspaceId,
        step: stepKey,
      })
      setOnboarding(next || null)
    } catch (e: any) {
      setError(e?.message || 'Failed to update onboarding')
    } finally {
      setStepBusy(null)
    }
  }

  async function handleCheckout() {
    setBillingBusy(true)
    setError(null)
    try {
      const res = await api.startCheckout()
      if (res?.url) window.location.href = res.url
      else flash('Checkout is not available.')
    } catch (e: any) {
      setError(e?.message || 'Billing is not configured (Stripe disabled).')
    } finally {
      setBillingBusy(false)
    }
  }

  async function handlePortal() {
    setBillingBusy(true)
    setError(null)
    try {
      const res = await api.openBillingPortal()
      if (res?.url) window.location.href = res.url
      else flash('Billing portal is not available.')
    } catch (e: any) {
      setError(e?.message || 'Billing is not configured (Stripe disabled).')
    } finally {
      setBillingBusy(false)
    }
  }

  async function handleSeed() {
    setSeeding(true)
    setError(null)
    try {
      const res = await api.seedSample(workspaceId ? { workspace_id: workspaceId } : undefined)
      flash(`Seeded demo data: ${(res?.txnCount ?? 0).toLocaleString('en-US')} transactions.`)
      await loadWorkspaces()
      if (res?.workspace_id) setWorkspaceId(res.workspace_id)
      else await loadData(workspaceId)
    } catch (e: any) {
      setError(e?.message || 'Failed to seed sample data')
    } finally {
      setSeeding(false)
    }
  }

  const completedSteps = useMemo(
    () => ONBOARDING_STEPS.filter((s) => stepDone(onboarding?.steps, s.key)).length,
    [onboarding],
  )
  const onboardingPct = Math.round((completedSteps / ONBOARDING_STEPS.length) * 100)

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading settings..." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="mt-1 text-sm text-slate-400">
            Workspace configuration, members, onboarding, and billing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Workspace</label>
          <select
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            disabled={workspaces.length === 0}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
          >
            {workspaces.length === 0 && <option value="">No workspaces</option>}
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      {workspaces.length === 0 ? (
        <EmptyState
          title="No workspaces yet"
          description="Seed sample data to bootstrap a demo workspace, or create one from the dashboard."
          action={
            <Button onClick={handleSeed} disabled={seeding}>
              {seeding ? 'Seeding...' : 'Seed sample data'}
            </Button>
          }
        />
      ) : dataLoading ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Spinner label="Loading workspace settings..." />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Onboarding */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Onboarding</h2>
                <Badge tone={onboarding?.completed || onboardingPct === 100 ? 'success' : 'info'}>
                  {onboardingPct}% complete
                </Badge>
              </div>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${onboardingPct}%` }}
                />
              </div>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ONBOARDING_STEPS.map((step) => {
                  const done = stepDone(onboarding?.steps, step.key)
                  return (
                    <li
                      key={step.key}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-full border text-xs ${
                            done
                              ? 'border-emerald-500 bg-emerald-500 text-slate-950'
                              : 'border-slate-700 text-slate-600'
                          }`}
                        >
                          {done ? '✓' : ''}
                        </span>
                        <span className={`text-sm ${done ? 'text-slate-400 line-through' : 'text-slate-200'}`}>
                          {step.label}
                        </span>
                      </div>
                      {done ? (
                        <Badge tone="success">Done</Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs"
                          onClick={() => handleCompleteStep(step.key)}
                          disabled={stepBusy === step.key}
                        >
                          {stepBusy === step.key ? '...' : 'Mark done'}
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </CardBody>
          </Card>

          {/* Workspace */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-white">Workspace</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <form onSubmit={handleRenameWorkspace} className="space-y-3">
                <label className="block text-sm text-slate-300">
                  Name
                  <input
                    value={wsName}
                    onChange={(e) => setWsName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </label>
                <div className="text-xs text-slate-500">
                  ID: <span className="font-mono">{workspaceId}</span>
                </div>
                <Button
                  type="submit"
                  disabled={savingName || !wsName.trim() || wsName.trim() === selectedWorkspace?.name}
                >
                  {savingName ? 'Saving...' : 'Save name'}
                </Button>
              </form>
              <div className="border-t border-slate-800 pt-4">
                <p className="mb-2 text-xs text-slate-500">
                  Plant a fully-worked demo workspace with planted downgrades for evaluation.
                </p>
                <Button variant="secondary" onClick={handleSeed} disabled={seeding}>
                  {seeding ? 'Seeding...' : 'Seed sample data'}
                </Button>
              </div>
            </CardBody>
          </Card>

          {/* Billing */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-white">Billing &amp; Plan</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Stat
                  label="Current plan"
                  value={billing?.plan?.name || billing?.subscription?.plan_id || 'Free'}
                  tone="success"
                />
                <Stat
                  label="Price"
                  value={fmtUsd(billing?.plan?.price_cents)}
                  hint="per month"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>Status:</span>
                <Badge tone={billing?.subscription?.status === 'active' ? 'success' : 'neutral'}>
                  {billing?.subscription?.status || 'free'}
                </Badge>
                {billing?.subscription?.current_period_end && (
                  <span>Renews {fmtDate(billing.subscription.current_period_end)}</span>
                )}
              </div>
              {!billing?.stripeEnabled && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  Stripe is not configured on this deployment. Upgrade and portal actions are disabled.
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleCheckout} disabled={billingBusy || !billing?.stripeEnabled}>
                  {billingBusy ? '...' : 'Upgrade to Pro'}
                </Button>
                <Button variant="secondary" onClick={handlePortal} disabled={billingBusy || !billing?.stripeEnabled}>
                  Manage billing
                </Button>
              </div>
            </CardBody>
          </Card>

          {/* Members */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Members ({members.length})</h2>
                <Button variant="secondary" onClick={() => { setMemberErr(null); setMemberOpen(true) }}>
                  + Add member
                </Button>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {members.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="No members"
                    description="Add teammates by their user ID to collaborate on this workspace."
                    action={<Button variant="secondary" onClick={() => setMemberOpen(true)}>Add member</Button>}
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>User ID</TH>
                      <TH>Role</TH>
                      <TH>Joined</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {members.map((m) => {
                      const isOwner = m.role === 'owner' || m.user_id === selectedWorkspace?.owner_id
                      return (
                        <TR key={m.id}>
                          <TD className="font-mono text-xs text-slate-300">{m.user_id}</TD>
                          <TD>
                            <Badge tone={isOwner ? 'success' : 'neutral'}>{m.role}</Badge>
                          </TD>
                          <TD>{fmtDate(m.created_at)}</TD>
                          <TD className="text-right">
                            {isOwner ? (
                              <span className="text-xs text-slate-600">Owner</span>
                            ) : (
                              <Button
                                variant="danger"
                                className="px-3 py-1 text-xs"
                                onClick={() => setRemoveTarget(m)}
                              >
                                Remove
                              </Button>
                            )}
                          </TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>

          {/* Settings KV */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <h2 className="text-sm font-semibold text-white">Workspace settings</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <form onSubmit={handleSaveSetting} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                <label className="block text-sm text-slate-300">
                  Key
                  <input
                    value={settingKey}
                    onChange={(e) => setSettingKey(e.target.value)}
                    placeholder="default_currency"
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </label>
                <label className="block text-sm text-slate-300">
                  Value (JSON or text)
                  <input
                    value={settingValue}
                    onChange={(e) => setSettingValue(e.target.value)}
                    placeholder='"USD" or {"enabled":true}'
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </label>
                <Button type="submit" disabled={savingSetting || !settingKey.trim()}>
                  {savingSetting ? 'Saving...' : 'Save'}
                </Button>
              </form>

              {settings.length === 0 ? (
                <EmptyState
                  title="No settings"
                  description="Workspace-level key/value configuration appears here once saved."
                />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Key</TH>
                      <TH>Value</TH>
                      <TH>Updated</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {settings.map((s) => (
                      <TR key={s.key}>
                        <TD className="font-mono text-xs text-slate-200">{s.key}</TD>
                        <TD>
                          <code className="font-mono text-xs text-slate-400">
                            {typeof s.value === 'string' ? s.value : JSON.stringify(s.value)}
                          </code>
                        </TD>
                        <TD>{fmtDate(s.updated_at)}</TD>
                        <TD className="text-right">
                          <Button
                            variant="ghost"
                            className="px-3 py-1 text-xs"
                            onClick={() => editSetting(s)}
                          >
                            Edit
                          </Button>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* Add member modal */}
      <Modal
        open={memberOpen}
        onClose={() => setMemberOpen(false)}
        title="Add member"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMemberOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => handleAddMember()} disabled={addingMember || !memberUserId.trim()}>
              {addingMember ? 'Adding...' : 'Add member'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleAddMember} className="space-y-3">
          {memberErr && <div className="text-sm text-rose-400">{memberErr}</div>}
          <label className="block text-sm text-slate-300">
            User ID
            <input
              autoFocus
              value={memberUserId}
              onChange={(e) => setMemberUserId(e.target.value)}
              placeholder="user_abc123"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </label>
          <label className="block text-sm text-slate-300">
            Role
            <select
              value={memberRole}
              onChange={(e) => setMemberRole(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
        </form>
      </Modal>

      {/* Remove member confirm */}
      <Modal
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        title="Remove member"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleRemoveMember} disabled={removing}>
              {removing ? 'Removing...' : 'Remove'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Remove <span className="font-mono text-white">{removeTarget?.user_id}</span> from this
          workspace? They will lose access immediately.
        </p>
      </Modal>
    </div>
  )
}
