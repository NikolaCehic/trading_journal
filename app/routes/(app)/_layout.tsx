import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/start-client-core'
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
          <div className="flex items-center gap-6">
            <div className="text-sm font-semibold">Trade Journal</div>
            <nav className="flex items-center gap-4 text-sm text-neutral-400">
              <Link to="/dashboard" className="hover:text-white transition-colors [&.active]:text-white">Dashboard</Link>
              <Link to="/import" className="hover:text-white transition-colors [&.active]:text-white">Import</Link>
            </nav>
          </div>
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
