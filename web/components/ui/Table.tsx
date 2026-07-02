import type { HTMLAttributes, TableHTMLAttributes } from 'react'

export function Table({ className = '', children, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-neutral-800">
      <table className={`w-full text-sm ${className}`} {...props}>
        {children}
      </table>
    </div>
  )
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="bg-neutral-900/80 text-neutral-400">{children}</thead>
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-neutral-800">{children}</tbody>
}

export function TR({ className = '', children, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={`hover:bg-neutral-900/50 ${className}`} {...props}>
      {children}
    </tr>
  )
}

export function TH({ className = '', children, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide ${className}`} {...props}>
      {children}
    </th>
  )
}

export function TD({ className = '', children, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`px-4 py-3 text-neutral-300 ${className}`} {...props}>
      {children}
    </td>
  )
}

export default Table
