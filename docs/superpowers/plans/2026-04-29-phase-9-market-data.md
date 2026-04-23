# Phase 9 — Market Data + Chart Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`.

**Goal:** Replace the fills-only SVG timeline on the trade detail page with real OHLCV candles behind the fills, so users can actually see the price action that surrounded their trade. Cache candles in a new `market_candles` table backed by Binance's public klines API (free, no keys). Gracefully fall back to fills-only for symbols without Binance coverage.

**Architecture:**
- New `market_candles` table: `(exchange, symbol, interval, openTime)` unique PK, OHLCV columns, lazy-populated.
- `getCandles({ symbol, from, to, interval })` server fn: returns cached candles; backfills missing bars from Binance public klines endpoint; stores; returns.
- Interval auto-selection based on position duration: <6h → 5m, <24h → 15m, <7d → 1h, ≥7d → 4h.
- Rate limiting: Binance public klines allows 1200 req/min per IP. Sequential per-request fetch is fine for this volume; add 50ms delay between calls and cap concurrent requests at 1 per server invocation.
- Symbol resolution: for Bybit/OKX symbols that match Binance's format (most do — BTCUSDT, ETHUSDT), use directly. For HL-only symbols (HYPE, etc.), render fills-only.
- Trade detail's FillsSvg becomes FillsChart: same SVG, now with candle wicks + bodies behind the fill dots.

**Tech Stack:** Existing. No new deps — we use `fetch` for Binance.

---

## Task 1 — `market_candles` schema + candle fetcher

**Files:**
- Modify: `src/db/schema/derivation.ts` (or create `src/db/schema/market.ts` — see below)
- Modify: `src/db/schema/index.ts`
- Create: `src/domain/candle.ts`
- Create: `src/market/binance-klines.ts` — Binance public API client
- Create: `src/market/candleStore.ts` — DB-backed candle retrieval with backfill
- Generate migration
- Test: `tests/unit/market/candleStore.test.ts`

**Schema (`src/db/schema/market.ts`):**
```ts
export const candleInterval = pgEnum('candle_interval', ['5m', '15m', '1h', '4h', '1d'])

export const marketCandle = pgTable('market_candle', {
  exchange: text('exchange').notNull(),       // 'binance' for now
  symbol: text('symbol').notNull(),           // canonical form: 'BTCUSDT'
  interval: candleInterval('interval').notNull(),
  openTime: timestamp('open_time', { withTimezone: true }).notNull(),
  closeTime: timestamp('close_time', { withTimezone: true }).notNull(),
  open: numeric('open', { precision: 20, scale: 8 }).notNull(),
  high: numeric('high', { precision: 20, scale: 8 }).notNull(),
  low: numeric('low', { precision: 20, scale: 8 }).notNull(),
  close: numeric('close', { precision: 20, scale: 8 }).notNull(),
  volume: numeric('volume', { precision: 28, scale: 8 }).notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.exchange, t.symbol, t.interval, t.openTime] }),
  symbolInterval: index('market_candle_symbol_interval_idx').on(t.symbol, t.interval, t.openTime),
}))
```

No per-user scope — candles are shared market data.

**Domain type (`src/domain/candle.ts`):**
```ts
export type CandleInterval = '5m' | '15m' | '1h' | '4h' | '1d'

export type Candle = {
  openTime: Date
  closeTime: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
}
```

**Binance client (`src/market/binance-klines.ts`):**
```ts
// GET https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&startTime=...&endTime=...&limit=1000
// Response: array of arrays: [openTime, open, high, low, close, volume, closeTime, ...]

export async function fetchBinanceKlines(params: {
  symbol: string
  interval: CandleInterval
  startTime: number  // ms epoch
  endTime: number
}): Promise<Candle[]> {
  const qs = new URLSearchParams({
    symbol: params.symbol,
    interval: params.interval,
    startTime: String(params.startTime),
    endTime: String(params.endTime),
    limit: '1000',
  })
  const url = `https://api.binance.com/api/v3/klines?${qs}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'trade-journal/0.9' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`binance klines ${res.status}: ${await res.text()}`)
  const rows = await res.json() as Array<[number, string, string, string, string, string, number, string, number, string, string, string]>
  return rows.map((r) => ({
    openTime: new Date(r[0]),
    closeTime: new Date(r[6]),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
  }))
}
```

**CandleStore (`src/market/candleStore.ts`):**
- `getCandles(db, { symbol, interval, from, to })` → `Promise<Candle[]>`
- First checks `market_candle` for coverage
- If the cached range has gaps, fetches missing bars from Binance (one or more `fetchBinanceKlines` calls, each up to 1000 bars)
- Persists new bars via `insert().onConflictDoNothing()` on the composite PK
- Returns all bars in range, sorted by openTime

Interval → millisecond helpers: `intervalMs('5m') → 300_000`, `'15m' → 900_000`, `'1h' → 3_600_000`, `'4h' → 14_400_000`, `'1d' → 86_400_000`.

**Tests:**
- Mock `fetchBinanceKlines` via `vi.mock`; test cache-hit path (no fetch); cache-miss path (single fetch); partial-cache path (fetch only missing range); persistence via `insertOnConflictDoNothing`.
- 5–6 tests.

## Task 2 — Candles server fn + symbol resolver

**Files:**
- Create: `src/server/market.ts` — `getCandlesForPosition({ positionId })` server fn
- Create: `src/market/symbolResolver.ts` — maps `(exchange, symbol)` to canonical Binance symbol (or null when unsupported)

**Symbol resolver:**
- Binance: identity
- Bybit: identity (BTCUSDT → BTCUSDT)
- OKX: strip `-SWAP` suffix, remove hyphens (already done by the ingestion adapter, but double-confirm on the canonical stored symbol)
- Hyperliquid: map known symbols (BTC, ETH, SOL, HYPE, etc. — most HL perps exist on Binance as `{SYM}USDT`)
- Return `{ binanceSymbol: string; supported: true } | { supported: false; reason: string }`

**Server fn:**
```ts
export const getCandlesForPosition = createServerFn({ method: 'POST' })
  .validator((d: unknown) => z.object({ positionId: z.string() }).parse(d))
  .handler(async ({ data }): Promise<{ candles: Candle[]; supported: boolean; interval: CandleInterval; reason?: string }> => {
    // auth + ownership via position.userId
    // Load position → symbol, openedAt, closedAt (fallback: now)
    // Resolve symbol; if unsupported → return { supported: false, reason }
    // Auto-select interval based on duration
    // Extend range by 20% on each side for context
    // Call candleStore.getCandles(...)
    // Return
  })
```

Auth + ownership check on the position (same pattern as `getTradeDetail`).

Interval selector:
```ts
function autoInterval(durationMs: number): CandleInterval {
  if (durationMs < 6 * 3600_000) return '5m'
  if (durationMs < 24 * 3600_000) return '15m'
  if (durationMs < 7 * 86400_000) return '1h'
  return '4h'
}
```

**Steps:**
- [ ] Symbol resolver with tests.
- [ ] Server fn with auth+ownership.
- [ ] 3–4 tests including the unsupported-symbol path.

## Task 3 — Fills chart component

**Files:**
- Modify: `app/routes/(app)/_layout/trades/$positionId.tsx` — replace `FillsSvg` with a new `FillsChart` that renders candles + fills

**Component:**
```tsx
function FillsChart({ fills, positionId }: { fills: TradeDetailBundle['fills']; positionId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['position-candles', positionId],
    queryFn: () => getCandlesForPosition({ data: { positionId } }),
    staleTime: 5 * 60_000,
  })

  // Fallback to the current fills-only rendering when unsupported or no data
  if (!data || !data.supported || data.candles.length === 0) {
    return <FillsSvgOnly fills={fills} />
  }

  return <CandlesAndFills candles={data.candles} fills={fills} interval={data.interval} />
}
```

**CandlesAndFills:**
- SVG. Compute min/max price across (candles ∪ fills). Pad 5%.
- x-axis: time from first candle to last candle. Fills are positioned by `executedAt`.
- Candles: 2px width (or scaled), wicks thin, body green/red by direction.
- Fills: colored dots (existing logic) on top of candles.
- Gridlines: 3 horizontal price lines with labels on the left axis.
- Hover: show OHLC tooltip on hover (reuse the pattern from the old candle chart in `$positionId.tsx` pre-Phase-5).
- Height: 280px.

**FillsSvgOnly:** keep the existing fills-only rendering as a fallback (the current `FillsSvg` function before Phase 9 — preserve it, rename to `FillsSvgOnly`).

**Loading state:** while the query is pending, render a 280px placeholder with a subtle "Loading candles…" center text.

**Error/unsupported state:** render the fallback fills-only chart + a small caption: "Price candles unavailable for {symbol} — fills-only view."

**Steps:**
- [ ] `FillsChart` container with query.
- [ ] `CandlesAndFills` SVG rendering.
- [ ] Preserve `FillsSvgOnly` fallback.
- [ ] Update the "Fills timeline" card's `.tj-card-sub` to show `{candles.length} candles (interval) · {fills.length} fills` when available.

## Task 4 — Dashboard equity-curve with price context (OPTIONAL — may defer)

Skip for this phase. Candles on trade detail alone is meaningful enough. The dashboard equity-curve gets a market-price overlay in a follow-up phase if desired.

Mark as deferred in the plan's "Scope not in this phase" section.

## Task 5 — Rate limiting + resilience

**Files:**
- Modify: `src/market/binance-klines.ts` — add a simple rate limiter
- Modify: `src/market/candleStore.ts` — robust error handling

**Rate limiter:**
- Simple in-memory: maintain a rolling 60s window of request timestamps. If > 60 calls in the last 60s, `await sleep(delay)` before the next call. Cap at 60/min (well below Binance's 1200/min).

**Error handling:**
- If Binance returns 429 (rate limit), back off exponentially with `Retry-After` header respected.
- If Binance returns 4xx for other reasons (symbol not found), return an empty candle array and cache a "not-found" marker (or just return empty — let the caller fall back).
- If fetch times out, return cached candles only.

**Steps:**
- [ ] Rolling-window rate limiter.
- [ ] Retry on 429 with backoff.
- [ ] Unit tests for the limiter (mock `Date.now`).

## Task 6 — Wiki + changelog + landing

**Files:**
- Modify: `docs/wiki/phases.md` — Phase 9 Shipped section
- Modify: `app/routes/(public)/changelog.tsx` — prepend v0.9 entry
- Modify: `app/routes/(public)/index.tsx` — update the fills timeline caption in the landing's product-screenshot section if it mentions "fills only" or similar (check; likely fine)

**Steps:**
- [ ] Wiki with commits, decisions, gotchas, deferred.
- [ ] Changelog v0.9.
- [ ] Target 230+ tests passing.

---

## Scope NOT in Phase 9

- **Market data for HL-only symbols** — return unsupported; use fills-only. Adding an HL klines client is Phase 10+.
- **Dashboard equity-curve BTC overlay** — defer.
- **Tick-level data** — candles only, no per-trade ticker feed.
- **Multi-symbol correlation view** — separate feature, future phase.
- **Auto plan→position matching** — still deferred.
- **Custom detectors DSL** — Phase 10+.
- **Playwright CI** — separate infra phase.
- **Plan reminders / plan snapshots** — small follow-ups.
