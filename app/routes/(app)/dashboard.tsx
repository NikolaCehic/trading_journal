import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/(app)/dashboard')({
  component: DashboardPage,
})

function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Phase 0 placeholder — analytics arrive in Phase 3.
      </p>
    </div>
  )
}
