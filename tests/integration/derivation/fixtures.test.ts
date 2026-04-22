import { describe, it, expect } from 'vitest'
import { loadHlFixture } from '~/../tests/_support/fixtures'

describe('fixture loading', () => {
  it('parses steady-discipline.csv', () => {
    const fills = loadHlFixture('steady-discipline.csv')
    expect(fills.length).toBeGreaterThanOrEqual(30)
    expect(fills[0]?.exchange).toBe('hyperliquid')
    expect(fills[0]?.instrumentType).toBe('perp')
  })
})
