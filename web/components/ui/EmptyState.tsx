interface EmptyStateProps {
  title: string
  description?: string
  action?: React.ReactNode
  icon?: React.ReactNode
  className?: string
}

export function EmptyState({ title, description, action, icon, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 px-6 py-12 text-center ${className}`}>
      {icon && <div className="mb-3 text-3xl text-neutral-600">{icon}</div>}
      <h3 className="text-sm font-semibold text-neutral-200">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-neutral-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export default EmptyState
