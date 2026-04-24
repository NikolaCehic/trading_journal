import { describe, it, expect } from 'vitest'
import { btcEquityContextInput } from './market'

describe('btcEquityContextInput', () => {
  const baseFrom = '2025-01-01T00:00:00.000Z'

  function addDays(iso: string, days: number): string {
    return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString()
  }

  it('rejects a 400-day range', () => {
    expect(() =>
      btcEquityContextInput.parse({ from: baseFrom, to: addDays(baseFrom, 400) }),
    ).toThrow()
  })

  it('accepts a 300-day range', () => {
    const parsed = btcEquityContextInput.parse({
      from: baseFrom,
      to: addDays(baseFrom, 300),
    })
    expect(parsed.from).toBe(baseFrom)
    expect(parsed.to).toBe(addDays(baseFrom, 300))
  })

  it('rejects when to < from', () => {
    expect(() =>
      btcEquityContextInput.parse({ from: baseFrom, to: addDays(baseFrom, -1) }),
    ).toThrow()
  })

  it('rejects when to == from (zero-length range)', () => {
    expect(() =>
      btcEquityContextInput.parse({ from: baseFrom, to: baseFrom }),
    ).toThrow()
  })

  it('rejects a 366-day range (just over the cap)', () => {
    expect(() =>
      btcEquityContextInput.parse({ from: baseFrom, to: addDays(baseFrom, 366) }),
    ).toThrow()
  })

  it('accepts exactly a 365-day range (at the cap)', () => {
    expect(() =>
      btcEquityContextInput.parse({ from: baseFrom, to: addDays(baseFrom, 365) }),
    ).not.toThrow()
  })
})
