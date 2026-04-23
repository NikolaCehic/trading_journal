import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock env — fixed secret so tests are hermetic
// ---------------------------------------------------------------------------

vi.mock('~/lib/env', () => ({
  env: {
    BETTER_AUTH_SECRET: 'test-secret-32-chars-long-here-xx',
  },
}))

// Import after mock is set up
const { signUnsubscribeToken, verifyUnsubscribeToken } = await import('~/lib/unsubscribeToken')

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('signUnsubscribeToken', () => {
  it('returns a non-empty string that contains the userId followed by a dot', () => {
    const token = signUnsubscribeToken('u1')
    expect(token).toBeTruthy()
    expect(token).toContain('u1.')
    expect(token.startsWith('u1.')).toBe(true)
  })
})

describe('verifyUnsubscribeToken', () => {
  it('verifies a freshly signed token correctly', () => {
    const token = signUnsubscribeToken('u1')
    const result = verifyUnsubscribeToken(token)
    expect(result).toEqual({ ok: true, userId: 'u1' })
  })

  it('returns invalid for a tampered signature', () => {
    const token = signUnsubscribeToken('u1')
    // Replace last char of signature with something different
    const tampered = token.slice(0, -1) + (token.at(-1) === 'a' ? 'b' : 'a')
    const result = verifyUnsubscribeToken(tampered)
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('returns missing for an empty string', () => {
    const result = verifyUnsubscribeToken('')
    expect(result).toEqual({ ok: false, reason: 'missing' })
  })

  it('returns malformed for a token with no dot separator', () => {
    const result = verifyUnsubscribeToken('nodothere')
    expect(result).toEqual({ ok: false, reason: 'malformed' })
  })

  it('returns invalid when userId is swapped but signature is kept from original', () => {
    const tokenForU1 = signUnsubscribeToken('u1')
    const sigOfU1 = tokenForU1.split('.')[1]!
    // Forge token claiming to be u2 but with u1's signature
    const forged = `u2.${sigOfU1}`
    const result = verifyUnsubscribeToken(forged)
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })
})
