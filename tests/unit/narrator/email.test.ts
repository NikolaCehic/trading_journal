import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderDigestEmail } from '~/narrator/email/render'
import type { DigestFactBundle } from '~/narrator/facts/types'
import type { DigestNarrative } from '~/narrator/schemas'

// ---------------------------------------------------------------------------
// Mock env — default has both keys present
// ---------------------------------------------------------------------------

const mockEnv = {
  RESEND_API_KEY: 'resend_test_key',
  DIGEST_FROM_EMAIL: 'digest@tradejournal.app',
  DATABASE_URL: 'postgresql://x:x@localhost/test',
  BETTER_AUTH_SECRET: 'aaaabbbbccccddddeeeeffffgggghhhhiiii',
  BETTER_AUTH_URL: 'http://localhost:3000',
  GOOGLE_CLIENT_ID: 'test',
  GOOGLE_CLIENT_SECRET: 'test',
  ANTHROPIC_API_KEY: 'test',
  AI_ENABLED: 'on' as const,
}

vi.mock('~/lib/env', () => ({ env: mockEnv }))

// ---------------------------------------------------------------------------
// Mock Resend SDK
// ---------------------------------------------------------------------------

const mockSend = vi.fn()

vi.mock('resend', () => {
  class MockResend {
    emails = { send: mockSend }
  }
  return { Resend: MockResend }
})

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SUMMARY = {
  totalPnl: 1897,
  grossProfit: 2500,
  grossLoss: -603,
  totalFees: 12,
  winRate: 0.65,
  expectancy: 1.1,
  avgWin: 450,
  avgLoss: -200,
  profitFactor: 4.1,
  maxDrawdown: 300,
  tradeCount: 8,
  medianPositionSizeUsd: 5000,
}

function makeFactBundle(overrides: Partial<DigestFactBundle> = {}): DigestFactBundle {
  return {
    user: { id: 'user_1', email: 'trader@example.com' },
    isoWeek: '2026-W16',
    period: { start: '2026-04-13T00:00:00.000Z', end: '2026-04-19T23:59:59.999Z' },
    summary: SUMMARY,
    priorSummary: null,
    biggestWin: {
      positionId: 'pos_win_1',
      symbol: 'BTC',
      side: 'long',
      realizedPnl: 1500,
      rMultiple: 3.0,
    },
    biggestLoss: {
      positionId: 'pos_loss_1',
      symbol: 'ETH',
      side: 'short',
      realizedPnl: -603,
      rMultiple: -1.2,
    },
    topFinding: {
      findingId: 'finding_1',
      detectorId: 'revenge_trading',
      severity: 'warning',
      evidence: { count: 3 },
      referencedPositionIds: ['pos_1'],
    },
    activeRules: [],
    allowedPositionIds: ['pos_win_1', 'pos_loss_1'],
    allowedFindingIds: ['finding_1'],
    ...overrides,
  }
}

function makeNarrative(overrides: Partial<DigestNarrative> = {}): DigestNarrative {
  return {
    greeting: 'Good week overall.',
    biggestWin: { positionId: 'pos_win_1', prose: 'You held BTC through the breakout well.' },
    biggestLoss: { positionId: 'pos_loss_1', prose: 'The ETH short reversed quickly against you.' },
    topFinding: { findingId: 'finding_1', prose: 'Revenge trading pattern detected 3 times.' },
    oneThingToTry: 'Reduce size by 50% after two consecutive losses.',
    suggestedRule: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// renderDigestEmail tests
// ---------------------------------------------------------------------------

describe('renderDigestEmail', () => {
  it('subject includes correct date, signed P&L, and thing count', () => {
    const facts = makeFactBundle({
      period: { start: '2026-04-13T00:00:00.000Z', end: '2026-04-19T23:59:59.999Z' },
      summary: { ...SUMMARY, totalPnl: 1897 },
    })
    const narrative = makeNarrative({ oneThingToTry: 'Reduce size after losses.' })
    const { subject } = renderDigestEmail(facts, narrative)

    expect(subject).toContain('Apr 19')
    expect(subject).toContain('+$1,897')
    expect(subject).toContain('1 thing to try')
  })

  it('subject uses negative P&L with minus sign and no thing when oneThingToTry is null', () => {
    const facts = makeFactBundle({ summary: { ...SUMMARY, totalPnl: -512 } })
    const narrative = makeNarrative({ oneThingToTry: null })
    const { subject } = renderDigestEmail(facts, narrative)

    expect(subject).toContain('-$512')
    expect(subject).toContain('0 things to try')
  })

  it('omits biggest win section when narrative.biggestWin is null', () => {
    const narrative = makeNarrative({ biggestWin: null })
    const { html, text } = renderDigestEmail(makeFactBundle(), narrative)

    expect(html).not.toContain('Biggest Win')
    expect(text).not.toContain('Biggest Win')
  })

  it('omits biggest loss section when narrative.biggestLoss is null', () => {
    const narrative = makeNarrative({ biggestLoss: null })
    const { html, text } = renderDigestEmail(makeFactBundle(), narrative)

    expect(html).not.toContain('Biggest Loss')
    expect(text).not.toContain('Biggest Loss')
  })

  it('omits one-thing card when oneThingToTry is null', () => {
    const narrative = makeNarrative({ oneThingToTry: null })
    const { html, text } = renderDigestEmail(makeFactBundle(), narrative)

    expect(html).not.toContain('One Thing to Try')
    expect(text).not.toContain('One Thing to Try')
  })

  it('escapes HTML in prose — raw <script> tag must not appear in html output', () => {
    const maliciousProse = '<script>alert("xss")</script> Real prose here.'
    const narrative = makeNarrative({
      biggestWin: { positionId: 'pos_win_1', prose: maliciousProse },
    })
    const { html } = renderDigestEmail(makeFactBundle(), narrative)

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('html contains no CSS classes or style blocks', () => {
    const { html } = renderDigestEmail(makeFactBundle(), makeNarrative())

    expect(html).not.toMatch(/class\s*=/)
    expect(html).not.toContain('<style')
    expect(html).not.toContain('<link')
  })
})

// ---------------------------------------------------------------------------
// sendDigestEmail tests
// ---------------------------------------------------------------------------

describe('sendDigestEmail', () => {
  beforeEach(() => {
    vi.resetModules()
    mockSend.mockReset()
    // Restore defaults
    mockEnv.RESEND_API_KEY = 'resend_test_key'
    mockEnv.DIGEST_FROM_EMAIL = 'digest@tradejournal.app'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns no_api_key and does not call send when RESEND_API_KEY is missing', async () => {
    mockEnv.RESEND_API_KEY = undefined as unknown as string

    const { sendDigestEmail } = await import('~/narrator/email/send')

    const email = renderDigestEmail(makeFactBundle(), makeNarrative())
    const result = await sendDigestEmail('user@example.com', email)

    expect(result).toEqual({ sent: false, reason: 'no_api_key', logged: true })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns no_from_email when DIGEST_FROM_EMAIL is missing', async () => {
    mockEnv.DIGEST_FROM_EMAIL = undefined as unknown as string

    const { sendDigestEmail } = await import('~/narrator/email/send')

    const email = renderDigestEmail(makeFactBundle(), makeNarrative())
    const result = await sendDigestEmail('user@example.com', email)

    expect(result).toEqual({ sent: false, reason: 'no_from_email', logged: true })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns sent:true with messageId on happy path', async () => {
    mockSend.mockResolvedValueOnce({ data: { id: 'msg_123' }, error: null })

    const { sendDigestEmail } = await import('~/narrator/email/send')
    const email = renderDigestEmail(makeFactBundle(), makeNarrative())
    const result = await sendDigestEmail('user@example.com', email)

    expect(result).toEqual({ sent: true, messageId: 'msg_123' })
    expect(mockSend).toHaveBeenCalledOnce()
    const call = mockSend.mock.calls[0]?.[0] as Record<string, unknown>
    expect(call['to']).toBe('user@example.com')
    expect(call['subject']).toBe(email.subject)
  })

  it('returns send_failed and does not rethrow when Resend throws', async () => {
    mockSend.mockRejectedValueOnce(new Error('rate limit exceeded'))

    const { sendDigestEmail } = await import('~/narrator/email/send')
    const email = renderDigestEmail(makeFactBundle(), makeNarrative())

    // Must not throw
    const result = await sendDigestEmail('user@example.com', email)

    expect(result).toMatchObject({
      sent: false,
      reason: 'send_failed',
      logged: true,
    })
    const r = result as { sent: false; reason: 'send_failed'; error: string; logged: true }
    expect(r.error).toContain('rate limit exceeded')
  })
})
