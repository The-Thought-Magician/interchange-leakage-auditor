import type { HTMLAttributes } from 'react'

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const tones: Record<Tone, string> = {
  neutral: 'bg-slate-800 text-slate-300 border-slate-700',
  success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  danger: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
  info: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
}

export function Badge({ tone = 'neutral', className = '', children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-medium ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </span>
  )
}

export default Badge
