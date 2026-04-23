import { describe, it, expect } from 'vitest'
import { matchPositionsToPlans } from '~/planMatcher/match'
import type { MatchCandidate, PlanCandidate } from '~/planMatcher/match'

const BASE_TIME = new Date('2024-01-10T12:00:00Z')
const ms = (h: number) => h * 60 * 60_000

function makePosition(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    positionId: 'pos_1',
    symbol: 'BTC',
    side: 'long',
    openedAt: BASE_TIME,
    ...overrides,
  }
}

function makePlan(overrides: Partial<PlanCandidate> = {}): PlanCandidate {
  return {
    id: 'plan_1',
    symbol: 'BTC',
    intendedSide: 'long',
    // Created 1 hour before position opened — within window
    createdAt: new Date(BASE_TIME.getTime() - ms(1)),
    archivedAt: null,
    linkedPositionId: null,
    ...overrides,
  }
}

describe('matchPositionsToPlans', () => {
  it('single matching candidate produces a match', () => {
    const positions = [makePosition()]
    const plans = [makePlan()]
    const results = matchPositionsToPlans(positions, plans)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({ positionId: 'pos_1', planId: 'plan_1' })
  })

  it('zero candidates — position is skipped', () => {
    const positions = [makePosition({ symbol: 'ETH' })]
    const plans = [makePlan({ symbol: 'BTC' })]
    const results = matchPositionsToPlans(positions, plans)
    expect(results).toHaveLength(0)
  })

  it('two plans on same symbol+side — ambiguous, position skipped', () => {
    const positions = [makePosition()]
    const plans = [
      makePlan({ id: 'plan_1' }),
      makePlan({ id: 'plan_2' }),
    ]
    const results = matchPositionsToPlans(positions, plans)
    expect(results).toHaveLength(0)
  })

  it('two plans on different symbols — each position matched correctly', () => {
    const positions = [
      makePosition({ positionId: 'pos_btc', symbol: 'BTC' }),
      makePosition({ positionId: 'pos_eth', symbol: 'ETH', side: 'short' }),
    ]
    const plans = [
      makePlan({ id: 'plan_btc', symbol: 'BTC', intendedSide: 'long' }),
      makePlan({ id: 'plan_eth', symbol: 'ETH', intendedSide: 'short' }),
    ]
    const results = matchPositionsToPlans(positions, plans)
    expect(results).toHaveLength(2)
    expect(results.find((r) => r.positionId === 'pos_btc')?.planId).toBe('plan_btc')
    expect(results.find((r) => r.positionId === 'pos_eth')?.planId).toBe('plan_eth')
  })

  it('archived plan is ignored', () => {
    const positions = [makePosition()]
    const plans = [makePlan({ archivedAt: new Date() })]
    const results = matchPositionsToPlans(positions, plans)
    expect(results).toHaveLength(0)
  })

  it('already-linked plan is ignored', () => {
    const positions = [makePosition()]
    const plans = [makePlan({ linkedPositionId: 'some_other_pos' })]
    const results = matchPositionsToPlans(positions, plans)
    expect(results).toHaveLength(0)
  })

  it('plan created 72h before position — out of window, ignored', () => {
    const positions = [makePosition()]
    const plans = [makePlan({ createdAt: new Date(BASE_TIME.getTime() - ms(72)) })]
    const results = matchPositionsToPlans(positions, plans)
    expect(results).toHaveLength(0)
  })

  it('plan created 24h after position — out of window (limit is 12h after), ignored', () => {
    const positions = [makePosition()]
    const plans = [makePlan({ createdAt: new Date(BASE_TIME.getTime() + ms(24)) })]
    const results = matchPositionsToPlans(positions, plans)
    expect(results).toHaveLength(0)
  })

  it('two positions competing for same plan — only first position claims it', () => {
    const openedAt1 = BASE_TIME
    const openedAt2 = new Date(BASE_TIME.getTime() + ms(1))
    const positions = [
      makePosition({ positionId: 'pos_1', openedAt: openedAt1 }),
      makePosition({ positionId: 'pos_2', openedAt: openedAt2 }),
    ]
    // One plan that fits both positions' windows
    const plans = [makePlan({ id: 'plan_1', createdAt: new Date(openedAt1.getTime() - ms(1)) })]
    const results = matchPositionsToPlans(positions, plans)
    expect(results).toHaveLength(1)
    expect(results[0]?.positionId).toBe('pos_1')
    expect(results[0]?.planId).toBe('plan_1')
  })
})
