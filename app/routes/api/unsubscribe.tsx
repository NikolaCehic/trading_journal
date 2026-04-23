import { createFileRoute } from '@tanstack/react-router'
import { db } from '~/db/client'
import { user } from '~/db/schema/auth'
import { eq } from 'drizzle-orm'
import { verifyUnsubscribeToken } from '~/lib/unsubscribeToken'

async function handleUnsubscribe(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const token = url.searchParams.get('t')
  const result = verifyUnsubscribeToken(token ?? '')
  if (!result.ok) {
    return new Response(
      renderHtml(`<h1>Link invalid</h1><p>This unsubscribe link is not valid or has been tampered with.</p>`),
      { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
  }
  await db.update(user).set({ digestEnabled: false }).where(eq(user.id, result.userId))
  // Redirect to the confirmation page
  return Response.redirect(new URL('/unsubscribed', url.origin), 302)
}

function renderHtml(body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Trade Journal</title><style>body{background:#0a0a0a;color:#ededed;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:40px;margin:0}</style>${body}`
}

export const Route = createFileRoute('/api/unsubscribe')({
  component: () => null,
  server: {
    handlers: {
      GET: ({ request }) => handleUnsubscribe(request),
    },
  },
})
