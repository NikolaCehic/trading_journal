import { cron } from 'inngest'
import { inngest } from './client'
import { db } from '~/db/client'
import { user } from '~/db/schema/auth'
import { digestRun } from '~/db/schema/narrator'
import { and, eq } from 'drizzle-orm'
import { buildDigestFacts } from '~/narrator/facts/digestFacts'
import { composeDigest } from '~/narrator/compose'
import { renderDigestEmail } from '~/narrator/email/render'
import { sendDigestEmail } from '~/narrator/email/send'
import type { DigestNarrative } from '~/narrator/schemas'
import type { DigestComposePayload, DigestSendPayload } from './events'
import { sendDigestCompose, sendDigestSend } from './events'
import { log } from '~/lib/log'

// ---------------------------------------------------------------------------
// ISO week helpers (no external deps)
// ---------------------------------------------------------------------------

/**
 * Parse an ISO week string like "2026-W17" into the Monday 00:00:00 UTC Date
 * and the Sunday 23:59:59.999 UTC Date for that week.
 */
function parseIsoWeek(isoWeek: string): { start: Date; end: Date } {
  const m = /^(\d{4})-W(\d{2})$/.exec(isoWeek)
  if (!m) throw new Error(`Invalid ISO week: ${isoWeek}`)
  const year = parseInt(m[1]!, 10)
  const week = parseInt(m[2]!, 10)

  // Jan 4th is always in week 1 per ISO 8601
  const jan4 = Date.UTC(year, 0, 4)
  // Day-of-week for Jan 4 (0=Sun, normalised to 1=Mon .. 7=Sun)
  const jan4Dow = new Date(jan4).getUTCDay() || 7
  // Monday of week 1
  const week1Mon = jan4 - (jan4Dow - 1) * 86_400_000
  const monday = new Date(week1Mon + (week - 1) * 7 * 86_400_000)
  const sunday = new Date(monday.getTime() + 7 * 86_400_000 - 1)
  return { start: monday, end: sunday }
}

/**
 * Return the ISO week string for the current UTC date.
 * Result format: "YYYY-Www"
 */
function currentIsoWeek(): string {
  const now = new Date()
  const year = now.getUTCFullYear()

  // Jan 4th is always in week 1
  const jan4 = Date.UTC(year, 0, 4)
  const jan4Dow = new Date(jan4).getUTCDay() || 7
  const week1Mon = jan4 - (jan4Dow - 1) * 86_400_000

  // Monday of current week (floor to Monday)
  const dayOfWeek = now.getUTCDay() || 7 // 0=Sun → 7
  const thisMonday = new Date(now.getTime() - (dayOfWeek - 1) * 86_400_000)
  thisMonday.setUTCHours(0, 0, 0, 0)

  let week = Math.round((thisMonday.getTime() - week1Mon) / (7 * 86_400_000)) + 1

  // Handle week belonging to previous year
  if (week < 1) {
    const prevYear = year - 1
    const pjan4 = Date.UTC(prevYear, 0, 4)
    const pjan4Dow = new Date(pjan4).getUTCDay() || 7
    const pWeek1Mon = pjan4 - (pjan4Dow - 1) * 86_400_000
    week = Math.round((thisMonday.getTime() - pWeek1Mon) / (7 * 86_400_000)) + 1
    return `${prevYear}-W${String(week).padStart(2, '0')}`
  }

  return `${year}-W${String(week).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// A) digestWeeklyScheduler — daily cron, fans out on Sundays
// ---------------------------------------------------------------------------

export const digestWeeklyScheduler = inngest.createFunction(
  {
    id: 'digest-weekly-scheduler',
    name: 'Digest Weekly Scheduler',
    triggers: [cron('0 22 * * *')],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    // Guard: only proceed on Sundays (UTC)
    if (new Date().getUTCDay() !== 0) {
      log.info('digest-scheduler: skipping — not Sunday')
      return { skipped: true, reason: 'not_sunday' }
    }

    const isoWeek = await step.run('compute-iso-week', () => {
      const week = currentIsoWeek()
      log.info('digest-scheduler: computed iso week', { isoWeek: week })
      return week
    })

    const users = await step.run('select-users', async () => {
      const rows = await db.select({ id: user.id }).from(user)
      log.info('digest-scheduler: fetched users', { userCount: rows.length, isoWeek })
      return rows
    })

    await step.run('fan-out', async () => {
      for (const u of users) {
        await sendDigestCompose({ userId: u.id, isoWeek })
      }
      log.info('digest-scheduler: fanned out compose events', { userCount: users.length, isoWeek })
    })

    return { userCount: users.length, isoWeek }
  },
)

// ---------------------------------------------------------------------------
// B) composeDigestFn — triggered by digest/compose
// ---------------------------------------------------------------------------

export const composeDigestFn = inngest.createFunction(
  {
    id: 'compose-digest',
    name: 'Compose Digest',
    triggers: [{ event: 'digest/compose' }],
    concurrency: { limit: 5, key: 'event.data.userId' },
    retries: 2,
  },
  async ({ event, step }) => {
    const { userId, isoWeek } = event.data as DigestComposePayload['data']
    log.info('compose-digest: triggered', { userId, isoWeek })

    let digestRunId: string | undefined

    try {
      // Step 1: create or get existing run row
      const runRow = await step.run('create-or-get-run', async () => {
        const { start: periodStart, end: periodEnd } = parseIsoWeek(isoWeek)

        // Insert with conflict guard on (userId, isoWeek)
        await db.insert(digestRun)
          .values({ userId, isoWeek, status: 'pending', periodStart, periodEnd })
          .onConflictDoNothing({ target: [digestRun.userId, digestRun.isoWeek] })

        // Always fetch the canonical row
        const [row] = await db
          .select()
          .from(digestRun)
          .where(and(eq(digestRun.userId, userId), eq(digestRun.isoWeek, isoWeek)))

        if (!row) throw new Error(`digest_run row not found for userId=${userId} isoWeek=${isoWeek}`)
        log.info('compose-digest: run row', { digestRunId: row.id, status: row.status, userId, isoWeek })
        return row
      })

      digestRunId = runRow.id

      // Short-circuit if already composed or sent
      if (runRow.status === 'composed' || runRow.status === 'sent') {
        log.info('compose-digest: skipping — already composed', { digestRunId, status: runRow.status, userId, isoWeek })
        return { skipped: true, digestRunId, reason: 'already_composed' }
      }

      // Step 2: build facts
      const facts = await step.run('build-facts', () => {
        log.info('compose-digest: building facts', { userId, isoWeek, digestRunId })
        return buildDigestFacts(db, userId, isoWeek)
      })

      // Step 3: compose via LLM
      const result = await step.run('compose', () => {
        log.info('compose-digest: composing narrative', { userId, isoWeek, digestRunId })
        return composeDigest(facts)
      })

      // Step 4: persist narrative + token counts
      await step.run('persist', async () => {
        await db
          .update(digestRun)
          .set({
            status: 'composed',
            narrative: result.narrative as Record<string, unknown>,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
            errorMessage: result.failed ? (result.error ?? null) : null,
          })
          .where(eq(digestRun.id, digestRunId!))
        log.info('compose-digest: persisted', { digestRunId, failed: result.failed, tokensIn: result.tokensIn, tokensOut: result.tokensOut })
      })

      // Step 5: enqueue send
      await step.run('enqueue-send', () => {
        return sendDigestSend({ userId, digestRunId: digestRunId! })
      })

      log.info('compose-digest: complete', { digestRunId, userId, isoWeek, tokensIn: result.tokensIn, tokensOut: result.tokensOut, failed: result.failed })
      return { digestRunId, tokensIn: result.tokensIn, tokensOut: result.tokensOut, failed: result.failed }
    } catch (err) {
      log.error('compose-digest: error', { userId, isoWeek, digestRunId, error: String(err) })
      if (digestRunId) {
        await db
          .update(digestRun)
          .set({ status: 'failed', errorMessage: String(err) })
          .where(eq(digestRun.id, digestRunId))
          .catch(() => {/* best-effort */})
      }
      throw err
    }
  },
)

// ---------------------------------------------------------------------------
// C) sendDigestFn — triggered by digest/send
// ---------------------------------------------------------------------------

export const sendDigestFn = inngest.createFunction(
  {
    id: 'send-digest',
    name: 'Send Digest',
    triggers: [{ event: 'digest/send' }],
    concurrency: { limit: 5 },
    retries: 2,
  },
  async ({ event, step }) => {
    const { userId, digestRunId } = event.data as DigestSendPayload['data']
    log.info('send-digest: triggered', { userId, digestRunId })

    // Step 1: load run + user email
    const { run: run, userEmail } = await step.run('load-run', async () => {
      const [row] = await db
        .select({
          id: digestRun.id,
          userId: digestRun.userId,
          isoWeek: digestRun.isoWeek,
          status: digestRun.status,
          narrative: digestRun.narrative,
          tokensIn: digestRun.tokensIn,
          tokensOut: digestRun.tokensOut,
          errorMessage: digestRun.errorMessage,
          periodStart: digestRun.periodStart,
          periodEnd: digestRun.periodEnd,
          emailMessageId: digestRun.emailMessageId,
          sentAt: digestRun.sentAt,
          createdAt: digestRun.createdAt,
        })
        .from(digestRun)
        .where(eq(digestRun.id, digestRunId))

      if (!row) throw new Error(`digest_run not found: ${digestRunId}`)

      const [userRow] = await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, userId))

      if (!userRow) throw new Error(`User not found: ${userId}`)

      log.info('send-digest: loaded run', { digestRunId, status: row.status, userId })
      return { run: row, userEmail: userRow.email }
    })

    // Short-circuit if already sent
    if (run.status === 'sent') {
      log.info('send-digest: skipping — already sent', { digestRunId, userId })
      return { sent: true, digestRunId, skipped: true }
    }

    // Guard: must be in 'composed' state
    if (run.status !== 'composed') {
      throw new Error(`send-digest: not_composed — status=${run.status} digestRunId=${digestRunId}`)
    }

    // Step 2: rebuild facts (not persisted — rebuild is cheap)
    const facts = await step.run('rebuild-facts', () => {
      log.info('send-digest: rebuilding facts', { userId, isoWeek: run.isoWeek, digestRunId })
      return buildDigestFacts(db, userId, run.isoWeek)
    })

    // The narrative is stored as jsonb; cast to DigestNarrative
    const narrative = run.narrative as unknown as DigestNarrative

    // Step 3: render email
    const rendered = await step.run('render', () => {
      log.info('send-digest: rendering email', { digestRunId, userId })
      return renderDigestEmail(facts, narrative)
    })

    // Step 4: send email
    const sendResult = await step.run('send', () => {
      log.info('send-digest: sending email', { digestRunId, userId, to: userEmail })
      return sendDigestEmail(userEmail, rendered)
    })

    // Step 5: stamp sent/failed
    await step.run('stamp-sent', async () => {
      await db
        .update(digestRun)
        .set({
          status: sendResult.sent ? 'sent' : 'failed',
          emailMessageId: sendResult.sent ? sendResult.messageId : null,
          sentAt: new Date(),
          errorMessage: sendResult.sent
            ? null
            : ('error' in sendResult ? sendResult.error : sendResult.reason) ?? null,
        })
        .where(eq(digestRun.id, digestRunId))
      log.info('send-digest: stamped', { digestRunId, sent: sendResult.sent, userId })
    })

    log.info('send-digest: complete', { digestRunId, sent: sendResult.sent, userId })
    return { sent: sendResult.sent, digestRunId }
  },
)
