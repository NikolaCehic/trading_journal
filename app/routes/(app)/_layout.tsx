import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/start'
import { auth } from '~/auth/server'
import { getWebRequest } from 'vinxi/http'

const getCurrentUser = createServerFn({ method: 'GET' }).handler(async () => {
  const request = getWebRequest()
  const session = await auth.api.getSession({ headers: request.headers })
  return session?.user ?? null
})

export const Route = createFileRoute('/(app)/_layout')({
  beforeLoad: async () => {
    const user = await getCurrentUser()
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
  component: AppLayout,
})

function AppLayout() {
  const { user } = Route.useRouteContext()
  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-800 px-6 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="text-sm font-semibold">Trade Journal</div>
          <div className="text-xs text-neutral-400">
            {user.isDemo ? 'demo · ' : ''}
            {user.email}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
