import { createFileRoute } from '@tanstack/react-router'
import { Button } from '~/components/ui/button'

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
      <div className="mt-8 flex gap-3">
        <Button className="bg-brand text-white hover:bg-brand-700">Try the demo</Button>
        <Button variant="outline">Sign in with Google</Button>
      </div>
    </main>
  )
}
