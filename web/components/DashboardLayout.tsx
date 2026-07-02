'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

type NavItem = { label: string; href: string }
type NavSection = { title: string; items: NavItem[] }

const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard' },
      { label: 'Analytics', href: '/dashboard/analytics' },
    ],
  },
  {
    title: 'Audit Workflow',
    items: [
      { label: 'Uploads', href: '/dashboard/uploads' },
      { label: 'Transactions', href: '/dashboard/transactions' },
      { label: 'Qualification', href: '/dashboard/qualification' },
      { label: 'Downgrades', href: '/dashboard/downgrades' },
      { label: 'Level 2/3 Gaps', href: '/dashboard/level23' },
    ],
  },
  {
    title: 'Findings',
    items: [
      { label: 'Effective Rate', href: '/dashboard/effective-rate' },
      { label: 'Recoverable Savings', href: '/dashboard/savings' },
      { label: 'Reconciliation', href: '/dashboard/reconciliation' },
    ],
  },
  {
    title: 'Reference Data',
    items: [
      { label: 'Rate Tables', href: '/dashboard/rate-tables' },
      { label: 'Processors', href: '/dashboard/processors' },
      { label: 'Benchmarks', href: '/dashboard/benchmarks' },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { label: 'Notifications', href: '/dashboard/notifications' },
      { label: 'Webhooks', href: '/dashboard/webhooks' },
      { label: 'API Keys', href: '/dashboard/api-keys' },
      { label: 'Audit Log', href: '/dashboard/audit-log' },
      { label: 'Settings', href: '/dashboard/settings' },
    ],
  },
]

function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(href + '/')
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [userLabel, setUserLabel] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = await authClient.getSession()
      const user = (s as any)?.data?.user
      if (!user) {
        router.push('/auth/sign-in')
        return
      }
      if (!cancelled) {
        setUserLabel(user.name ?? user.email ?? 'Account')
        setReady(true)
      }
    })()
    return () => { cancelled = true }
  }, [router])

  useEffect(() => { setDrawerOpen(false) }, [pathname])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950">
        <div className="flex items-center gap-3 text-neutral-400">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-700 border-t-red-400" />
          Loading workspace...
        </div>
      </div>
    )
  }

  const sidebar = (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-4 py-6">
      <Link href="/dashboard" className="flex items-center gap-2 px-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500 text-sm font-black text-neutral-950">IL</span>
        <span className="text-sm font-bold leading-tight text-white">InterchangeLeakageAuditor</span>
      </Link>
      <div className="flex flex-col gap-5">
        {NAV.map((section) => (
          <div key={section.title}>
            <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-600">{section.title}</div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                        active
                          ? 'bg-red-500/10 font-medium text-red-400'
                          : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-white'
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  )

  return (
    <div className="min-h-screen bg-neutral-950">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-neutral-800 bg-neutral-900/40 lg:block">
        {sidebar}
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-neutral-950/70" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-neutral-800 bg-neutral-900">{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-neutral-800 bg-neutral-950/80 px-4 py-3 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-800 hover:text-white lg:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
            >
              ☰
            </button>
            <span className="text-sm font-medium text-neutral-300">Workspace</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-neutral-400 sm:inline">{userLabel}</span>
            <button
              onClick={signOut}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-white"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  )
}
