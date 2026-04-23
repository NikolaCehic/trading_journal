import { db } from '~/db/client'
import { user } from '~/db/schema/auth'
import { fill } from '~/db/schema/canonical'
import { importRecord, exchangeAccount } from '~/db/schema/ingestion'
import { runDerivation } from '~/derivation/runner'
import { DERIVATION_VERSION } from '~/derivation/version'
import { eq } from 'drizzle-orm'

export const DEMO_USER_ID = 'demo-user-0001'
export const DEMO_USER_EMAIL = 'demo@tradejournal.local'

// ---------------------------------------------------------------------------
// Fill fixture data
// ---------------------------------------------------------------------------
// We use normalizerHint.dir to guide the merge engine. Valid dir values:
//   'Open Long', 'Open Short', 'Close Long', 'Close Short',
//   'Add Long', 'Add Short', 'Reduce Long', 'Reduce Short'
//
// Dates: today is 2026-04-22 (Tuesday). We span the last ~30 days.
// All times are UTC.
//
// Positions constructed:
//   P01: BTCUSDT perp long  — WIN  (+$340)  Day -28
//   P02: ETHUSDT perp long  — LOSS (-$180)  Day -25
//   P03: SOLUSDT perp long  — WIN  (+$220)  Day -22
//   P04: HYPE perp long     — LOSS (-$150)  Day -18
//   P05: ARBUSDT perp short — LOSS (-$210)  Day -15
//   P06: PEPEUSDT perp long — LOSS (-$130)  Day -12  ← FOMO #1 (oversize on meme)
//   P07: DOGEUSDT perp long — LOSS (-$95)   Day -10
//   --- revenge cluster (3 losses within 15 min of each other, Day -10 continuation) ---
//   P08: ETHUSDT perp short — LOSS (-$200)  Day -10 +5min after P07 close, 2.5× median size
//   P09: BTCUSDT perp short — WIN  (+$480)  Day -10 +10min after P07 close, 3× median size
//   P10: SOLUSDT perp short — LOSS (-$160)  Day -10 +13min after P07 close, 2× median size
//   P11: ETH spot long      — WIN  (+$290)  Day -5
//   P12: DOGEUSDT perp long — LOSS (-$110)  Day -2  ← FOMO #2

type FillFixture = {
  id: string
  externalId: string
  exchange: 'binance' | 'hyperliquid'
  symbol: string
  instrumentType: 'spot' | 'perp'
  side: 'buy' | 'sell'
  price: string
  size: string
  fee: string
  feeCurrency: string
  executedAt: Date
  normalizerHint: { dir: string } | null
}

function daysAgo(n: number, hh = 10, mm = 0, ss = 0): Date {
  const d = new Date('2026-04-22T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - n)
  d.setUTCHours(hh, mm, ss, 0)
  return d
}

const FIXTURES: FillFixture[] = [
  // ── P01: BTCUSDT perp long — WIN (+$340) Day -28 ──────────────────────────
  {
    id: 'df-p01-open', externalId: 'ext-p01-open',
    exchange: 'binance', symbol: 'BTCUSDT', instrumentType: 'perp', side: 'buy',
    price: '68000', size: '0.05', fee: '3.40', feeCurrency: 'USDT',
    executedAt: daysAgo(28, 9, 0),
    normalizerHint: { dir: 'Open Long' },
  },
  {
    id: 'df-p01-close', externalId: 'ext-p01-close',
    exchange: 'binance', symbol: 'BTCUSDT', instrumentType: 'perp', side: 'sell',
    price: '74800', size: '0.05', fee: '3.74', feeCurrency: 'USDT',
    executedAt: daysAgo(27, 14, 30),
    normalizerHint: { dir: 'Close Long' },
  },

  // ── P02: ETHUSDT perp long — LOSS (-$180) Day -25 ─────────────────────────
  {
    id: 'df-p02-open', externalId: 'ext-p02-open',
    exchange: 'binance', symbol: 'ETHUSDT', instrumentType: 'perp', side: 'buy',
    price: '3200', size: '0.5', fee: '1.60', feeCurrency: 'USDT',
    executedAt: daysAgo(25, 10, 0),
    normalizerHint: { dir: 'Open Long' },
  },
  {
    id: 'df-p02-close', externalId: 'ext-p02-close',
    exchange: 'binance', symbol: 'ETHUSDT', instrumentType: 'perp', side: 'sell',
    price: '2840', size: '0.5', fee: '1.42', feeCurrency: 'USDT',
    executedAt: daysAgo(24, 11, 15),
    normalizerHint: { dir: 'Close Long' },
  },

  // ── P03: SOLUSDT perp long — WIN (+$220) Day -22 ──────────────────────────
  {
    id: 'df-p03-open', externalId: 'ext-p03-open',
    exchange: 'binance', symbol: 'SOLUSDT', instrumentType: 'perp', side: 'buy',
    price: '155', size: '10', fee: '1.55', feeCurrency: 'USDT',
    executedAt: daysAgo(22, 8, 45),
    normalizerHint: { dir: 'Open Long' },
  },
  {
    id: 'df-p03-close', externalId: 'ext-p03-close',
    exchange: 'binance', symbol: 'SOLUSDT', instrumentType: 'perp', side: 'sell',
    price: '177', size: '10', fee: '1.77', feeCurrency: 'USDT',
    executedAt: daysAgo(21, 13, 0),
    normalizerHint: { dir: 'Close Long' },
  },

  // ── P04: HYPE perp long — LOSS (-$150) Day -18 ────────────────────────────
  {
    id: 'df-p04-open', externalId: 'ext-p04-open',
    exchange: 'hyperliquid', symbol: 'HYPE', instrumentType: 'perp', side: 'buy',
    price: '18.50', size: '50', fee: '0.93', feeCurrency: 'USDC',
    executedAt: daysAgo(18, 11, 0),
    normalizerHint: { dir: 'Open Long' },
  },
  {
    id: 'df-p04-close', externalId: 'ext-p04-close',
    exchange: 'hyperliquid', symbol: 'HYPE', instrumentType: 'perp', side: 'sell',
    price: '15.50', size: '50', fee: '0.78', feeCurrency: 'USDC',
    executedAt: daysAgo(17, 15, 30),
    normalizerHint: { dir: 'Close Long' },
  },

  // ── P05: ARBUSDT perp short — LOSS (-$210) Day -15 ────────────────────────
  {
    id: 'df-p05-open', externalId: 'ext-p05-open',
    exchange: 'binance', symbol: 'ARBUSDT', instrumentType: 'perp', side: 'sell',
    price: '0.80', size: '2000', fee: '1.60', feeCurrency: 'USDT',
    executedAt: daysAgo(15, 9, 30),
    normalizerHint: { dir: 'Open Short' },
  },
  {
    id: 'df-p05-close', externalId: 'ext-p05-close',
    exchange: 'binance', symbol: 'ARBUSDT', instrumentType: 'perp', side: 'buy',
    price: '0.905', size: '2000', fee: '1.81', feeCurrency: 'USDT',
    executedAt: daysAgo(14, 16, 0),
    normalizerHint: { dir: 'Close Short' },
  },

  // ── P06: PEPEUSDT perp long — LOSS (-$130) Day -12 — FOMO #1 ──────────────
  // Large position on a meme coin after it pumped 40% — classic FOMO entry
  {
    id: 'df-p06-open', externalId: 'ext-p06-open',
    exchange: 'binance', symbol: 'PEPEUSDT', instrumentType: 'perp', side: 'buy',
    price: '0.00002100', size: '20000000', fee: '4.41', feeCurrency: 'USDT',
    executedAt: daysAgo(12, 21, 5),
    normalizerHint: { dir: 'Open Long' },
  },
  {
    id: 'df-p06-close', externalId: 'ext-p06-close',
    exchange: 'binance', symbol: 'PEPEUSDT', instrumentType: 'perp', side: 'sell',
    price: '0.00001738', size: '20000000', fee: '3.65', feeCurrency: 'USDT',
    executedAt: daysAgo(11, 8, 20),
    normalizerHint: { dir: 'Close Long' },
  },

  // ── P07: DOGEUSDT perp long — LOSS (-$95) Day -10 ─────────────────────────
  {
    id: 'df-p07-open', externalId: 'ext-p07-open',
    exchange: 'binance', symbol: 'DOGEUSDT', instrumentType: 'perp', side: 'buy',
    price: '0.158', size: '2000', fee: '0.32', feeCurrency: 'USDT',
    executedAt: daysAgo(10, 10, 0),
    normalizerHint: { dir: 'Open Long' },
  },
  {
    id: 'df-p07-close', externalId: 'ext-p07-close',
    exchange: 'binance', symbol: 'DOGEUSDT', instrumentType: 'perp', side: 'sell',
    price: '0.1105', size: '2000', fee: '0.22', feeCurrency: 'USDT',
    executedAt: daysAgo(10, 11, 10),
    normalizerHint: { dir: 'Close Long' },
  },

  // ── P08: ETHUSDT perp short — LOSS (-$200) Day -10 +5min after P07 close ──
  // Revenge trade: opened 5 min after P07 close, 2.5× median notional
  {
    id: 'df-p08-open', externalId: 'ext-p08-open',
    exchange: 'binance', symbol: 'ETHUSDT', instrumentType: 'perp', side: 'sell',
    price: '3100', size: '1.5', fee: '4.65', feeCurrency: 'USDT',
    executedAt: daysAgo(10, 11, 15),
    normalizerHint: { dir: 'Open Short' },
  },
  {
    id: 'df-p08-close', externalId: 'ext-p08-close',
    exchange: 'binance', symbol: 'ETHUSDT', instrumentType: 'perp', side: 'buy',
    price: '3233', size: '1.5', fee: '4.85', feeCurrency: 'USDT',
    executedAt: daysAgo(10, 12, 0),
    normalizerHint: { dir: 'Close Short' },
  },

  // ── P09: BTCUSDT perp short — WIN (+$480) Day -10 +10min after P07 close ──
  // Revenge trade: opened 10 min after P07 close, 3× median notional
  {
    id: 'df-p09-open', externalId: 'ext-p09-open',
    exchange: 'binance', symbol: 'BTCUSDT', instrumentType: 'perp', side: 'sell',
    price: '69500', size: '0.15', fee: '10.43', feeCurrency: 'USDT',
    executedAt: daysAgo(10, 11, 20),
    normalizerHint: { dir: 'Open Short' },
  },
  {
    id: 'df-p09-close', externalId: 'ext-p09-close',
    exchange: 'binance', symbol: 'BTCUSDT', instrumentType: 'perp', side: 'buy',
    price: '66300', size: '0.15', fee: '9.95', feeCurrency: 'USDT',
    executedAt: daysAgo(10, 14, 45),
    normalizerHint: { dir: 'Close Short' },
  },

  // ── P10: SOLUSDT perp short — LOSS (-$160) Day -10 +13min after P07 close ─
  // Revenge trade: opened 13 min after P07 close, 2× median notional
  {
    id: 'df-p10-open', externalId: 'ext-p10-open',
    exchange: 'binance', symbol: 'SOLUSDT', instrumentType: 'perp', side: 'sell',
    price: '172', size: '20', fee: '3.44', feeCurrency: 'USDT',
    executedAt: daysAgo(10, 11, 23),
    normalizerHint: { dir: 'Open Short' },
  },
  {
    id: 'df-p10-close', externalId: 'ext-p10-close',
    exchange: 'binance', symbol: 'SOLUSDT', instrumentType: 'perp', side: 'buy',
    price: '180', size: '20', fee: '3.60', feeCurrency: 'USDT',
    executedAt: daysAgo(10, 13, 30),
    normalizerHint: { dir: 'Close Short' },
  },

  // ── P11: ETH spot long — WIN (+$290) Day -5 ──────────────────────────────
  {
    id: 'df-p11-open', externalId: 'ext-p11-open',
    exchange: 'binance', symbol: 'ETH', instrumentType: 'spot', side: 'buy',
    price: '3050', size: '0.5', fee: '1.53', feeCurrency: 'USDT',
    executedAt: daysAgo(5, 9, 0),
    normalizerHint: null,
  },
  {
    id: 'df-p11-close', externalId: 'ext-p11-close',
    exchange: 'binance', symbol: 'ETH', instrumentType: 'spot', side: 'sell',
    price: '3630', size: '0.5', fee: '1.82', feeCurrency: 'USDT',
    executedAt: daysAgo(4, 16, 0),
    normalizerHint: null,
  },

  // ── P12: DOGEUSDT perp long — LOSS (-$110) Day -2 — FOMO #2 ──────────────
  // Entered after a 30% overnight pump announcement, oversize position
  {
    id: 'df-p12-open', externalId: 'ext-p12-open',
    exchange: 'binance', symbol: 'DOGEUSDT', instrumentType: 'perp', side: 'buy',
    price: '0.198', size: '3500', fee: '0.69', feeCurrency: 'USDT',
    executedAt: daysAgo(2, 7, 5),
    normalizerHint: { dir: 'Open Long' },
  },
  {
    id: 'df-p12-close', externalId: 'ext-p12-close',
    exchange: 'binance', symbol: 'DOGEUSDT', instrumentType: 'perp', side: 'sell',
    price: '0.1666', size: '3500', fee: '0.58', feeCurrency: 'USDT',
    executedAt: daysAgo(1, 10, 30),
    normalizerHint: { dir: 'Close Long' },
  },
]

function buildDemoFills(
  userId: string,
  exchangeAccountId: string,
  importId: string,
): (typeof fill.$inferInsert)[] {
  return FIXTURES.map(f => ({
    id: f.id,
    userId,
    exchange: f.exchange,
    symbol: f.symbol,
    instrumentType: f.instrumentType,
    side: f.side,
    price: f.price,
    size: f.size,
    fee: f.fee,
    feeCurrency: f.feeCurrency,
    executedAt: f.executedAt,
    externalId: f.externalId,
    rawImportRowId: null,
    normalizerHint: f.normalizerHint,
  }))
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function seedDemoUser(): Promise<{ userId: string; fills: number; positions: number; findings: number }> {
  // 1. Clean any existing demo data (user FK has onDelete: cascade so all child rows are removed)
  await db.delete(user).where(eq(user.id, DEMO_USER_ID))

  // 2. Insert the demo user
  await db.insert(user).values({
    id: DEMO_USER_ID,
    email: DEMO_USER_EMAIL,
    name: 'Demo Trader',
    emailVerified: true,
    isDemo: true,
  })

  // 3. Insert exchangeAccount + importRecord
  const exAcctId = 'demo-ex-acct-0001'
  await db.insert(exchangeAccount).values({
    id: exAcctId,
    userId: DEMO_USER_ID,
    exchange: 'binance',
    label: 'Demo Binance',
    walletAddress: null,
  })

  const importId = 'demo-import-0001'
  await db.insert(importRecord).values({
    id: importId,
    userId: DEMO_USER_ID,
    exchangeAccountId: exAcctId,
    exchange: 'binance',
    source: 'binance-csv',
    status: 'complete',
    fillCount: 0,
    skippedCount: 0,
    errorMessage: null,
  })

  // 4. Generate fixture fills
  const fills = buildDemoFills(DEMO_USER_ID, exAcctId, importId)
  await db.insert(fill).values(fills)

  // 5. Update importRecord with final fill count
  await db.update(importRecord).set({ fillCount: fills.length }).where(eq(importRecord.id, importId))

  // 6. Run derivation
  const result = await runDerivation({ db, userId: DEMO_USER_ID, version: DERIVATION_VERSION })

  return {
    userId: DEMO_USER_ID,
    fills: fills.length,
    positions: result.positionCount,
    findings: result.findingCount,
  }
}
