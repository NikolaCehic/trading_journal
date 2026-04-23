import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Stub env so narrator.ts can be imported without a real DB or Inngest client
// ---------------------------------------------------------------------------
vi.mock('~/lib/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://x:x@localhost/test',
    BETTER_AUTH_SECRET: 'aaaabbbbccccddddeeeeffffgggghhhhiiii',
    BETTER_AUTH_URL: 'http://localhost:3000',
    GOOGLE_CLIENT_ID: 'test',
    GOOGLE_CLIENT_SECRET: 'test',
    ANTHROPIC_API_KEY: 'test',
    AI_ENABLED: 'off',
    INNGEST_SIGNING_KEY: 'test',
    INNGEST_EVENT_KEY: 'test',
    RESEND_API_KEY: 'test',
    FROM_EMAIL: 'test@example.com',
  },
}))

vi.mock('~/db/client', () => ({ db: {} }))
vi.mock('~/narrator/facts/digestFacts', () => ({ buildDigestFacts: vi.fn() }))
vi.mock('~/narrator/compose', () => ({ composeDigest: vi.fn() }))
vi.mock('~/narrator/email/render', () => ({ renderDigestEmail: vi.fn() }))
vi.mock('~/narrator/email/send', () => ({ sendDigestEmail: vi.fn() }))
vi.mock('./client', () => ({ inngest: { createFunction: vi.fn() } }))
vi.mock('~/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

// Import the exported function under test
import { isSunday22InTz } from '~/jobs/narrator'

// ---------------------------------------------------------------------------
// Known dates used across tests
//
// 2026-04-26 22:00 UTC = Sunday 22:00 UTC
// In America/New_York (UTC-4 in summer EDT):
//   22:00 UTC = 18:00 New York → NOT 22:00 local
// In Europe/London (UTC+1 in BST):
//   22:00 UTC = 23:00 London → NOT 22:00 local
// In America/New_York, 22:00 local = 02:00 UTC (Monday, 2026-04-27)
//   → 2026-04-27 02:00 UTC is local Sunday 22:00 EDT
// ---------------------------------------------------------------------------

/** Sunday 2026-04-26 22:00:00 UTC */
const SUN_2200_UTC = new Date('2026-04-26T22:00:00.000Z')

/** Monday 2026-04-27 02:00:00 UTC = Sunday 22:00 EDT (America/New_York, UTC-4) */
const SUN_2200_EDT_AS_UTC = new Date('2026-04-27T02:00:00.000Z')

/** Sunday 2026-04-26 15:00:00 UTC — not a Sunday 22:00 in any common tz */
const SUN_1500_UTC = new Date('2026-04-26T15:00:00.000Z')

/** A plain Tuesday UTC */
const TUE_UTC = new Date('2026-04-21T22:00:00.000Z')

describe('isSunday22InTz', () => {
  it('returns true when local time is Sunday 22:xx in America/New_York', () => {
    // 2026-04-27 02:00 UTC = 2026-04-26 22:00 EDT
    expect(isSunday22InTz(SUN_2200_EDT_AS_UTC, 'America/New_York')).toBe(true)
  })

  it('returns false when UTC is Sunday 22:00 but local New York time is 18:00', () => {
    // 2026-04-26 22:00 UTC = 2026-04-26 18:00 EDT — not 22:00 local
    expect(isSunday22InTz(SUN_2200_UTC, 'America/New_York')).toBe(false)
  })

  it('returns false for an invalid timezone string', () => {
    expect(isSunday22InTz(SUN_2200_UTC, 'Not/AReal_Timezone')).toBe(false)
  })

  it('returns false when the local day is not Sunday', () => {
    // Tuesday 22:00 UTC — not Sunday in any timezone near UTC
    expect(isSunday22InTz(TUE_UTC, 'UTC')).toBe(false)
  })

  it('returns true when tz is UTC and time is exactly Sunday 22:00 UTC', () => {
    expect(isSunday22InTz(SUN_2200_UTC, 'UTC')).toBe(true)
  })
})
