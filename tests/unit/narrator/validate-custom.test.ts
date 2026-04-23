import { describe, it, expect } from 'vitest'
import { validateDigestNarrative, validateCoachNarrative } from '~/narrator/validate'
import type { DigestFactBundle, CoachFactBundle } from '~/narrator/facts/types'

// ---------------------------------------------------------------------------
// Tests: custom: detectorId grounding
// ---------------------------------------------------------------------------

const CUSTOM_FIND_ID = 'find-custom-aaa-bbb'
const POS_ID = 'pos-custom-ccc-ddd'

const digestFactsWithCustom: DigestFactBundle = {
  user: { id: 'user_2', email: 'trader@example.com' },
  isoWeek: '2026-W17',
  period: { start: '2026-04-20T00:00:00.000Z', end: '2026-04-26T23:59:59.999Z' },
  summary: {
    totalPnl: 50,
    grossProfit: 50,
    grossLoss: 0,
    totalFees: 2,
    winRate: 1,
    expectancy: 50,
    avgWin: 50,
    avgLoss: 0,
    profitFactor: null,
    maxDrawdown: 0,
    tradeCount: 1,
    medianPositionSizeUsd: 1000,
  },
  priorSummary: null,
  biggestWin: null,
  biggestLoss: null,
  topFinding: {
    findingId: CUSTOM_FIND_ID,
    detectorId: 'custom:det_abc',
    severity: 'warning',
    evidence: { userDetectorId: 'det_abc', detectorName: 'My custom detector' },
    referencedPositionIds: [POS_ID],
  },
  activeRules: [],
  allowedPositionIds: [POS_ID],
  allowedFindingIds: [CUSTOM_FIND_ID],
}

const coachFactsWithCustom: CoachFactBundle = {
  userId: 'user_2',
  position: {
    id: POS_ID,
    symbol: 'SOL',
    side: 'long',
    instrumentType: 'perp',
    entryAvg: 100,
    exitAvg: 150,
    size: 1,
    realizedPnl: 50,
    rMultiple: 1.0,
    durationMinutes: 60,
  },
  fills: [],
  thisPositionFindings: [
    { findingId: CUSTOM_FIND_ID, detectorId: 'custom:det_abc', severity: 'warning' },
  ],
  recentPatternMatches: [],
  userBaselines: { medianR: 0.5, winRate: 0.6, avgDurationMinutes: 90 },
  allowedPositionIds: [POS_ID],
  allowedFindingIds: [CUSTOM_FIND_ID],
}

describe('validateDigestNarrative — custom: detectorId', () => {
  it('accepts a narrative whose topFinding references a custom: findingId that is in the allowlist', () => {
    const narrative = {
      greeting: 'You traded 1 time this week.',
      biggestWin: null,
      biggestLoss: null,
      topFinding: { findingId: CUSTOM_FIND_ID, prose: 'A custom detector flagged this position.' },
      oneThingToTry: null,
      suggestedRule: null,
    }
    const result = validateDigestNarrative(narrative, digestFactsWithCustom)
    expect(result.ok).toBe(true)
  })

  it('rejects a narrative whose topFinding references a custom: findingId NOT in the allowlist', () => {
    const narrative = {
      greeting: 'You traded 1 time this week.',
      biggestWin: null,
      biggestLoss: null,
      topFinding: { findingId: 'find-custom-not_in_facts', prose: 'A detector fired.' },
      oneThingToTry: null,
      suggestedRule: null,
    }
    const result = validateDigestNarrative(narrative, digestFactsWithCustom)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('ungrounded_id')
    expect(result.ok === false && result.offendingText).toBe('find-custom-not_in_facts')
  })

  it('accepts a suggestedRule with a custom: detectorId string without grounding rejection', () => {
    const narrative = {
      greeting: 'You traded 1 time this week.',
      biggestWin: null,
      biggestLoss: null,
      topFinding: { findingId: CUSTOM_FIND_ID, prose: 'Custom detector finding prose.' },
      oneThingToTry: null,
      suggestedRule: { detectorId: 'custom:det_abc', ruleText: 'Pause after a custom alert fires.' },
    }
    const result = validateDigestNarrative(narrative, digestFactsWithCustom)
    expect(result.ok).toBe(true)
  })
})

describe('validateCoachNarrative — custom: detectorId', () => {
  it('accepts coach narrative referencing a custom: findingId that is in the allowlist', () => {
    const narrative = {
      gradeLetter: 'B' as const,
      prose: 'Entry at $100 was measured; exit at $150 captured 1 full R.',
      referencedPositionIds: [POS_ID],
      referencedFindingIds: [CUSTOM_FIND_ID],
    }
    const result = validateCoachNarrative(narrative, coachFactsWithCustom)
    expect(result.ok).toBe(true)
  })
})
