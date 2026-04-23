import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { useEffect } from 'react'
import { auth } from '~/auth/server'
import { useSession } from '~/auth/client'
import { TopBar } from '~/components/shell/TopBar'
import { setTimezone } from '~/server/userPrefs'

const getCurrentUser = createServerFn({ method: 'GET' }).handler(async () => {
  const request = getRequest()
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
  const session = useSession()

  useEffect(() => {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const storedTz = (session.data?.user as { timezone?: string } | undefined)?.timezone
    if (!browserTz || browserTz === storedTz) return
    // Fire-and-forget; silent failure is acceptable (scheduler has UTC fallback)
    setTimezone({ data: { timezone: browserTz } }).catch(() => {})
  }, [session.data?.user])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <TopBar userEmail={user.email} />
      <Outlet />
    </div>
  )
}
