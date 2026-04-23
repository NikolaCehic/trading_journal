import { describe, it, expect } from 'vitest'
import { validateDigestNarrative, validateCoachNarrative } from '~/narrator/validate'
import type { DigestFactBundle, CoachFactBundle } from '~/narrator/facts/types'

// ---------------------------------------------------------------------------
// Minimal fact fixtures (inline, no real DB)
// ---------------------------------------------------------------------------

const POS_ID = 'pos-aaaa-bbbb-cccc-dddd'
const FIND_ID = 'find-1111-2222-3333-4444'

const digestFacts: DigestFactBundle = {
  user: { id: 'user_1', email: 'trader@example.com' },
  isoWeek: '2026-W17',
  period: { start: '2026-04-20T00:00:00.000Z', end: '2026-04-26T23:59:59.999Z' },
  summary: {
    totalPnl: 120,
    grossProfit: 200,
    grossLoss: -80,
    totalFees: 5,
    winRate: 0.67,
    expectancy: 40,
    avgWin: 100,
    avgLoss: -80,
    profitFactor: 2.5,
    maxDrawdown: 80,
    tradeCount: 3,
    medianPositionSizeUsd: 4000,
  },
  priorSummary: null,
  biggestWin: {
    positionId: POS_ID,
    symbol: 'BTC',
    side: 'long',
    realizedPnl: 150,
    rMultiple: 1.5,
  },
  biggestLoss: null,
  topFinding: {
    findingId: FIND_ID,
    detectorId: 'revenge_trading',
    severity: 'warning',
    evidence: {},
    referencedPositionIds: [POS_ID],
  },
  activeRules: [],
  allowedPositionIds: [POS_ID],
  allowedFindingIds: [FIND_ID],
}

const COACH_POS_ID = 'cpos-aaaa-bbbb-cccc-dddd'
const COACH_FIND_ID = 'cfind-1111-2222-3333-4444'

const coachFacts: CoachFactBundle = {
  userId: 'user_1',
  position: {
    id: COACH_POS_ID,
    symbol: 'ETH',
    side: 'long',
    instrumentType: 'perp',
    entryAvg: 2000,
    exitAvg: 2100,
    size: 1,
    realizedPnl: 100,
    rMultiple: 1.0,
    durationMinutes: 90,
  },
  fills: [
    {
      id: 'fill_1',
      side: 'buy',
      price: 2000,
      size: 1,
      fee: 2,
      executedAt: '2026-04-21T09:00:00.000Z',
    },
    {
      id: 'fill_2',
      side: 'sell',
      price: 2100,
      size: 1,
      fee: 2.1,
      executedAt: '2026-04-21T10:30:00.000Z',
    },
  ],
  thisPositionFindings: [
    { findingId: COACH_FIND_ID, detectorId: 'oversized_positions', severity: 'warning' },
  ],
  recentPatternMatches: [],
  userBaselines: { medianR: 0.5, winRate: 0.6, avgDurationMinutes: 120 },
  allowedPositionIds: [COACH_POS_ID],
  allowedFindingIds: [COACH_FIND_ID],
}

// ---------------------------------------------------------------------------
// Helpers to build minimal valid narratives
// ---------------------------------------------------------------------------

function validDigest() {
  // Numbers used here must appear verbatim in digestFacts above.
  // 3  → summary.tradeCount
  // $150 → biggestWin.realizedPnl (150)
  // 0.67 → summary.winRate
  return {
    greeting: 'You traded 3 times this week with a win rate of 0.67.',
    biggestWin: { positionId: POS_ID, prose: 'The BTC long netted $150.' },
    biggestLoss: null,
    topFinding: { findingId: FIND_ID, prose: 'The revenge trading finding fired once this period.' },
    oneThingToTry: 'Pause before each entry and verify the setup.',
    suggestedRule: { detectorId: 'revenge_trading', ruleText: 'No re-entry after a loss without a setup check.' },
  }
}

function validCoach() {
  return {
    gradeLetter: 'B' as const,
    prose: 'Entry at $2000 was disciplined; exit at $2100 was rushed versus the 90-minute hold.',
    referencedPositionIds: [COACH_POS_ID],
    referencedFindingIds: [COACH_FIND_ID],
  }
}

// ---------------------------------------------------------------------------
// Digest tests
// ---------------------------------------------------------------------------

describe('validateDigestNarrative', () => {
  it('accepts a fully valid narrative with grounded IDs and numbers', () => {
    const result = validateDigestNarrative(validDigest(), digestFacts)
    expect(result.ok).toBe(true)
  })

  it('rejects when a required field is missing (schema failure)', () => {
    const bad = { ...validDigest() }
    // @ts-expect-error intentional bad input
    delete bad.greeting
    const result = validateDigestNarrative(bad, digestFacts)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/^schema:/)
  })

  it('rejects a fabricated positionId not in allowlist', () => {
    const bad = {
      ...validDigest(),
      biggestWin: { positionId: 'fake-id-not-in-allowlist', prose: 'BTC long netted $150.' },
    }
    const result = validateDigestNarrative(bad, digestFacts)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('ungrounded_id')
    expect(result.ok === false && result.offendingText).toBe('fake-id-not-in-allowlist')
  })

  it('rejects a fabricated findingId not in allowlist', () => {
    const bad = {
      ...validDigest(),
      topFinding: { findingId: 'fake-finding-xyz', prose: 'Some finding prose.' },
    }
    const result = validateDigestNarrative(bad, digestFacts)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('ungrounded_id')
    expect(result.ok === false && result.offendingText).toBe('fake-finding-xyz')
  })

  it('rejects a fabricated number not present in facts', () => {
    const bad = {
      ...validDigest(),
      greeting: 'You made $999 this week.',
    }
    const result = validateDigestNarrative(bad, digestFacts)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('ungrounded_number')
    expect(result.ok === false && result.offendingText).toContain('999')
  })

  it('rejects banned voice word "great"', () => {
    const bad = {
      ...validDigest(),
      greeting: 'great trading this week.',
    }
    const result = validateDigestNarrative(bad, digestFacts)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('banned_voice')
    expect(result.ok === false && result.offendingText).toBe('great')
  })

  it('rejects banned phrase "nice work" regardless of casing', () => {
    const bad = {
      ...validDigest(),
      oneThingToTry: 'Nice Work on your exits this week.',
    }
    const result = validateDigestNarrative(bad, digestFacts)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('banned_voice')
  })
})

// ---------------------------------------------------------------------------
// Coach tests
// ---------------------------------------------------------------------------

describe('validateCoachNarrative', () => {
  it('accepts a fully valid coach narrative', () => {
    const result = validateCoachNarrative(validCoach(), coachFacts)
    expect(result.ok).toBe(true)
  })

  it('rejects when gradeLetter is missing (schema failure)', () => {
    const bad = { ...validCoach() }
    // @ts-expect-error intentional bad input
    delete bad.gradeLetter
    const result = validateCoachNarrative(bad, coachFacts)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/^schema:/)
  })

  it('rejects an invalid grade letter (schema failure)', () => {
    const bad = { ...validCoach(), gradeLetter: 'Z' as never }
    const result = validateCoachNarrative(bad, coachFacts)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/^schema:/)
  })

  it('rejects a fabricated positionId in referencedPositionIds', () => {
    const bad = {
      ...validCoach(),
      referencedPositionIds: ['not-in-allowlist'],
    }
    const result = validateCoachNarrative(bad, coachFacts)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('ungrounded_id')
    expect(result.ok === false && result.offendingText).toBe('not-in-allowlist')
  })

  it('rejects a fabricated number in prose', () => {
    const bad = {
      ...validCoach(),
      prose: 'Entry at $2000 was fine but you risked $88888 more than needed.',
    }
    const result = validateCoachNarrative(bad, coachFacts)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('ungrounded_number')
  })

  it('rejects banned voice in prose', () => {
    const bad = {
      ...validCoach(),
      prose: 'Amazing work — you made $100 on the ETH long.',
    }
    const result = validateCoachNarrative(bad, coachFacts)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('banned_voice')
    expect(result.ok === false && result.offendingText).toBe('amazing')
  })
})
