/// <reference types="vite/client" />
import '~/styles/globals.css'
import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { useState, type ReactNode } from 'react'
import { useIsDemo } from '~/hooks/useIsDemo'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Trade Journal' },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }),
  )
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <DemoBanner />
          {children}
          <Toaster theme="dark" richColors />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}

function DemoBanner() {
  const isDemo = useIsDemo()
  if (!isDemo) return null
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        height: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--amber-weak, rgba(120,53,15,0.18))',
        borderBottom: '1px solid rgba(217,119,6,0.28)',
        color: '#fbbf24',
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: '0.01em',
        userSelect: 'none',
      }}
    >
      You&apos;re in demo mode — writes are disabled.
    </div>
  )
}
