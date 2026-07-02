import type { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
}

export function Button({ variant = 'primary', className = '', children, ...props }: ButtonProps) {
  const base = 'inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed'
  const variants = {
    primary: 'bg-red-500 text-neutral-950 hover:bg-red-400',
    secondary: 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700 border border-neutral-700',
    ghost: 'text-neutral-400 hover:text-white hover:bg-neutral-800',
    danger: 'bg-rose-600 text-white hover:bg-rose-500',
  }
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}

export default Button
