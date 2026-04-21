import '~/styles/globals.css'
import { initSentryServer } from '~/lib/sentry'
import { createRootRoute, Outlet, ScrollRestoration } from '@tanstack/react-router'

initSentryServer()
import { Meta, Scripts } from '@tanstack/start'

export const Route = createRootRoute({
  meta: () => [
    { charSet: 'utf-8' },
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { title: 'Trade Journal' },
  ],
  component: RootComponent,
})

function RootComponent() {
  return (
    <html lang="en" className="dark">
      <head>
        <Meta />
      </head>
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}
