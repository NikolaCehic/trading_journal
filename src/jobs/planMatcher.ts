import { inngest } from './client'
import { db } from '~/db/client'
import { position } from '~/db/schema/derivation'
import { tradePlan } from '~/db/schema/journal'
import { and, eq, isNull, isNotNull } from 'drizzle-orm'
import { matchPositionsToPlans, type MatchCandidate, type PlanCandidate } from '~/planMatcher/match'
import { log } from '~/lib/log'

export const autoMatchPlansFn = inngest.createFunction(
  {
    id: 'plan-auto-match',
    name: 'Auto-match plans to positions',
    triggers: [{ event: 'plan/auto-match' }],
    concurrency: { limit: 3, key: 'event.data.userId' },
    retries: 2,
  },
  async ({ event, step }) => {
    const { userId } = event.data as { userId: string }

    // 1. Load unlinked closed positions (closedAt not null, no planId yet).
    //    Timestamps from neon-http arrive as strings — coerce to Date here so
    //    the pure matcher can call .getTime() on them.
    const positionRows = await step.run('fetch-positions', async () => {
      const rows = await db
        .select({
          id: position.id,
          symbol: position.symbol,
          side: position.side,
          openedAt: position.openedAt,
        })
        .from(position)
        .where(
          and(
            eq(position.userId, userId),
            isNull(position.planId),
            isNotNull(position.closedAt),
          ),
        )
        .limit(200)
      // Coerce string timestamps to Date before Inngest serialises the step result
      return rows.map((r) => ({ ...r, openedAt: new Date(r.openedAt) }))
    })

    if (positionRows.length === 0) {
      log.info('plan-auto-match: no unlinked positions', { userId })
      return { matched: 0 }
    }

    // 2. Load all the user's plans. Coerce timestamps to Date.
    const planRows = await step.run('fetch-plans', async () => {
      const rows = await db
        .select({
          id: tradePlan.id,
          symbol: tradePlan.symbol,
          intendedSide: tradePlan.intendedSide,
          createdAt: tradePlan.createdAt,
          archivedAt: tradePlan.archivedAt,
        })
        .from(tradePlan)
        .where(eq(tradePlan.userId, userId))
      return rows.map((r) => ({
        ...r,
        createdAt: new Date(r.createdAt),
        archivedAt: r.archivedAt ? new Date(r.archivedAt) : null,
      }))
    })

    if (planRows.length === 0) {
      log.info('plan-auto-match: no plans for user', { userId })
      return { matched: 0 }
    }

    // 3. Build the array of planIds that already have a linked position.
    //    We use a plain string[] instead of Set so Inngest can serialise the
    //    step result as JSON; we convert back to Set after the step.
    const linkedPlanIdList = await step.run('fetch-linked-plan-ids', async () => {
      const rows = await db
        .select({ planId: position.planId })
        .from(position)
        .where(and(eq(position.userId, userId), isNotNull(position.planId)))
      return rows.map((r) => r.planId!)
    })
    const linkedPlanIds = new Set<string>(linkedPlanIdList)

    const plans: PlanCandidate[] = planRows.map((p) => ({
      id: p.id,
      symbol: p.symbol,
      intendedSide: p.intendedSide,
      // step.run serialises to JSON, so dates arrive back as strings;
      // ensure they are Date objects (new Date(Date) is a no-op when already a Date)
      createdAt: new Date(p.createdAt),
      archivedAt: p.archivedAt ? new Date(p.archivedAt) : null,
      linkedPositionId: linkedPlanIds.has(p.id) ? 'linked' : null,
    }))

    const candidates: MatchCandidate[] = positionRows.map((p) => ({
      positionId: p.id,
      symbol: p.symbol,
      side: p.side,
      openedAt: new Date(p.openedAt),
    }))

    // 4. Run the pure matcher
    const matches = matchPositionsToPlans(candidates, plans)

    if (matches.length === 0) {
      log.info('plan-auto-match: no matches found', {
        userId,
        candidatePositions: candidates.length,
        plans: plans.length,
      })
      return { matched: 0 }
    }

    // 5. Apply each match: write position.planId + snapshot columns
    for (const m of matches) {
      await step.run(`match-${m.positionId}`, async () => {
        const [plan] = await db
          .select()
          .from(tradePlan)
          .where(eq(tradePlan.id, m.planId))
          .limit(1)
        if (!plan) return // plan removed between fetch and apply — skip

        await db
          .update(position)
          .set({
            planId: m.planId,
            planSnapshotEntryPrice: plan.entryPrice,
            planSnapshotStopPrice: plan.stopPrice,
            planSnapshotTargetPrice: plan.targetPrice,
            planSnapshotSize: plan.plannedSize,
            planSnapshotRationale: plan.rationale,
          })
          .where(and(eq(position.id, m.positionId), eq(position.userId, userId)))
      })
    }

    log.info('plan-auto-match: complete', { userId, matched: matches.length })
    return { matched: matches.length }
  },
)
