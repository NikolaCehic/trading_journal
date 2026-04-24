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
  errorComponent: RootErrorBoundary,
})

function RootErrorBoundary({ error, reset }: { error: Error; reset?: () => void }) {
  return (
    <div role="alert" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="tj-card" style={{ padding: 24, maxWidth: 480 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Something went wrong</h1>
        <p style={{ fontSize: 13, color: 'var(--fg-subtle)', marginBottom: 16 }}>
          An unexpected error prevented this page from loading.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="tj-btn tj-btn-primary"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
          {reset ? (
            <button type="button" className="tj-btn tj-btn-sm" onClick={reset}>
              Try again
            </button>
          ) : null}
        </div>
        <details style={{ marginTop: 16, fontSize: 12, color: 'var(--fg-faint)' }}>
          <summary>Details</summary>
          <pre>{error?.message ?? String(error)}</pre>
        </details>
      </div>
    </div>
  )
}

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
