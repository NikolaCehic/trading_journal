import { describe, it, expect } from 'vitest'
import { resolveToBinance } from '~/market/symbolResolver'

describe('resolveToBinance', () => {
  it('binance: returns symbol as-is (uppercased)', () => {
    const result = resolveToBinance('binance', 'btcusdt')
    expect(result).toEqual({ supported: true, binanceSymbol: 'BTCUSDT' })
  })

  it('bybit: returns symbol as-is (uppercased)', () => {
    const result = resolveToBinance('bybit', 'ethusdt')
    expect(result).toEqual({ supported: true, binanceSymbol: 'ETHUSDT' })
  })

  it('okx: strips dashes and -SWAP suffix from canonical symbol', () => {
    const result = resolveToBinance('okx', 'BTC-USDT-SWAP')
    expect(result).toEqual({ supported: true, binanceSymbol: 'BTCUSDT' })
  })

  it('okx: handles already-normalized symbol (no dashes)', () => {
    const result = resolveToBinance('okx', 'SOLUSDT')
    expect(result).toEqual({ supported: true, binanceSymbol: 'SOLUSDT' })
  })

  it('hyperliquid: appends USDT to short base symbol', () => {
    const result = resolveToBinance('hyperliquid', 'BTC')
    expect(result).toEqual({ supported: true, binanceSymbol: 'BTCUSDT' })
  })

  it('hyperliquid: does not double-append USDT when already suffixed', () => {
    const result = resolveToBinance('hyperliquid', 'BTCUSDT')
    expect(result).toEqual({ supported: true, binanceSymbol: 'BTCUSDT' })
  })

  it('unknown exchange: returns supported=false with reason', () => {
    const result = resolveToBinance('kraken', 'BTCUSD')
    expect(result.supported).toBe(false)
    if (!result.supported) {
      expect(result.reason).toMatch(/Unknown exchange/)
    }
  })
})
