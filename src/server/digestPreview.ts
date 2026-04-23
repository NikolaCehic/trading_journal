import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { and, eq } from 'drizzle-orm'
import { auth } from '~/auth/server'
import { assertNotDemo } from '~/auth/assertNotDemo'
import { db } from '~/db/client'
import { digestRun } from '~/db/schema/narrator'
import { buildDigestFacts } from '~/narrator/facts/digestFacts'
import { composeDigest } from '~/narrator/compose'
import { renderDigestEmail } from '~/narrator/email/render'
import { sendDigestSend } from '~/jobs/events'
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

function parseIsoWeek(isoWeek: string): { start: Date; end: Date } {
  const m = /^(\d{4})-W(\d{2})$/.exec(isoWeek)
  if (!m) throw new Error(`Invalid ISO week: ${isoWeek}`)
  const year = parseInt(m[1]!, 10)
  const week = parseInt(m[2]!, 10)
  const jan4 = Date.UTC(year, 0, 4)
  const jan4Dow = new Date(jan4).getUTCDay() || 7
  const week1Mon = jan4 - (jan4Dow - 1) * 86_400_000
  const monday = new Date(week1Mon + (week - 1) * 7 * 86_400_000)
  const sunday = new Date(monday.getTime() + 7 * 86_400_000 - 1)
  return { start: monday, end: sunday }
}

export const sendDigestNow = createServerFn({ method: 'POST' }).handler(async () => {
  const session = await auth.api.getSession({ headers: getRequest().headers })
  if (!session?.user) throw new Error('Unauthorized')
  assertNotDemo(session.user)
  const userId = session.user.id
  const isoWeek = currentIsoWeek()

  // Find or create digest_run for (userId, isoWeek)
  let run = await db.query.digestRun.findFirst({
    where: and(eq(digestRun.userId, userId), eq(digestRun.isoWeek, isoWeek)),
  })

  if (!run || run.status === 'failed' || run.status === 'pending') {
    // Compose now (synchronously) to stamp the row, then enqueue send
    const facts = await buildDigestFacts(db, userId, isoWeek)
    const composed = await composeDigest(facts)
    const { start, end } = parseIsoWeek(isoWeek)

    if (!run) {
      const [inserted] = await db.insert(digestRun).values({
        userId,
        isoWeek,
        periodStart: start,
        periodEnd: end,
        status: 'composed',
        narrative: composed.narrative as Record<string, unknown>,
        tokensIn: composed.tokensIn,
        tokensOut: composed.tokensOut,
        errorMessage: composed.failed ? (composed.error ?? null) : null,
      }).returning()
      run = inserted
    } else {
      await db.update(digestRun).set({
        status: 'composed',
        narrative: composed.narrative as Record<string, unknown>,
        tokensIn: composed.tokensIn,
        tokensOut: composed.tokensOut,
        errorMessage: composed.failed ? (composed.error ?? null) : null,
      }).where(eq(digestRun.id, run.id))
      // Re-fetch the updated row so run reflects the new state
      run = await db.query.digestRun.findFirst({
        where: eq(digestRun.id, run.id),
      })
    }
  }

  if (!run) throw new Error('Could not locate digest run')

  // Enqueue the send event (sendDigestFn handles idempotent state transition + email)
  await sendDigestSend({ userId, digestRunId: run.id })

  return { digestRunId: run.id, enqueued: true }
})
