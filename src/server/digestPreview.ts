import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { auth } from '~/auth/server'
import { db } from '~/db/client'
import { buildDigestFacts } from '~/narrator/facts/digestFacts'
import { composeDigest } from '~/narrator/compose'
import { renderDigestEmail } from '~/narrator/email/render'
import { signUnsubscribeToken } from '~/lib/unsubscribeToken'
import { env } from '~/lib/env'

export type DigestPreview = {
  isoWeek: string
  subject: string
  html: string
  text: string
  narrative: Awaited<ReturnType<typeof composeDigest>>['narrative']
  failed: boolean
  retried: boolean
  tokensIn: number
  tokensOut: number
}

export const previewDigest = createServerFn({ method: 'GET' }).handler(async () => {
  const request = getRequest()
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) throw new Error('unauthorized')
  const userId = session.user.id

  const isoWeek = currentIsoWeek()
  const facts = await buildDigestFacts(db, userId, isoWeek)
  const composed = await composeDigest(facts)
  const unsubscribeUrl = `${env.BETTER_AUTH_URL}/api/unsubscribe?t=${signUnsubscribeToken(userId)}`
  const email = renderDigestEmail(facts, composed.narrative, { unsubscribeUrl })

  return {
    isoWeek,
    subject: email.subject,
    html: email.html,
    text: email.text,
    narrative: composed.narrative,
    failed: composed.failed,
    retried: composed.retried,
    tokensIn: composed.tokensIn,
    tokensOut: composed.tokensOut,
  } satisfies DigestPreview
})

function currentIsoWeek(): string {
  // Same algorithm used elsewhere — compute current ISO week (YYYY-Www)
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() - day + 4) // Thursday of current week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}
