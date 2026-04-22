import { describe, it, expect } from 'vitest'
import { mergeFillsIntoPositions } from '~/derivation/merge'
import type { CanonicalFill } from '~/domain/fill'

type F = CanonicalFill & { id: string }

function mkFill(o: Partial<F> & { id: string; tid: number }): F {
  return {
    exchange: 'hyperliquid',
    symbol: 'BTC',
    instrumentType: 'perp',
    side: 'buy',
    price: '40000',
    size: '0.01',
    fee: '0.2',
    feeCurrency: 'USDC',
    executedAt: new Date(1704067200000),
    externalId: `tid_${o.tid}`,
    normalizerHint: { dir: 'Open Long' },
    ...o,
  }
}

describe('mergeFillsIntoPositions — perp long lifecycle', () => {
  it('creates one closed long from open + close', () => {
    const fills: F[] = [
      mkFill({ id: 'f1', tid: 1, side: 'buy', price: '40000', size: '0.01',
               executedAt: new Date(1704067200000), normalizerHint: { dir: 'Open Long' } }),
      mkFill({ id: 'f2', tid: 2, side: 'sell', price: '41000', size: '0.01',
               executedAt: new Date(1704070800000), normalizerHint: { dir: 'Close Long' } }),
    ]
    const positions = mergeFillsIntoPositions('user1', fills, 1)
    expect(positions).toHaveLength(1)
    const p = positions[0]!
    expect(p.side).toBe('long')
    expect(p.entryAvgPrice).toBe(40000)
    expect(p.exitAvgPrice).toBe(41000)
    expect(p.size).toBe(0.01)
    expect(p.notionalUsd).toBeCloseTo(400, 2)
    expect(p.realizedPnl).toBeCloseTo(10, 2) // (41000-40000) * 0.01
    expect(p.totalFees).toBeCloseTo(0.4, 2)
    expect(p.wasLiquidated).toBe(false)
    expect(p.needsReview).toBe(false)
    expect(p.closedAt).not.toBeNull()
    expect(p.fills).toHaveLength(2)
    expect(p.fills[0]!.role).toBe('open')
    expect(p.fills[1]!.role).toBe('close')
  })
})

describe('mergeFillsIntoPositions — add / reduce', () => {
  it('open + add + close — entryAvg is size-weighted', () => {
    const fills: F[] = [
      mkFill({ id: 'f1', tid: 1, side: 'buy',  price: '40000', size: '0.01',
               executedAt: new Date(0),          normalizerHint: { dir: 'Open Long' } }),
      mkFill({ id: 'f2', tid: 2, side: 'buy',  price: '42000', size: '0.01',
               executedAt: new Date(60_000),     normalizerHint: { dir: 'Add Long' } }),
      mkFill({ id: 'f3', tid: 3, side: 'sell', price: '43000', size: '0.02',
               executedAt: new Date(120_000),    normalizerHint: { dir: 'Close Long' } }),
    ]
    const [p] = mergeFillsIntoPositions('u1', fills, 1)
    expect(p!.entryAvgPrice).toBe(41000) // (40000*0.01 + 42000*0.01) / 0.02
    expect(p!.size).toBe(0.02)
    expect(p!.realizedPnl).toBeCloseTo((43000 - 41000) * 0.02, 2) // 40
    expect(p!.fills.map(x => x.role)).toEqual(['open', 'add', 'close'])
  })

  it('open + partial reduce + close — two closing events, one position', () => {
    const fills: F[] = [
      mkFill({ id: 'f1', tid: 1, side: 'buy',  price: '40000', size: '0.02',
               normalizerHint: { dir: 'Open Long' }, executedAt: new Date(0) }),
      mkFill({ id: 'f2', tid: 2, side: 'sell', price: '41000', size: '0.01',
               normalizerHint: { dir: 'Reduce Long' }, executedAt: new Date(60_000) }),
      mkFill({ id: 'f3', tid: 3, side: 'sell', price: '42000', size: '0.01',
               normalizerHint: { dir: 'Close Long' }, executedAt: new Date(120_000) }),
    ]
    const [p] = mergeFillsIntoPositions('u1', fills, 1)
    expect(p!.fills.map(x => x.role)).toEqual(['open', 'reduce', 'close'])
    expect(p!.realizedPnl).toBeCloseTo((41000-40000)*0.01 + (42000-40000)*0.01, 2) // 30
    expect(p!.exitAvgPrice).toBe(41500)
  })
})

describe('mergeFillsIntoPositions — shorts + liquidation', () => {
  it('short open + close', () => {
    const fills: F[] = [
      mkFill({ id: 'f1', tid: 1, side: 'sell', price: '40000', size: '0.01',
               normalizerHint: { dir: 'Open Short' }, executedAt: new Date(0) }),
      mkFill({ id: 'f2', tid: 2, side: 'buy',  price: '39000', size: '0.01',
               normalizerHint: { dir: 'Close Short' }, executedAt: new Date(60_000) }),
    ]
    const [p] = mergeFillsIntoPositions('u1', fills, 1)
    expect(p!.side).toBe('short')
    expect(p!.realizedPnl).toBeCloseTo(10, 2) // (40000-39000)*0.01
  })

  it('liquidation marks position', () => {
    const fills: F[] = [
      mkFill({ id: 'f1', tid: 1, side: 'buy',  price: '40000', size: '0.01',
               normalizerHint: { dir: 'Open Long' }, executedAt: new Date(0) }),
      mkFill({ id: 'f2', tid: 2, side: 'sell', price: '36000', size: '0.01',
               normalizerHint: { dir: 'Liquidation' }, executedAt: new Date(60_000) }),
    ]
    const [p] = mergeFillsIntoPositions('u1', fills, 1)
    expect(p!.wasLiquidated).toBe(true)
    expect(p!.realizedPnl).toBeCloseTo(-40, 2)
  })
})

describe('mergeFillsIntoPositions — still-open', () => {
  it('open with no close remains open (closedAt null)', () => {
    const fills: F[] = [
      mkFill({ id: 'f1', tid: 1, side: 'buy', price: '40000', size: '0.01',
               normalizerHint: { dir: 'Open Long' }, executedAt: new Date(0) }),
    ]
    const [p] = mergeFillsIntoPositions('u1', fills, 1)
    expect(p!.closedAt).toBeNull()
    expect(p!.exitAvgPrice).toBeNull()
    expect(p!.realizedPnl).toBe(0)
  })
})

describe('mergeFillsIntoPositions — side flip', () => {
  it('sell that exceeds long netSize closes then opens short with remainder', () => {
    const fills: F[] = [
      mkFill({ id: 'f1', tid: 1, side: 'buy',  price: '40000', size: '0.01',
               normalizerHint: { dir: 'Open Long' }, executedAt: new Date(0) }),
      mkFill({ id: 'f2', tid: 2, side: 'sell', price: '41000', size: '0.02',
               normalizerHint: { dir: 'Open Short' }, executedAt: new Date(60_000) }),
    ]
    const positions = mergeFillsIntoPositions('u1', fills, 1)
    expect(positions).toHaveLength(2)
    expect(positions[0]!.side).toBe('long')
    expect(positions[0]!.closedAt).not.toBeNull()
    expect(positions[1]!.side).toBe('short')
    expect(positions[1]!.closedAt).toBeNull()
    expect(positions[1]!.size).toBeCloseTo(0.01, 6)
  })
})

describe('mergeFillsIntoPositions — spot FIFO', () => {
  it('spot buy + sell produces closed long position', () => {
    const fills: F[] = [
      mkFill({ id: 'f1', tid: 1, side: 'buy', price: '40000', size: '0.01',
               instrumentType: 'spot', normalizerHint: null, executedAt: new Date(0) }),
      mkFill({ id: 'f2', tid: 2, side: 'sell', price: '41000', size: '0.01',
               instrumentType: 'spot', normalizerHint: null, executedAt: new Date(60_000) }),
    ]
    const [p] = mergeFillsIntoPositions('u1', fills, 1)
    expect(p!.instrumentType).toBe('spot')
    expect(p!.side).toBe('long')
    expect(p!.realizedPnl).toBeCloseTo(10, 2)
  })
})

describe('mergeFillsIntoPositions — reduce/add interplay (bug-fix coverage)', () => {
  it('reduce-then-add computes correct weighted entry avg and PnL', () => {
    const fills: F[] = [
      mkFill({ id: 'f1', tid: 1, side: 'buy',  price: '40000', size: '0.02',
               normalizerHint: { dir: 'Open Long' }, executedAt: new Date(0) }),
      mkFill({ id: 'f2', tid: 2, side: 'sell', price: '41000', size: '0.01',
               normalizerHint: { dir: 'Reduce Long' }, executedAt: new Date(60_000) }),
      mkFill({ id: 'f3', tid: 3, side: 'buy',  price: '38000', size: '0.01',
               normalizerHint: { dir: 'Add Long' }, executedAt: new Date(120_000) }),
      mkFill({ id: 'f4', tid: 4, side: 'sell', price: '42000', size: '0.02',
               normalizerHint: { dir: 'Close Long' }, executedAt: new Date(180_000) }),
    ]
    const [p] = mergeFillsIntoPositions('u1', fills, 1)
    // After reduce: remaining size 0.01 @ 40000 avg
    // After add 0.01 @ 38000: new avg = (0.01*40000 + 0.01*38000) / 0.02 = 39000
    expect(p!.entryAvgPrice).toBeCloseTo(39000, 2)
    // Realized PnL:
    //   reduce: (41000 - 40000) * 0.01 = 10
    //   close:  (42000 - 39000) * 0.02 = 60
    //   total: 70
    expect(p!.realizedPnl).toBeCloseTo(70, 2)
  })

  it('side-flip pro-rates the flip fill fee between old and new positions', () => {
    const fills: F[] = [
      mkFill({ id: 'f1', tid: 1, side: 'buy',  price: '40000', size: '0.01',
               fee: '0.2', normalizerHint: { dir: 'Open Long' }, executedAt: new Date(0) }),
      // Flip: 0.02 total, half closes the long (0.01), half opens a short (0.01). Fee 0.6 split 0.3 / 0.3.
      mkFill({ id: 'f2', tid: 2, side: 'sell', price: '41000', size: '0.02',
               fee: '0.6', normalizerHint: { dir: 'Open Short' }, executedAt: new Date(60_000) }),
      mkFill({ id: 'f3', tid: 3, side: 'buy',  price: '40500', size: '0.01',
               fee: '0.2', normalizerHint: { dir: 'Close Short' }, executedAt: new Date(120_000) }),
    ]
    const positions = mergeFillsIntoPositions('u1', fills, 1)
    expect(positions).toHaveLength(2)
    const long = positions[0]!, short = positions[1]!
    expect(long.side).toBe('long')
    expect(short.side).toBe('short')
    // Long total fees: 0.2 (open) + 0.3 (half of 0.6 flip) = 0.5
    expect(long.totalFees).toBeCloseTo(0.5, 4)
    // Short total fees: 0.3 (other half of 0.6 flip) + 0.2 (close) = 0.5
    expect(short.totalFees).toBeCloseTo(0.5, 4)
  })

  it('reduce fill larger than remaining netSize charges only the pro-rated fee', () => {
    const fills: F[] = [
      mkFill({ id: 'f1', tid: 1, side: 'buy',  price: '40000', size: '0.01',
               fee: '0.2', normalizerHint: { dir: 'Open Long' }, executedAt: new Date(0) }),
      // Broker overshoot: sell 0.02 against a 0.01 long — only 0.01 closes. Fee 0.4 pro-rates to 0.2.
      mkFill({ id: 'f2', tid: 2, side: 'sell', price: '41000', size: '0.02',
               fee: '0.4', normalizerHint: { dir: 'Close Long' }, executedAt: new Date(60_000) }),
    ]
    const positions = mergeFillsIntoPositions('u1', fills, 1)
    expect(positions.length).toBeGreaterThanOrEqual(1)
    const long = positions[0]!
    // Long total fees: 0.2 (open) + 0.2 (half of 0.4 close) = 0.4
    expect(long.totalFees).toBeCloseTo(0.4, 4)
  })
})
