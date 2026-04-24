import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '~/auth/server'
import { assertNotDemo } from '~/auth/assertNotDemo'
import { db } from '~/db/client'
import { digestRule } from '~/db/schema/narrator'
import { finding } from '~/db/schema/derivation'
import { DERIVATION_VERSION } from '~/derivation/version'

const detectorIdSchema = z.string().min(1)

// ---------------------------------------------------------------------------
// adoptRule — idempotent upsert for a user rule
// ---------------------------------------------------------------------------
export const adoptRule = createServerFn({ method: 'POST' })
  .inputValidator((v: unknown) =>
    z.object({
      detectorId: detectorIdSchema,
      ruleText: z.string().min(1).max(180),
    }).parse(v),
  )
  .handler(async ({ data }) => {
    const user = await requireSessionUser()
    assertNotDemo(user)
    const userId = user.id

    // Idempotent: check for existing active rule for this detector
    const [existing] = await db
      .select()
      .from(digestRule)
      .where(and(eq(digestRule.userId, userId), eq(digestRule.detectorId, data.detectorId)))
      .limit(1)

    if (existing) {
      return {
        ruleId: existing.id,
        ruleText: existing.ruleText,
        createdAt: existing.createdAt.toISOString(),
      }
    }

    const [row] = await db
      .insert(digestRule)
      .values({
        userId,
        detectorId: data.detectorId,
        ruleText: data.ruleText,
      })
      .returning()

    return {
      ruleId: row!.id,
      ruleText: row!.ruleText,
      createdAt: row!.createdAt.toISOString(),
    }
  })

// ---------------------------------------------------------------------------
// archiveRule — soft-delete a rule by id (ownership checked)
// ---------------------------------------------------------------------------
export const archiveRule = createServerFn({ method: 'POST' })
  .inputValidator((v: unknown) => z.object({ ruleId: z.string().min(1) }).parse(v))
  .handler(async ({ data }) => {
    const user = await requireSessionUser()
    assertNotDemo(user)
    const userId = user.id
    await db
      .update(digestRule)
      .set({ archivedAt: new Date() })
      .where(and(eq(digestRule.id, data.ruleId), eq(digestRule.userId, userId)))
    return { ruleId: data.ruleId, archived: true }
  })

// ---------------------------------------------------------------------------
// getRuleViolationsThisWeek — count distinct positions in the current ISO week
// that appear in findings referencing this detectorId
// ---------------------------------------------------------------------------
export const getRuleViolationsThisWeek = createServerFn({ method: 'GET' })
  .inputValidator((v: unknown) => z.object({ ruleId: z.string().min(1) }).parse(v))
  .handler(async ({ data }) => {
    const userId = await requireUserId()

    const [rule] = await db
      .select()
      .from(digestRule)
      .where(and(eq(digestRule.id, data.ruleId), eq(digestRule.userId, userId)))
      .limit(1)

    if (!rule) throw new Error('not_found')

    const { start, end } = currentWeekRange()

    // Fetch all findings for this user+detectorId, filter to current week by periodStart
    const rows = await db
      .select({
        ids: finding.referencedPositionIds,
        periodStart: finding.periodStart,
      })
      .from(finding)
      .where(
        and(
          eq(finding.userId, userId),
          eq(finding.detectorId, rule.detectorId),
          eq(finding.derivationVersion, DERIVATION_VERSION),
        ),
      )

    const unique = new Set<string>()
    for (const r of rows) {
      if (!r.periodStart) continue
      if (r.periodStart < start || r.periodStart > end) continue
      for (const id of r.ids ?? []) unique.add(id)
    }

    return { violations: unique.size, ruleId: rule.id }
  })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireUserId(): Promise<string> {
  const req = getRequest()
  const s = await auth.api.getSession({ headers: req.headers })
  if (!s?.user) throw new Error('unauthorized')
  return s.user.id
}

async function requireSessionUser() {
  const req = getRequest()
  const s = await auth.api.getSession({ headers: req.headers })
  if (!s?.user) throw new Error('unauthorized')
  return s.user
}

function currentWeekRange(): { start: Date; end: Date } {
  const now = new Date()
  const day = now.getUTCDay() || 7 // ISO: Mon=1..Sun=7
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 1, 0, 0, 0, 0),
  )
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1)
  return { start, end }
}
