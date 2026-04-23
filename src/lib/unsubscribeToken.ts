import crypto from 'node:crypto'
import { env } from '~/lib/env'

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function signUnsubscribeToken(userId: string): string {
  const h = crypto.createHmac('sha256', env.BETTER_AUTH_SECRET)
  h.update(userId)
  const sig = base64url(h.digest())
  return `${userId}.${sig}`
}

export function verifyUnsubscribeToken(token: string): { ok: true; userId: string } | { ok: false; reason: string } {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'missing' }
  const idx = token.lastIndexOf('.')
  if (idx < 0) return { ok: false, reason: 'malformed' }
  const userId = token.slice(0, idx)
  const sig = token.slice(idx + 1)
  if (!userId || !sig) return { ok: false, reason: 'malformed' }
  const expected = signUnsubscribeToken(userId).split('.')[1]
  if (!expected) return { ok: false, reason: 'internal' }
  // Timing-safe compare
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return { ok: false, reason: 'invalid' }
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'invalid' }
  return { ok: true, userId }
}
