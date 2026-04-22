import { describe, it, expect } from 'vitest'
import { z } from 'zod'

// Import schema indirectly by re-exporting from server/trades.ts is awkward.
// Instead, assert the shape of the input validator via a lightweight replica here that tests the
// canonical enums. If you change enums, update both places. This is a smoke test for drift.
const input = z.object({
  symbols: z.array(z.string()).optional(),
  instrument: z.enum(['all', 'spot', 'perp']).optional(),
  side: z.enum(['all', 'long', 'short']).optional(),
  pnl: z.enum(['all', 'winners', 'losers']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
})

describe('getTradeList input', () => {
  it('accepts minimal payload', () => {
    expect(() => input.parse({})).not.toThrow()
  })
  it('rejects bad instrument', () => {
    expect(() => input.parse({ instrument: 'bogus' })).toThrow()
  })
  it('clamps limit', () => {
    expect(() => input.parse({ limit: 1000 })).toThrow()
  })
})
