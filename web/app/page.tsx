import Link from 'next/link'

const features = [
  {
    title: 'Deterministic qualification engine',
    body: 'Every transaction is re-derived against seeded Visa and Mastercard interchange rate tables to determine the category it should have qualified for. The output is a rules-based determination, not a model score, so it stands up to processor scrutiny.',
  },
  {
    title: 'Downgrade detection with cited causes',
    body: 'Each flagged downgrade is attributed to a specific, correctable cause: late settlement, missing AVS, absent Level 2/3 data, MCC mismatch, or an incorrect entry mode, so your team knows exactly what to fix.',
  },
  {
    title: 'Recoverable-savings ledger',
    body: 'Findings are quantified into annualized recoverable dollars, each paired with the exact data fix required, giving controllers and treasury leads a defensible basis to raise with the processor.',
  },
  {
    title: 'Statement reconciliation',
    body: 'Billed processor fees are reconciled against computed optimal interchange for every settlement batch, tracked through an open, reviewed, and resolved workflow suited to a finance close cycle.',
  },
  {
    title: 'Level 2 / Level 3 gap report',
    body: 'Commercial-card transactions that missed required L2/L3 fields are surfaced and ranked by dollars left on the table, prioritizing remediation where the exposure is largest.',
  },
  {
    title: 'Effective-rate dashboard',
    body: 'Billed-versus-optimal effective basis points are tracked by processor, brand, product, and MCC against your own benchmark bands, giving cost-of-acceptance visibility over time.',
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
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <nav className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500 text-sm font-black text-neutral-950">IL</span>
          <span className="text-base font-bold text-white">InterchangeLeakageAuditor</span>
        </span>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-sm text-neutral-300 hover:text-white">Pricing</Link>
          <Link href="/auth/sign-in" className="text-sm text-neutral-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-red-400">
            Request Access
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-400">
          Interchange qualification and downgrade recovery, self-serve
        </span>
        <h1 className="mt-6 text-4xl font-black leading-tight text-white sm:text-5xl">
          Recover the interchange margin your processor never told you about.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-neutral-400">
          InterchangeLeakageAuditor re-derives the optimal interchange category for every card transaction, identifies
          where you were downgraded to a costlier category, and quantifies the annualized dollars available to recover,
          with a citation to the rate-table rule behind every finding.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/auth/sign-up" className="rounded-lg bg-red-500 px-6 py-3 font-semibold text-neutral-950 hover:bg-red-400">
            Start your audit
          </Link>
          <Link href="/auth/sign-in" className="rounded-lg border border-neutral-700 px-6 py-3 font-semibold text-neutral-200 hover:bg-neutral-800">
            Sign in
          </Link>
        </div>
        <p className="mt-4 text-sm text-neutral-500">All features are available at no cost for signed-in teams.</p>
      </section>

      <section className="border-y border-neutral-800 bg-neutral-900/30 px-6 py-20">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-2xl font-bold text-white">Interchange downgrades erode margin quietly, and no one re-audits the file.</h2>
          <p className="mt-4 text-neutral-400">
            A transaction that could have qualified for a lower commercial-card rate instead settles at a more expensive,
            non-qualified rate. Each downgrade adds 20 to 50 basis points that, on interchange-plus pricing, the merchant
            pays directly. Processors have no incentive to flag it, and manual statement audits on spreadsheets rarely
            keep pace with transaction volume. The result is a recurring cost-of-acceptance leak that compounds every
            settlement cycle.
          </p>
          <ul className="mx-auto mt-8 grid max-w-3xl gap-3 text-left sm:grid-cols-2">
            {causes.map((c) => (
              <li key={c} className="flex items-start gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3 text-sm text-neutral-300">
                <span className="mt-0.5 text-red-400">▸</span>
                {c}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-2xl font-bold text-white">A defensible audit trail for every recovery claim</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-neutral-400">
            A rules engine applied to your uploaded transaction and settlement data, with every finding traceable to the
            specific rate-table row that produced it, built for teams who need to bring evidence to a processor
            negotiation, not just a dashboard.
          </p>
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-6">
                <h3 className="text-base font-semibold text-white">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-neutral-400">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-neutral-800 bg-neutral-900/30 px-6 py-20 text-center">
        <h2 className="text-2xl font-bold text-white">Evaluate the engine against a representative settlement batch</h2>
        <p className="mx-auto mt-4 max-w-2xl text-neutral-400">
          A built-in sample seeder plants a multi-brand settlement batch with known downgrades, so the qualification
          engine, downgrade detector, and recoverable-savings ledger are ready to review the moment your team signs in,
          without waiting on a data integration.
        </p>
        <div className="mt-8">
          <Link href="/auth/sign-up" className="rounded-lg bg-red-500 px-6 py-3 font-semibold text-neutral-950 hover:bg-red-400">
            Create your workspace
          </Link>
        </div>
      </section>

      <footer className="border-t border-neutral-800 px-6 py-10 text-center text-sm text-neutral-600">
        <p>InterchangeLeakageAuditor — interchange downgrade auditing and recoverable-savings reporting for merchants on interchange-plus pricing.</p>
      </footer>
    </main>
  )
}
