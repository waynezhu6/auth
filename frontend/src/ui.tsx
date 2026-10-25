import type { ReactNode } from 'react'

export function Card({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <main className={wide ? 'wide' : undefined}>
      <h1>{title}</h1>
      {children}
    </main>
  )
}

export function date(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
