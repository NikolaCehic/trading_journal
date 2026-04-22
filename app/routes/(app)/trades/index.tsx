import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/(app)/trades/')({
  component: TradesPage,
})

function TradesPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Trades</h1>
      <p className="mt-2 text-sm text-neutral-400">Coming soon — Task 14.</p>
    </div>
  )
}
