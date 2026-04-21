import { createFileRoute } from '@tanstack/react-router'
import { Button } from '~/components/ui/button'
import { signIn } from '~/auth/client'

export const Route = createFileRoute('/(public)/login')({
  component: LoginPage,
})

function LoginPage() {
  async function handleGoogle() {
    await signIn.social({
      provider: 'google',
      callbackURL: '/app/dashboard',
    })
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Use your Google account to continue.
      </p>
      <Button
        className="mt-8 w-full bg-brand text-white hover:bg-brand-700"
        onClick={handleGoogle}
      >
        Continue with Google
      </Button>
    </main>
  )
}
