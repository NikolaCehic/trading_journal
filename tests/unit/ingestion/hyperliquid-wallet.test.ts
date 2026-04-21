import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HyperliquidWalletAdapter } from '~/ingestion/adapters/hyperliquid-wallet'
import type { RawRow } from '~/domain/adapter'

const mockFill = {
  time: 1736499600000,
  coin: 'BTC',
  side: 'B',
  px: '94500.0',
  sz: '0.01',
  oid: 999,
  startPosition: '0.0',
  dir: 'Open Long',
  closedPnl: '0.0',
  fee: '4.725',
  feeToken: 'USDC',
  crossed: false,
  hash: '0xabc',
  tid: 100001,
}

const mockFill2 = {
  ...mockFill,
  time: 1736521200000,
  side: 'A',
  px: '96200.0',
  dir: 'Close Long',
  closedPnl: '17.0',
  tid: 100002,
}

describe('HyperliquidWalletAdapter — validate', () => {
  it('validates a well-formed 0x wallet address', async () => {
    const adapter = new HyperliquidWalletAdapter()
    const report = await adapter.validate('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
    expect(report.valid).toBe(true)
    expect(report.detectedVariant).toBe('hyperliquid-wallet')
  })

  it('rejects an invalid address', async () => {
    const adapter = new HyperliquidWalletAdapter()
    const report = await adapter.validate('notanaddress')
    expect(report.valid).toBe(false)
    expect(report.errors[0]).toMatch(/invalid/i)
  })
})

describe('HyperliquidWalletAdapter — parse (mocked fetch)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [mockFill, mockFill2],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],  // second page returns empty → stop
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('yields raw rows from the API response', async () => {
    const adapter = new HyperliquidWalletAdapter()
    const rows: RawRow[] = []
    for await (const row of adapter.parse('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 'imp_test')) {
      rows.push(row)
    }
    expect(rows).toHaveLength(2)
    expect((rows[0]!.raw as typeof mockFill).tid).toBe(100001)
  })
})

describe('HyperliquidWalletAdapter — normalize', () => {
  it('normalizes a wallet fill using tid as externalId', () => {
    const adapter = new HyperliquidWalletAdapter()
    const row: RawRow = { raw: mockFill as unknown as Record<string, unknown>, rowIndex: 0 }
    const fill = adapter.normalize(row)
    expect(fill).not.toBeNull()
    expect(fill!.externalId).toBe('100001')
    expect(fill!.side).toBe('buy')   // B = buy
    expect(fill!.instrumentType).toBe('perp')
    expect(fill!.normalizerHint?.['dir']).toBe('Open Long')
  })
})
