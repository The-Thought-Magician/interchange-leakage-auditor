interface StatProps {
  label: string
  value: React.ReactNode
  hint?: string
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
  className?: string
}

const valueTones: Record<NonNullable<StatProps['tone']>, string> = {
  neutral: 'text-white',
  success: 'text-emerald-400',
  warning: 'text-amber-400',
  danger: 'text-rose-400',
}

export function Stat({ label, value, hint, tone = 'neutral', className = '' }: StatProps) {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900/60 p-5 ${className}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${valueTones[tone]}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

export default Stat
