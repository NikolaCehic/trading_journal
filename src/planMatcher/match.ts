export type MatchCandidate = {
  positionId: string
  symbol: string
  side: 'long' | 'short'
  openedAt: Date
}

export type PlanCandidate = {
  id: string
  symbol: string
  intendedSide: 'long' | 'short'
  createdAt: Date
  archivedAt: Date | null
  linkedPositionId: string | null // null = unlinked
}

export type MatchResult = {
  positionId: string
  planId: string
}

/**
 * Match each unlinked closed position to exactly one unarchived, unlinked plan
 * on same symbol + side where the plan was created within [position.openedAt − 48h, position.openedAt + 12h].
 * Skip if zero or multiple plans match.
 */
export function matchPositionsToPlans(
  positions: MatchCandidate[],
  plans: PlanCandidate[],
): MatchResult[] {
  const claimedPlanIds = new Set<string>()
  const results: MatchResult[] = []

  for (const pos of positions) {
    const candidates = plans.filter(
      (p) =>
        !p.archivedAt &&
        !p.linkedPositionId &&
        !claimedPlanIds.has(p.id) &&
        p.symbol === pos.symbol &&
        p.intendedSide === pos.side &&
        p.createdAt.getTime() >= pos.openedAt.getTime() - 48 * 60 * 60_000 &&
        p.createdAt.getTime() <= pos.openedAt.getTime() + 12 * 60 * 60_000,
    )

    if (candidates.length === 1) {
      const plan = candidates[0]!
      claimedPlanIds.add(plan.id)
      results.push({ positionId: pos.positionId, planId: plan.id })
    }
    // Skip zero-match and multi-match positions (user handles manually)
  }

  return results
}
