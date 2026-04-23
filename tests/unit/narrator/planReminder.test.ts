import { describe, it, expect, vi } from 'vitest'
import { renderPlanReminderEmail, type StalePlanRow } from '~/narrator/email/planReminder'

// ---------------------------------------------------------------------------
// Mock env
// ---------------------------------------------------------------------------

vi.mock('~/lib/env', () => ({
  env: {
    BETTER_AUTH_URL: 'https://app.tradejournal.test',
    BETTER_AUTH_SECRET: 'aaaabbbbccccddddeeeeffffgggghhhhiiii',
    DATABASE_URL: 'postgresql://x:x@localhost/test',
    GOOGLE_CLIENT_ID: 'test',
    GOOGLE_CLIENT_SECRET: 'test',
    ANTHROPIC_API_KEY: 'test',
    AI_ENABLED: 'on',
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(overrides: Partial<StalePlanRow> = {}): StalePlanRow {
  return {
    id: 'plan_abc123',
    symbol: 'BTC',
    intendedSide: 'long',
    createdAt: new Date(Date.now() - 10 * 86_400_000), // 10 days old
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderPlanReminderEmail', () => {
  it('subject says "1 stale plan" (singular) for a single plan', () => {
    const { subject } = renderPlanReminderEmail('user_1', [makePlan()])
    expect(subject).toBe('TJ · 1 stale plan — take or archive')
  })

  it('subject says "N stale plans" (plural) for multiple plans', () => {
    const plans = [makePlan(), makePlan({ id: 'plan_xyz', symbol: 'ETH', intendedSide: 'short' })]
    const { subject } = renderPlanReminderEmail('user_1', plans)
    expect(subject).toBe('TJ · 2 stale plans — take or archive')
  })

  it('HTML contains a signed unsubscribe URL with the user id embedded', () => {
    const { html } = renderPlanReminderEmail('user_42', [makePlan()])
    // The token is userId.hmac — url must start with the base url and contain the userId prefix
    expect(html).toContain('/api/unsubscribe?t=user_42.')
    expect(html).toContain('https://app.tradejournal.test')
  })

  it('plain-text fallback contains each plan line with symbol, side, age, and link', () => {
    const plans = [
      makePlan({ id: 'plan_a', symbol: 'BTC', intendedSide: 'long' }),
      makePlan({ id: 'plan_b', symbol: 'ETH', intendedSide: 'short' }),
    ]
    const { text } = renderPlanReminderEmail('user_1', plans)

    expect(text).toContain('BTC long')
    expect(text).toContain('ETH short')
    expect(text).toContain('/plans/plan_a')
    expect(text).toContain('/plans/plan_b')
    // Age (10d old)
    expect(text).toContain('10d old')
  })

  it('HTML escapes special characters in symbol — raw <script> must not appear', () => {
    const maliciousPlan = makePlan({ symbol: '<script>alert("xss")</script>' })
    const { html } = renderPlanReminderEmail('user_1', [maliciousPlan])

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
