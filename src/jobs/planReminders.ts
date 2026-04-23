import { cron } from 'inngest'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { inngest } from './client'
import { db } from '~/db/client'
import { user } from '~/db/schema/auth'
import { tradePlan } from '~/db/schema/journal'
import { position } from '~/db/schema/derivation'
import { renderPlanReminderEmail, type StalePlanRow } from '~/narrator/email/planReminder'
import { sendDigestEmail } from '~/narrator/email/send'
import { log } from '~/lib/log'

// ---------------------------------------------------------------------------
// Timezone helper — true when `now` falls in the 18:00 hour for the given tz
// ---------------------------------------------------------------------------

function isLocal18(now: Date, tz: string): boolean {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(now)
    const hour = parts.find(p => p.type === 'hour')?.value
    return hour === '18'
  } catch {
    return false // invalid tz → skip
  }
}

// ---------------------------------------------------------------------------
// A) planReminderScheduler — hourly cron, fans out to users at local 18:00
// ---------------------------------------------------------------------------

export const planReminderScheduler = inngest.createFunction(
  {
    id: 'plan-reminder-scheduler',
    name: 'Plan reminder scheduler (hourly fan-out at local 18:00)',
    triggers: [cron('0 * * * *')],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    const now = new Date()

    const users = await step.run('select-users', async () => {
      const rows = await db
        .select({
          id: user.id,
          email: user.email,
          timezone: user.timezone,
          digestEnabled: user.digestEnabled,
          isDemo: user.isDemo,
        })
        .from(user)
        .where(and(eq(user.isDemo, false), eq(user.digestEnabled, true)))
      log.info('plan-reminder-scheduler: fetched users', { userCount: rows.length })
      return rows
    })

    const dueUsers = users.filter(u => isLocal18(now, u.timezone))

    if (dueUsers.length === 0) {
      log.info('plan-reminder-scheduler: skipping — no users at local 18:00')
      return { skipped: true, reason: 'no_users_at_local_18' }
    }

    for (const u of dueUsers) {
      await step.run(`enqueue-${u.id}`, () =>
        inngest.send({ name: 'plan-reminder/send', data: { userId: u.id } }),
      )
    }

    log.info('plan-reminder-scheduler: fanned out', { userCount: dueUsers.length })
    return { enqueued: dueUsers.length }
  },
)

// ---------------------------------------------------------------------------
// B) sendPlanReminderFn — triggered by plan-reminder/send
// ---------------------------------------------------------------------------

export const sendPlanReminderFn = inngest.createFunction(
  {
    id: 'plan-reminder-send',
    name: 'Send plan reminder email',
    triggers: [{ event: 'plan-reminder/send' }],
    concurrency: { limit: 5, key: 'event.data.userId' },
    retries: 2,
  },
  async ({ event, step }) => {
    const { userId } = event.data as { userId: string }

    // 1. Load user
    const [u] = await db
      .select({
        id: user.id,
        email: user.email,
        digestEnabled: user.digestEnabled,
        isDemo: user.isDemo,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)

    if (!u || !u.digestEnabled || u.isDemo) {
      log.info('plan-reminder-send: skipped — user unavailable', { userId })
      return { skipped: true, reason: 'user_unavailable' }
    }

    // 2. Find stale plans
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000)

    const stalePlanRows = await step.run('find-stale', async () => {
      // unarchived, older than 7d, not reminded in last 7d
      const plans = await db
        .select({
          id: tradePlan.id,
          symbol: tradePlan.symbol,
          intendedSide: tradePlan.intendedSide,
          createdAt: tradePlan.createdAt,
          reminderSentAt: tradePlan.reminderSentAt,
        })
        .from(tradePlan)
        .where(
          and(
            eq(tradePlan.userId, userId),
            isNull(tradePlan.archivedAt),
            lt(tradePlan.createdAt, sevenDaysAgo),
            or(isNull(tradePlan.reminderSentAt), lt(tradePlan.reminderSentAt, sevenDaysAgo)),
          ),
        )

      if (plans.length === 0) return []

      // Filter out plans that have any linked position
      const linked = await db
        .select({ planId: position.planId })
        .from(position)
        .where(eq(position.userId, userId))

      const linkedSet = new Set(
        linked.filter(r => r.planId != null).map(r => r.planId!),
      )

      return plans.filter(p => !linkedSet.has(p.id))
    })

    if (stalePlanRows.length === 0) {
      log.info('plan-reminder-send: skipped — no stale plans', { userId })
      return { skipped: true, reason: 'no_stale_plans' }
    }

    // 3. Render + send
    const rendered = renderPlanReminderEmail(userId, stalePlanRows as unknown as StalePlanRow[])

    const sendResult = await step.run('send', () =>
      sendDigestEmail(u.email, rendered),
    )

    // 4. Stamp reminderSentAt on each plan when email was sent
    if (sendResult.sent) {
      const now = new Date()
      for (const p of stalePlanRows) {
        await db
          .update(tradePlan)
          .set({ reminderSentAt: now })
          .where(eq(tradePlan.id, p.id))
      }
    }

    log.info('plan-reminder-send: complete', {
      userId,
      count: stalePlanRows.length,
      sent: sendResult.sent,
    })

    return { sent: sendResult.sent, count: stalePlanRows.length }
  },
)
