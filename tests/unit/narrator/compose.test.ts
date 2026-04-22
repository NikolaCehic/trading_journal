import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DigestFactBundle, CoachFactBundle } from '~/narrator/facts/types'
import type { DigestNarrative, CoachNarrative } from '~/narrator/schemas'
import { digestFallback, coachFallback } from '~/narrator/fallback'

// ---------------------------------------------------------------------------
// Mock the LLM client — no network in tests
// ---------------------------------------------------------------------------

const mockCallLlm = vi.fn()

vi.mock('~/narrator/client', () => ({
  callLlm: (...args: unknown[]) => mockCallLlm(...args),
}))

// ---------------------------------------------------------------------------
// Mock the env module so we can toggle AI_ENABLED per-test
// ---------------------------------------------------------------------------

let mockAiEnabled: 'on' | 'off' = 'on'

vi.mock('~/lib/env', () => ({
  env: new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'AI_ENABLED') return mockAiEnabled
        if (prop === 'ANTHROPIC_API_KEY') return 'test-key'
        return undefined
      },
    },
  ),
}))

// Import compose AFTER mocks are set up
import { composeDigest, composeCoach } from '~/narrator/compose'

// ---------------------------------------------------------------------------
// Fixtures
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
// Valid narrative fixtures — all numbers grounded in facts, no banned words
// ---------------------------------------------------------------------------

function validDigestNarrative(): DigestNarrative {
  return {
    greeting: 'You traded 3 times this week with a win rate of 0.67.',
    biggestWin: { positionId: POS_ID, prose: 'The BTC long netted $150.' },
    biggestLoss: null,
    topFinding: {
      findingId: FIND_ID,
      prose: 'The revenge trading finding fired once this period.',
    },
    oneThingToTry: 'Pause before each entry and verify the setup.',
    suggestedRule: {
      detectorId: 'revenge_trading',
      ruleText: 'No re-entry after a loss without a setup check.',
    },
  }
}

function validCoachNarrative(): CoachNarrative {
  return {
    gradeLetter: 'B',
    prose: 'Entry at $2000 was disciplined; exit at $2100 was rushed versus the 90-minute hold.',
    referencedPositionIds: [COACH_POS_ID],
    referencedFindingIds: [COACH_FIND_ID],
  }
}

function llmResult(obj: unknown, tokensIn = 10, tokensOut = 20) {
  return {
    content: JSON.stringify(obj),
    usage: { tokensIn, tokensOut },
  }
}

function badLlmResult() {
  return {
    content: 'This is not JSON at all!',
    usage: { tokensIn: 5, tokensOut: 5 },
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockCallLlm.mockReset()
  mockAiEnabled = 'on'
})

// ---------------------------------------------------------------------------
// composeDigest tests
// ---------------------------------------------------------------------------

describe('composeDigest', () => {
  it('happy path: returns valid narrative on first attempt', async () => {
    mockCallLlm.mockResolvedValueOnce(llmResult(validDigestNarrative(), 50, 100))

    const result = await composeDigest(digestFacts)

    expect(result.failed).toBe(false)
    expect(result.retried).toBe(false)
    expect(result.narrative).toEqual(validDigestNarrative())
    expect(result.tokensIn).toBe(50)
    expect(result.tokensOut).toBe(100)
    expect(mockCallLlm).toHaveBeenCalledTimes(1)
  })

  it('retry + success: returns valid narrative on second attempt', async () => {
    mockCallLlm
      .mockResolvedValueOnce(badLlmResult()) // first call — malformed
      .mockResolvedValueOnce(llmResult(validDigestNarrative(), 60, 110)) // retry — valid

    const result = await composeDigest(digestFacts)

    expect(result.failed).toBe(false)
    expect(result.retried).toBe(true)
    expect(result.narrative).toEqual(validDigestNarrative())
    expect(result.tokensIn).toBe(5 + 60)
    expect(result.tokensOut).toBe(5 + 110)
    expect(mockCallLlm).toHaveBeenCalledTimes(2)

    // Second call should have stricter prompt
    const secondCallArgs = mockCallLlm.mock.calls[1]?.[0] as { user: string; temperature: number }
    expect(secondCallArgs.user).toContain('Return ONLY the JSON object')
    expect(secondCallArgs.temperature).toBe(0.3)
  })

  it('both fail → fallback: returns fallback with failed=true retried=true', async () => {
    mockCallLlm
      .mockResolvedValueOnce(badLlmResult())
      .mockResolvedValueOnce(badLlmResult())

    const result = await composeDigest(digestFacts)

    expect(result.failed).toBe(true)
    expect(result.retried).toBe(true)
    expect(result.error).toBeTruthy()
    expect(result.narrative).toEqual(digestFallback(digestFacts))
    expect(mockCallLlm).toHaveBeenCalledTimes(2)
  })

  it('AI off: returns fallback immediately with error=ai_disabled, no LLM calls', async () => {
    mockAiEnabled = 'off'

    const result = await composeDigest(digestFacts)

    expect(result.failed).toBe(true)
    expect(result.retried).toBe(false)
    expect(result.error).toBe('ai_disabled')
    expect(result.tokensIn).toBe(0)
    expect(result.tokensOut).toBe(0)
    expect(result.narrative).toEqual(digestFallback(digestFacts))
    expect(mockCallLlm).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// composeCoach tests
// ---------------------------------------------------------------------------

describe('composeCoach', () => {
  it('happy path: returns valid narrative on first attempt', async () => {
    mockCallLlm.mockResolvedValueOnce(llmResult(validCoachNarrative(), 50, 120))

    const result = await composeCoach(coachFacts)

    expect(result.failed).toBe(false)
    expect(result.retried).toBe(false)
    expect(result.narrative).toEqual(validCoachNarrative())
    expect(result.tokensIn).toBe(50)
    expect(result.tokensOut).toBe(120)
    expect(mockCallLlm).toHaveBeenCalledTimes(1)
  })

  it('retry + success: returns valid narrative on second attempt', async () => {
    mockCallLlm
      .mockResolvedValueOnce(badLlmResult())
      .mockResolvedValueOnce(llmResult(validCoachNarrative(), 70, 130))

    const result = await composeCoach(coachFacts)

    expect(result.failed).toBe(false)
    expect(result.retried).toBe(true)
    expect(result.narrative).toEqual(validCoachNarrative())
    expect(result.tokensIn).toBe(5 + 70)
    expect(result.tokensOut).toBe(5 + 130)
    expect(mockCallLlm).toHaveBeenCalledTimes(2)

    const secondCallArgs = mockCallLlm.mock.calls[1]?.[0] as { user: string; temperature: number }
    expect(secondCallArgs.user).toContain('Return ONLY the JSON object')
    expect(secondCallArgs.temperature).toBe(0.3)
  })

  it('both fail → fallback: returns fallback with failed=true retried=true', async () => {
    mockCallLlm
      .mockResolvedValueOnce(badLlmResult())
      .mockResolvedValueOnce(badLlmResult())

    const result = await composeCoach(coachFacts)

    expect(result.failed).toBe(true)
    expect(result.retried).toBe(true)
    expect(result.error).toBeTruthy()
    expect(result.narrative).toEqual(coachFallback(coachFacts))
    expect(mockCallLlm).toHaveBeenCalledTimes(2)
  })

  it('AI off: returns fallback immediately with error=ai_disabled, no LLM calls', async () => {
    mockAiEnabled = 'off'

    const result = await composeCoach(coachFacts)

    expect(result.failed).toBe(true)
    expect(result.retried).toBe(false)
    expect(result.error).toBe('ai_disabled')
    expect(result.tokensIn).toBe(0)
    expect(result.tokensOut).toBe(0)
    expect(result.narrative).toEqual(coachFallback(coachFacts))
    expect(mockCallLlm).not.toHaveBeenCalled()
  })
})
