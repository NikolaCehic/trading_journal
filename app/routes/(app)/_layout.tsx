import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/start-client-core'
import { auth } from '~/auth/server'
import { getWebRequest } from 'vinxi/http'
import { TopBar } from '~/components/shell/TopBar'

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
      <TopBar userEmail={user.email} />
      <main className="mx-auto max-w-[1280px] px-6 py-6">
        <Outlet />
      </main>
    </div>
  )
}
