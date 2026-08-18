import type { PropsWithChildren } from 'react'

export function PageShell({ children }: PropsWithChildren) {
  return (
    <div className="flex min-h-screen flex-col bg-[#f4f1e8]">
      <header className="border-b border-stone-300/70 bg-white/65 px-5 py-4 backdrop-blur sm:px-8">
        <div className="mx-auto flex max-w-xl items-center justify-between">
          <span className="text-lg font-semibold tracking-tight text-stone-900">TurnTally</span>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-900">
            Prototype
          </span>
        </div>
      </header>
      {children}
    </div>
  )
}
