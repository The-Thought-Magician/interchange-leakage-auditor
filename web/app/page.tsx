import Link from 'next/link'

const features = [
  {
    title: 'Deterministic qualification engine',
    body: 'Re-derive the optimal interchange category for every transaction from seeded Visa and Mastercard rate tables. No machine-learning guesswork, no opaque score.',
  },
  {
    title: 'Downgrade detection with cited causes',
    body: 'Every flagged downgrade is attributed to a concrete cause: late settlement, missing AVS, absent Level 2/3 data, MCC mismatch, or wrong entry mode.',
  },
  {
    title: 'Recoverable-savings ledger',
    body: 'Each finding is quantified into annualized recoverable dollars with the exact data fix required, so a controller can take it straight to the processor.',
  },
  {
    title: 'Statement reconciliation',
    body: 'Reconcile billed processor fees against the computed optimal interchange per settlement batch, with an open / reviewed / resolved workflow.',
  },
  {
    title: 'Level 2 / Level 3 gap report',
    body: 'Surface commercial-card transactions that missed the L2/L3 fields they needed to qualify, ranked by the dollars left on the table.',
  },
  {
    title: 'Effective-rate dashboard',
    body: 'Track billed-vs-optimal effective basis points by processor, brand, product, and MCC, against your own benchmark bands and over time.',
  },
]

const causes = [
  'Late settlement (settled past the authorization window)',
  'Missing AVS / CVV / address verification data',
  'Absent Level 2 fields (tax amount, customer code)',
  'Absent Level 3 line-item, freight, and duty detail',
  'MCC mismatch against the card program',
  'Missing card-present / wrong entry-mode indicators',
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-sm font-black text-slate-950">IL</span>
          <span className="text-base font-bold text-white">InterchangeLeakageAuditor</span>
        </span>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-sm text-slate-300 hover:text-white">Pricing</Link>
          <Link href="/auth/sign-in" className="text-sm text-slate-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
            Get Started
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
          Interchange-plus interchange qualification, self-serve
        </span>
        <h1 className="mt-6 text-4xl font-black leading-tight text-white sm:text-5xl">
          Flag the costly interchange downgrades you should never have paid.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          InterchangeLeakageAuditor re-derives the optimal interchange category for every card transaction, detects
          downgrades, attributes each to a fixable cause, and quantifies the annualized recoverable dollars.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/auth/sign-up" className="rounded-lg bg-emerald-500 px-6 py-3 font-semibold text-slate-950 hover:bg-emerald-400">
            Start auditing free
          </Link>
          <Link href="/auth/sign-in" className="rounded-lg border border-slate-700 px-6 py-3 font-semibold text-slate-200 hover:bg-slate-800">
            Sign in
          </Link>
        </div>
        <p className="mt-4 text-sm text-slate-500">All features are free for signed-in users.</p>
      </section>

      <section className="border-y border-slate-800 bg-slate-900/30 px-6 py-20">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-2xl font-bold text-white">Card transactions silently downgrade, and no one re-audits it.</h2>
          <p className="mt-4 text-slate-400">
            A transaction that could have qualified for a low commercial-card rate instead settles at a non-qualified
            consumer rate. Each downgrade quietly adds 20 to 50 basis points. On interchange-plus pricing the merchant
            pays the difference directly. Processors do not volunteer the optimization, and statement-audit consultants
            do it by hand on spreadsheets.
          </p>
          <ul className="mx-auto mt-8 grid max-w-3xl gap-3 text-left sm:grid-cols-2">
            {causes.map((c) => (
              <li key={c} className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-300">
                <span className="mt-0.5 text-rose-400">▸</span>
                {c}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-2xl font-bold text-white">Everything you need to defend a recovery claim</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">
            A rules engine over your uploaded data, with a citation to the rate-table row behind every finding.
          </p>
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
                <h3 className="text-base font-semibold text-white">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-slate-800 bg-slate-900/30 px-6 py-20 text-center">
        <h2 className="text-2xl font-bold text-white">See it on a planted batch in seconds</h2>
        <p className="mx-auto mt-4 max-w-2xl text-slate-400">
          A built-in sample seeder plants a multi-brand settlement batch with known downgrades, so the qualification
          engine, downgrade detector, and recoverable-savings ledger are demoable the instant you sign in.
        </p>
        <div className="mt-8">
          <Link href="/auth/sign-up" className="rounded-lg bg-emerald-500 px-6 py-3 font-semibold text-slate-950 hover:bg-emerald-400">
            Create your workspace
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-800 px-6 py-10 text-center text-sm text-slate-600">
        <p>InterchangeLeakageAuditor — interchange downgrade auditing for merchants on interchange-plus pricing.</p>
      </footer>
    </main>
  )
}
