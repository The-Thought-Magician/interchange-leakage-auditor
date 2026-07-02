import type { Metadata } from 'next'
import { Sora } from 'next/font/google'
import './globals.css'

const sora = Sora({ subsets: ['latin'], variable: '--font-sora', display: 'swap' })

export const metadata: Metadata = {
  title: 'InterchangeLeakageAuditor',
  description: 'Re-derive the optimal interchange category for every card transaction and flag the costly downgrades you should never have paid.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sora.variable}>
      <body className="bg-neutral-950 text-neutral-100 min-h-screen antialiased font-sans">{children}</body>
    </html>
  )
}
