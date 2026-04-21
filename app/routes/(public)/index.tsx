import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/(public)/')({
  component: LandingPage,
})

function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
      <h1 className="text-4xl font-semibold">Trade Journal</h1>
      <p className="mt-4 text-neutral-400">
        A trading journal that coaches you on your own data.
      </p>
      <p className="mt-8 text-sm text-neutral-500">
        Coming soon — Phase 0 foundation in progress.
      </p>
    </main>
  )
}
