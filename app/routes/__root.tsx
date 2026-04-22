import '~/styles/globals.css'
import { createRootRoute, HeadContent, Outlet, ScrollRestoration, Scripts } from '@tanstack/react-router'
import { Toaster } from 'sonner'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Trade Journal' },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        <Outlet />
        <Toaster theme="dark" richColors />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}
