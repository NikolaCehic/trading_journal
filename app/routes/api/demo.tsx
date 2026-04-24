import { createFileRoute } from '@tanstack/react-router'
import { db } from '~/db/client'
import { session, user } from '~/db/schema/auth'
import { eq } from 'drizzle-orm'
import { DEMO_USER_ID } from '~/server/demoSeed'
import crypto from 'node:crypto'

// ---------------------------------------------------------------------------
// Cookie signing — must match hono's signed-cookie format used by Better Auth:
// Cookie value = "<token>.<HMAC-SHA256-base64>"
// Hono uses WebCrypto (subtle) with SHA-256 HMAC and standard btoa encoding.
// We replicate that here using the Node built-in crypto.subtle.
// ---------------------------------------------------------------------------
async function signCookieValue(value: string, secret: string): Promise<string> {
  const keyBuf = new TextEncoder().encode(secret)
  const key = await crypto.subtle.importKey(
    'raw',
    keyBuf,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  const signature = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
  return `${value}.${signature}`
}

async function mintDemoSession(request: Request): Promise<Response> {
  // Verify demo user exists — fail loudly rather than auto-seeding
  const [demoUser] = await db.select().from(user).where(eq(user.id, DEMO_USER_ID)).limit(1)
  if (!demoUser) {
    return new Response(
      JSON.stringify({ error: 'demo_not_seeded', message: 'Demo user not seeded. Run pnpm seed:demo first.' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    )
  }

  // Generate a session token (raw)
  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const sessionId = 'demo-sess-' + crypto.randomBytes(8).toString('hex')

  // Insert session row directly — mirror Better Auth's schema
  await db.insert(session).values({
    id: sessionId,
    userId: demoUser.id,
    token,
    expiresAt,
    ipAddress: request.headers.get('x-forwarded-for') ?? null,
    userAgent: request.headers.get('user-agent') ?? null,
  })

  // Sign the token to produce the cookie value that Better Auth's
  // getSignedCookie() / hono verifySignature() will accept.
  const secret = process.env['BETTER_AUTH_SECRET'] ?? ''
  const signedToken = await signCookieValue(token, secret)

  // Better Auth default cookie name: "better-auth.session_token"
  // In production the __Secure- prefix is applied by Better Auth when isProduction;
  // we match that behaviour here.
  const isProd = process.env['NODE_ENV'] === 'production'
  const cookieName = isProd ? '__Secure-better-auth.session_token' : 'better-auth.session_token'

  const cookie = [
    `${cookieName}=${signedToken}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${7 * 24 * 60 * 60}`,
    isProd ? 'Secure' : '',
  ].filter(Boolean).join('; ')

  return new Response(
    JSON.stringify({ ok: true, userId: demoUser.id }),
    { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': cookie } },
  )
}

export const Route = createFileRoute('/api/demo')({
  server: {
    handlers: {
      POST: ({ request }) => mintDemoSession(request),
    },
  },
})
