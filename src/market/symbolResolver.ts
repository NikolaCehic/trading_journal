export type ResolvedSymbol =
  | { supported: true; binanceSymbol: string }
  | { supported: false; reason: string }

// Hand-curated map of HL base assets that DO NOT have a Binance equivalent.
// Maintain this list as users report gaps. For now keep it empty or tiny.
const BINANCE_UNSUPPORTED_HL_SYMBOLS = new Set<string>([
  // Add here if we discover HL symbols that Binance doesn't list.
  // Leave empty by default — assume coverage; handle 400s in candleStore.
])

export function resolveToBinance(exchange: string, symbol: string): ResolvedSymbol {
  const s = symbol.toUpperCase()
  switch (exchange) {
    case 'binance':
      return { supported: true, binanceSymbol: s }
    case 'bybit':
      return { supported: true, binanceSymbol: s }
    case 'okx': {
      // Canonical store already strips '-' and '-SWAP', so OKX symbols look like Binance.
      // Defensive: apply the transform again in case a non-canonical symbol sneaks in.
      const normalized = s.replace(/-SWAP$/, '').replace(/-/g, '')
      return { supported: true, binanceSymbol: normalized }
    }
    case 'hyperliquid': {
      // HL stores the base asset only. Append USDT (e.g., 'BTC' → 'BTCUSDT').
      if (s.endsWith('USDT')) return { supported: true, binanceSymbol: s }
      if (BINANCE_UNSUPPORTED_HL_SYMBOLS.has(s)) {
        return { supported: false, reason: `No Binance equivalent for HL ${s}` }
      }
      return { supported: true, binanceSymbol: s + 'USDT' }
    }
    default:
      return { supported: false, reason: `Unknown exchange: ${exchange}` }
  }
}
