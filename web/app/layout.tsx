import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'InterchangeLeakageAuditor',
  description: 'Re-derive the optimal interchange category for every card transaction and flag the costly downgrades you should never have paid.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased">{children}</body>
    </html>
  )
}
