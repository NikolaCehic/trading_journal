import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/(app)/digest/')({
  component: DigestPage,
})

function DigestPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Digest</h1>
      <p className="mt-2 text-sm text-neutral-400">Coming soon — Phase 4.</p>
    </div>
  )
}
