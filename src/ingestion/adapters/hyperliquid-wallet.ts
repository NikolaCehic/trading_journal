import type { SourceAdapter, RawRow } from '~/domain/adapter'
import type { CanonicalFill } from '~/domain/fill'
import type { ValidationReport } from '~/domain/import'

const HL_API = 'https://api.hyperliquid.xyz/info'
const RATE_LIMIT_DELAY_MS = 1100
const MAX_RETRIES = 4

type HLApiFill = {
  time: number
  coin: string
  side: 'A' | 'B'
  px: string
  sz: string
  dir: string
  closedPnl: string
  fee: string
  feeToken: string
  hash: string
  tid: number
}

function isValidWalletAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr.trim())
}

async function fetchPage(address: string, startTime: number): Promise<HLApiFill[]> {
  let attempt = 0
  while (true) {
    const res = await fetch(HL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'userFillsByTime', user: address.trim(), startTime }),
    })
    if (res.ok) return (await res.json()) as HLApiFill[]

    if (res.status === 429 || res.status >= 500) {
      if (attempt >= MAX_RETRIES) throw new Error(`HL API error after ${MAX_RETRIES} retries: ${res.status}`)
      const delay = RATE_LIMIT_DELAY_MS * Math.pow(2, attempt) * (0.75 + Math.random() * 0.5)
      await new Promise(r => setTimeout(r, delay))
      attempt++
      continue
    }
    throw new Error(`HL API unexpected status: ${res.status}`)
  }
}

export class HyperliquidWalletAdapter implements SourceAdapter<string> {
  readonly source = 'hyperliquid-wallet' as const

  async validate(input: string): Promise<ValidationReport> {
    const addr = input.trim()
    if (!isValidWalletAddress(addr)) {
      return {
        valid: false,
        source: 'hyperliquid-wallet',
        detectedVariant: 'hyperliquid-wallet',
        rowCount: 0,
        dateRange: null,
        symbols: [],
        summary: 'Invalid wallet address.',
        errors: [`Invalid Ethereum address: "${addr}". Must be 0x followed by 40 hex characters.`],
      }
    }
    return {
      valid: true,
      source: 'hyperliquid-wallet',
      detectedVariant: 'hyperliquid-wallet',
      rowCount: 0,
      dateRange: null,
      symbols: [],
      summary: `Valid Hyperliquid wallet address. Fills will be fetched from the public API.`,
      errors: [],
    }
  }

  async *parse(input: string, _importId: string): AsyncGenerator<RawRow> {
    const addr = input.trim()
    let startTime = 0
    let rowIndex = 0

    while (true) {
      const page = await fetchPage(addr, startTime)
      if (page.length === 0) break

      for (const fill of page) {
        yield { raw: fill as unknown as Record<string, unknown>, rowIndex: rowIndex++ }
      }

      const lastTime = Math.max(...page.map(f => f.time))
      startTime = lastTime + 1

      if (page.length < 100) break

      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS))
    }
  }

  normalize(raw: RawRow): CanonicalFill | null {
    const r = raw.raw as HLApiFill
    try {
      if (!r.time || !r.coin || !r.side || !r.px || !r.sz || !r.tid) return null
      const side = r.side === 'B' ? 'buy' : 'sell'
      const executedAt = new Date(r.time)
      if (isNaN(executedAt.getTime())) return null

      return {
        exchange: 'hyperliquid',
        symbol: r.coin.trim(),
        instrumentType: 'perp',
        side,
        price: parseFloat(r.px).toString(),
        size: parseFloat(r.sz).toString(),
        fee: parseFloat(r.fee ?? '0').toString(),
        feeCurrency: (r.feeToken ?? 'USDC').trim(),
        executedAt,
        externalId: String(r.tid),
        normalizerHint: r.dir ? { dir: r.dir } : undefined,
      }
    } catch {
      return null
    }
  }
}
