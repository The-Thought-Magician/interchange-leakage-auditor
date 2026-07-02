'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'

const freeFeatures = [
  'Unlimited settlement / transaction uploads (CSV or JSON)',
  'Deterministic interchange qualification engine',
  'Downgrade detection with cited causes',
  'Level 2 / Level 3 gap report',
  'Effective-rate dashboard and benchmark bands',
  'Recoverable-savings ledger with annualized totals',
  'Statement reconciliation workflow',
  'Rate-table versions, processors, and benchmarks',
  'Webhooks, API keys, and audit log',
]

export default function Pricing() {
  const [stripeEnabled, setStripeEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.getBillingPlan()
        if (!cancelled) setStripeEnabled(Boolean(res?.stripeEnabled))
      } catch {
        if (!cancelled) setStripeEnabled(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <nav className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500 text-sm font-black text-neutral-950">IL</span>
          <span className="text-base font-bold text-white">InterchangeLeakageAuditor</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/auth/sign-in" className="text-sm text-neutral-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-red-400">
            Get Started
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h1 className="text-3xl font-black text-white sm:text-4xl">Simple pricing</h1>
        <p className="mx-auto mt-4 max-w-xl text-neutral-400">
          Every feature is free for signed-in users. A Pro plan exists for future paid add-ons, but it is optional and
          nothing is gated today.
        </p>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-red-500/40 bg-neutral-900/60 p-8 text-left">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Free</h2>
              <span className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">
                Everything included
              </span>
            </div>
            <div className="mt-4 flex items-end gap-1">
              <span className="text-4xl font-black text-white">$0</span>
              <span className="pb-1 text-sm text-neutral-500">/ forever</span>
            </div>
            <ul className="mt-6 space-y-3">
              {freeFeatures.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-neutral-300">
                  <span className="mt-0.5 text-red-400">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/auth/sign-up"
              className="mt-8 block rounded-lg bg-red-500 py-3 text-center font-semibold text-neutral-950 hover:bg-red-400"
            >
              Start free
            </Link>
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-8 text-left">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Pro</h2>
              <span className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-xs font-medium text-neutral-400">
                Optional
              </span>
            </div>
            <div className="mt-4 flex items-end gap-1">
              <span className="text-4xl font-black text-white">Contact</span>
            </div>
            <p className="mt-6 text-sm text-neutral-400">
              Reserved for future premium add-ons. Stripe billing is wired but optional.
            </p>
            <div className="mt-6 rounded-lg border border-neutral-800 bg-neutral-950/50 p-4 text-sm">
              {stripeEnabled === null && <span className="text-neutral-500">Checking billing status...</span>}
              {stripeEnabled === false && (
                <span className="text-neutral-400">
                  Billing is not configured in this deployment, so upgrades return a 503 and all features stay free.
                </span>
              )}
              {stripeEnabled === true && (
                <span className="text-red-400">Billing is configured. Upgrade from your workspace settings.</span>
              )}
            </div>
            <Link
              href="/auth/sign-up"
              className="mt-8 block rounded-lg border border-neutral-700 py-3 text-center font-semibold text-neutral-200 hover:bg-neutral-800"
            >
              Create account
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-neutral-800 px-6 py-10 text-center text-sm text-neutral-600">
        <p>InterchangeLeakageAuditor</p>
      </footer>
    </main>
  )
}
