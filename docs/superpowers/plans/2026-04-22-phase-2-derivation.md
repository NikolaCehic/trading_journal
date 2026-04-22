# Phase 2 — Derivation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn immutable canonical fills into versioned positions, metrics, and detector findings — wire the derivation runner to `ingestion/complete`, add the 11 behavioral detectors with golden-fixture tests, and ship an admin `rederive` command for version bumps. The engine becomes the source of truth for the dashboard, digest, and coach surfaces later.

**Architecture:** The derivation layer is a pure function of canonical fills. `merge.ts` groups fills into `Position` objects (perps via HL `dir` hints; spot via FIFO). Metrics modules compute daily / asset / session / summary rollups. Each of the 11 detectors is a typed module returning `Finding[]` with strongly typed JSONB evidence. The runner orchestrates merge → metrics → detectors and writes everything at the current `derivation_version`. An Inngest function subscribes to `ingestion/complete`; an admin script rederives at a bumped version.

**Tech Stack:** Drizzle ORM · Neon Postgres · Inngest v4 · Vitest · tsx

**Plan 03 of ~6.** Previous: Phase 0 Foundation, Phase 1 Ingestion. Subsequent: Phase 3 Dashboard, Phase 4 AI, Phase 5 Demo, Phase 6 Polish.

---

## Pre-flight: what you need before starting

- Phase 1 shipped: `pnpm typecheck` is clean, fills round-trip via CSV + HL wallet imports, `fill`, `import`, `raw_import_row`, `exchange_account` tables exist
- `.env.local` has `DATABASE_URL` / `DIRECT_URL` pointed at a reset-friendly Neon branch (migrations will add 7 tables)
- `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` set
- Inngest dev server runs locally: `npx inngest-cli@latest dev` (you'll point it at `/api/inngest`)
- Vitest already configured in `vitest.config.ts`

---

## File structure after Phase 2

```
NEW:
src/
  domain/
    position.ts             Position, PositionFill, PositionRole, PositionSide
    finding.ts              Finding + 11 evidence type schemas + FindingSeverity
  db/
    schema/
      derivation.ts         position, position_fill, daily_metric, asset_metric,
                            session_metric, summary_rollup, finding tables
  derivation/
    version.ts              DERIVATION_VERSION constant
    merge.ts                mergeFillsIntoPositions(fills, version) → Position[]
    metrics/
      daily.ts              computeDailyMetrics
      asset.ts              computeAssetMetrics
      session.ts            computeSessionMetrics
      summary.ts            computeSummaryRollup
      shared.ts             expectancy / stddev / percentile helpers
    detectors/
      types.ts              Detector interface + DerivationContext
      revenge-trading.ts
      oversized-positions.ts
      loss-of-discipline-windows.ts
      position-sizing-instability.ts
      cut-winners-ride-losers.ts
      overtrading-after-losses.ts
      fee-drag.ts
      scaling-into-losers.ts
      short-hold-scalping.ts
      symbol-underperformance.ts
      leverage-creep.ts
      index.ts              export const DETECTORS = [...]
    runner.ts               runDerivation({ userId, db, version }) — end-to-end
    persist.ts               DB writers for positions / metrics / findings
  jobs/
    derivation.ts           deriveOnIngestionCompleteFn Inngest function
  server/
    rederive.ts             admin-only server fn (fires derivation/rederive event)

fixtures/
  steady-discipline.csv     zero-findings baseline (HL format)
  revenge-trader.csv
  size-bloater.csv
  evening-tilt.csv
  size-drift.csv
  winner-cutter.csv
  loss-chaser.csv
  fee-bleed.csv
  pyramid-losers.csv
  scalp-gambler.csv
  bad-ticker.csv
  leverage-creep.csv

tests/unit/derivation/
  merge.test.ts
  metrics.test.ts
  detectors/
    revenge-trading.test.ts
    oversized-positions.test.ts
    loss-of-discipline-windows.test.ts
    position-sizing-instability.test.ts
    cut-winners-ride-losers.test.ts
    overtrading-after-losses.test.ts
    fee-drag.test.ts
    scaling-into-losers.test.ts
    short-hold-scalping.test.ts
    symbol-underperformance.test.ts
    leverage-creep.test.ts

tests/integration/derivation/
  golden-fixtures.test.ts

scripts/
  rederive.ts               CLI: npx tsx scripts/rederive.ts --user=<id> --version=N

MODIFIED:
src/db/schema/index.ts      export derivation schema
src/jobs/events.ts          add `derivation/complete` + `derivation/rederive` events
src/jobs/functions.ts       register deriveOnIngestionCompleteFn
package.json                add `derive` + `rederive` scripts
```

---

## Task 0 — Scaffold empty derivation module + version constant

**Why:** Gives every subsequent task a real import path. No TDD needed — this is bookkeeping.

**Files:**
- Create: `src/derivation/version.ts`
- Create: `src/derivation/detectors/types.ts`

- [ ] **Step 1: Create `src/derivation/version.ts`**

```ts
// Derivation version. Bump whenever any detector, merger, or metric changes
// in a way that would produce different output for the same fills.
// Every derived row carries this as `derivation_version`.
export const DERIVATION_VERSION = 1
```

- [ ] **Step 2: Create `src/derivation/detectors/types.ts`**

```ts
import type { CanonicalFill } from '~/domain/fill'
import type { Position } from '~/domain/position'
import type { Finding } from '~/domain/finding'
import type { SummaryRollupValue, DailyMetricValue, AssetMetricValue, SessionMetricValue } from '~/domain/metrics'

export type DerivationContext = {
  userId: string
  derivationVersion: number
  now: Date
  fills: (CanonicalFill & { id: string })[]
  positions: Position[]
  summary: SummaryRollupValue
  daily: DailyMetricValue[]
  asset: AssetMetricValue[]
  session: SessionMetricValue[]
}

export interface Detector {
  readonly id: string
  readonly description: string
  run(ctx: DerivationContext): Finding[]
}
```

- [ ] **Step 3: Commit**

```bash
git add src/derivation/version.ts src/derivation/detectors/types.ts
git commit -m "chore(derivation): scaffold version constant + detector interface"
```

---

## Task 1 — DB schema for derivation layer

**Files:**
- Create: `src/db/schema/derivation.ts`
- Modify: `src/db/schema/index.ts`
- Generate migration

- [ ] **Step 1: Create `src/db/schema/derivation.ts`**

```ts
import {
  pgTable, text, timestamp, numeric, jsonb, integer, boolean,
  unique, index, pgEnum,
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import { fill, instrumentTypeEnum } from './canonical'

export const positionSideEnum = pgEnum('position_side', ['long', 'short'])
export const positionFillRoleEnum = pgEnum('position_fill_role', ['open', 'add', 'reduce', 'close'])
export const findingSeverityEnum = pgEnum('finding_severity', ['info', 'warning', 'critical'])

export const position = pgTable('position', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  exchange: text('exchange').notNull(),
  symbol: text('symbol').notNull(),
  instrumentType: instrumentTypeEnum('instrument_type').notNull(),
  side: positionSideEnum('side').notNull(),
  entryAvgPrice: numeric('entry_avg_price', { precision: 36, scale: 18 }).notNull(),
  exitAvgPrice: numeric('exit_avg_price', { precision: 36, scale: 18 }),
  size: numeric('size', { precision: 36, scale: 18 }).notNull(),
  notionalUsd: numeric('notional_usd', { precision: 36, scale: 18 }).notNull(),
  maxNotionalUsd: numeric('max_notional_usd', { precision: 36, scale: 18 }).notNull(),
  realizedPnl: numeric('realized_pnl', { precision: 36, scale: 18 }).notNull().default('0'),
  totalFees: numeric('total_fees', { precision: 36, scale: 18 }).notNull().default('0'),
  fundingPnl: numeric('funding_pnl', { precision: 36, scale: 18 }).notNull().default('0'),
  wasLiquidated: boolean('was_liquidated').notNull().default(false),
  needsReview: boolean('needs_review').notNull().default(false),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  derivationVersion: integer('derivation_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('position_user_id_idx').on(t.userId),
  index('position_user_symbol_idx').on(t.userId, t.symbol),
  index('position_derivation_version_idx').on(t.userId, t.derivationVersion),
  index('position_opened_at_idx').on(t.userId, t.openedAt),
])

export const positionFill = pgTable('position_fill', {
  id: text('id').primaryKey(),
  positionId: text('position_id').notNull().references(() => position.id, { onDelete: 'cascade' }),
  fillId: text('fill_id').notNull().references(() => fill.id, { onDelete: 'cascade' }),
  role: positionFillRoleEnum('role').notNull(),
  derivationVersion: integer('derivation_version').notNull(),
}, (t) => [
  unique('position_fill_unique').on(t.positionId, t.fillId),
  index('position_fill_fill_id_idx').on(t.fillId),
])

export const dailyMetric = pgTable('daily_metric', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  date: text('date').notNull(), // YYYY-MM-DD UTC
  tradeCount: integer('trade_count').notNull().default(0),
  realizedPnl: numeric('realized_pnl', { precision: 36, scale: 18 }).notNull().default('0'),
  volumeUsd: numeric('volume_usd', { precision: 36, scale: 18 }).notNull().default('0'),
  winCount: integer('win_count').notNull().default(0),
  lossCount: integer('loss_count').notNull().default(0),
  totalFees: numeric('total_fees', { precision: 36, scale: 18 }).notNull().default('0'),
  derivationVersion: integer('derivation_version').notNull(),
}, (t) => [
  unique('daily_metric_unique').on(t.userId, t.date, t.derivationVersion),
])

export const assetMetric = pgTable('asset_metric', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  symbol: text('symbol').notNull(),
  tradeCount: integer('trade_count').notNull().default(0),
  realizedPnl: numeric('realized_pnl', { precision: 36, scale: 18 }).notNull().default('0'),
  winRate: numeric('win_rate', { precision: 8, scale: 6 }).notNull().default('0'),
  avgWin: numeric('avg_win', { precision: 36, scale: 18 }).notNull().default('0'),
  avgLoss: numeric('avg_loss', { precision: 36, scale: 18 }).notNull().default('0'),
  expectancy: numeric('expectancy', { precision: 36, scale: 18 }).notNull().default('0'),
  derivationVersion: integer('derivation_version').notNull(),
}, (t) => [
  unique('asset_metric_unique').on(t.userId, t.symbol, t.derivationVersion),
])

export const sessionMetric = pgTable('session_metric', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  hourOfDayUtc: integer('hour_of_day_utc').notNull(), // 0..23
  tradeCount: integer('trade_count').notNull().default(0),
  realizedPnl: numeric('realized_pnl', { precision: 36, scale: 18 }).notNull().default('0'),
  winRate: numeric('win_rate', { precision: 8, scale: 6 }).notNull().default('0'),
  expectancy: numeric('expectancy', { precision: 36, scale: 18 }).notNull().default('0'),
  derivationVersion: integer('derivation_version').notNull(),
}, (t) => [
  unique('session_metric_unique').on(t.userId, t.hourOfDayUtc, t.derivationVersion),
])

export const summaryRollup = pgTable('summary_rollup', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  totalPnl: numeric('total_pnl', { precision: 36, scale: 18 }).notNull().default('0'),
  grossProfit: numeric('gross_profit', { precision: 36, scale: 18 }).notNull().default('0'),
  grossLoss: numeric('gross_loss', { precision: 36, scale: 18 }).notNull().default('0'),
  totalFees: numeric('total_fees', { precision: 36, scale: 18 }).notNull().default('0'),
  winRate: numeric('win_rate', { precision: 8, scale: 6 }).notNull().default('0'),
  expectancy: numeric('expectancy', { precision: 36, scale: 18 }).notNull().default('0'),
  avgWin: numeric('avg_win', { precision: 36, scale: 18 }).notNull().default('0'),
  avgLoss: numeric('avg_loss', { precision: 36, scale: 18 }).notNull().default('0'),
  profitFactor: numeric('profit_factor', { precision: 18, scale: 6 }),
  maxDrawdown: numeric('max_drawdown', { precision: 36, scale: 18 }).notNull().default('0'),
  tradeCount: integer('trade_count').notNull().default(0),
  medianPositionSizeUsd: numeric('median_position_size_usd', { precision: 36, scale: 18 }).notNull().default('0'),
  derivationVersion: integer('derivation_version').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('summary_rollup_unique').on(t.userId, t.derivationVersion),
])

export const finding = pgTable('finding', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  detectorId: text('detector_id').notNull(),
  severity: findingSeverityEnum('severity').notNull(),
  title: text('title').notNull(),
  bodyMarkdown: text('body_markdown').notNull(),
  evidence: jsonb('evidence').notNull(),
  referencedPositionIds: text('referenced_position_ids').array().notNull().default([]),
  periodStart: timestamp('period_start', { withTimezone: true }),
  periodEnd: timestamp('period_end', { withTimezone: true }),
  derivationVersion: integer('derivation_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('finding_user_detector_idx').on(t.userId, t.detectorId),
  index('finding_user_version_idx').on(t.userId, t.derivationVersion),
])
```

- [ ] **Step 2: Modify `src/db/schema/index.ts`**

Add to the bottom:

```ts
export * from './derivation'
```

- [ ] **Step 3: Generate + apply migration**

Run:

```bash
pnpm drizzle-kit generate
pnpm drizzle-kit push
```

Expected: one new migration file under `drizzle/`, and Neon reports 7 new tables + 3 new enums.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema/derivation.ts src/db/schema/index.ts drizzle/
git commit -m "feat(db): derivation schema — positions, metrics, findings"
```

---

## Task 2 — Domain types: Position + Finding + evidence schemas

**Files:**
- Create: `src/domain/position.ts`
- Create: `src/domain/metrics.ts`
- Create: `src/domain/finding.ts`

- [ ] **Step 1: Create `src/domain/position.ts`**

```ts
import type { Exchange, InstrumentType } from './fill'

export type PositionSide = 'long' | 'short'
export type PositionRole = 'open' | 'add' | 'reduce' | 'close'

export type PositionFillRef = {
  fillId: string
  role: PositionRole
  price: number
  size: number
  fee: number
  executedAt: Date
}

export type Position = {
  id: string
  userId: string
  exchange: Exchange
  symbol: string
  instrumentType: InstrumentType
  side: PositionSide
  entryAvgPrice: number
  exitAvgPrice: number | null
  /** Sum of open + add fill sizes, in base-asset units */
  size: number
  /** entryAvgPrice × size — the position's opened-notional USD */
  notionalUsd: number
  /** Peak concurrent notional through the position's life (proxy for leverage when actual margin is unavailable) */
  maxNotionalUsd: number
  realizedPnl: number
  totalFees: number
  fundingPnl: number
  wasLiquidated: boolean
  needsReview: boolean
  openedAt: Date
  closedAt: Date | null
  fills: PositionFillRef[]
  derivationVersion: number
}
```

- [ ] **Step 2: Create `src/domain/metrics.ts`**

```ts
export type DailyMetricValue = {
  date: string // YYYY-MM-DD UTC
  tradeCount: number
  realizedPnl: number
  volumeUsd: number
  winCount: number
  lossCount: number
  totalFees: number
}

export type AssetMetricValue = {
  symbol: string
  tradeCount: number
  realizedPnl: number
  winRate: number
  avgWin: number
  avgLoss: number
  expectancy: number
}

export type SessionMetricValue = {
  hourOfDayUtc: number // 0..23
  tradeCount: number
  realizedPnl: number
  winRate: number
  expectancy: number
}

export type SummaryRollupValue = {
  totalPnl: number
  grossProfit: number
  grossLoss: number
  totalFees: number
  winRate: number
  expectancy: number
  avgWin: number
  avgLoss: number
  profitFactor: number | null // null when grossLoss == 0
  maxDrawdown: number
  tradeCount: number
  medianPositionSizeUsd: number
}
```

- [ ] **Step 3: Create `src/domain/finding.ts` (evidence schemas for all 11 detectors)**

```ts
import type { PositionSide } from './position'

export type FindingSeverity = 'info' | 'warning' | 'critical'
export type DetectorId =
  | 'revenge_trading'
  | 'oversized_positions'
  | 'loss_of_discipline_windows'
  | 'position_sizing_instability'
  | 'cut_winners_ride_losers'
  | 'overtrading_after_losses'
  | 'fee_drag'
  | 'scaling_into_losers'
  | 'short_hold_scalping'
  | 'symbol_underperformance'
  | 'leverage_creep'

export type Finding<TEvidence = unknown> = {
  id: string
  userId: string
  detectorId: DetectorId
  severity: FindingSeverity
  title: string
  bodyMarkdown: string
  evidence: TEvidence
  referencedPositionIds: string[]
  periodStart: Date | null
  periodEnd: Date | null
  derivationVersion: number
}

// ---- per-detector evidence types ----

export type RevengeTradingEvidence = {
  thresholdMinutes: number
  thresholdSizeMultiplier: number
  medianSizeUsd: number
  instances: Array<{
    positionId: string
    priorPositionId: string
    minutesBetween: number
    priorRealizedPnlUsd: number
    sizeMultiplierVsMedian: number
  }>
}

export type OversizedPositionsEvidence = {
  baselineLossRate: number
  topDecileLossRate: number
  ratio: number
  topDecilePositionIds: string[]
  sampleSize: number
}

export type LossOfDisciplineWindowsEvidence = {
  meanExpectancyUsd: number
  stdExpectancyUsd: number
  sigmaThreshold: number
  windows: Array<{
    hourOfDayUtc: number
    tradeCount: number
    expectancyUsd: number
    sigmasBelowMean: number
  }>
}

export type PositionSizingInstabilityEvidence = {
  priorVariance: number
  recentVariance: number
  ratio: number
  windowDays: number
}

export type CutWinnersRideLosersEvidence = {
  avgWinDurationMinutes: number
  avgLossDurationMinutes: number
  durationRatio: number
  avgWinUsd: number
  avgLossUsd: number
}

export type OvertradingAfterLossesEvidence = {
  avgTradesAfterLoss: number
  avgTradesAfterWin: number
  ratio: number
  daysAfterLoss: number
  daysAfterWin: number
}

export type FeeDragEvidence = {
  totalFeesUsd: number
  grossPnlUsd: number
  feeRatio: number
  flippedProfitToLoss: boolean
}

export type ScalingIntoLosersEvidence = {
  addsUnderwater: number
  addsInProfit: number
  ratio: number
  samplePositionIds: string[]
}

export type ShortHoldScalpingEvidence = {
  shortHoldExpectancyUsd: number
  longHoldExpectancyUsd: number
  sigmasBelow: number
  shortHoldSampleSize: number
}

export type SymbolUnderperformanceEvidence = {
  overallExpectancyUsd: number
  stdExpectancyUsd: number
  sigmaThreshold: number
  symbols: Array<{
    symbol: string
    tradeCount: number
    expectancyUsd: number
    sigmasBelowMean: number
  }>
}

export type LeverageCreepEvidence = {
  priorAvgMaxNotionalUsd: number
  recentAvgMaxNotionalUsd: number
  ratio: number
  priorSampleSize: number
  recentSampleSize: number
  windowDays: number
}
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/domain/position.ts src/domain/metrics.ts src/domain/finding.ts
git commit -m "feat(domain): Position + Finding types + 11 evidence schemas"
```

---

## Task 3 — Fixture helper + steady-discipline baseline

**Why:** All detector tests + the integration test consume CSV fixtures in HL format. A tiny helper + the shared negative-case fixture unblocks every subsequent detector task. Each detector task adds its own positive fixture.

**Files:**
- Create: `tests/_support/fixtures.ts`
- Create: `fixtures/steady-discipline.csv`
- Create: `tests/integration/derivation/fixtures.test.ts` (smoke test)

- [ ] **Step 1: Create `tests/_support/fixtures.ts`**

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { HyperliquidCsvAdapter } from '~/ingestion/adapters/hyperliquid-csv'
import type { CanonicalFill } from '~/domain/fill'

export function loadHlFixture(name: string): (CanonicalFill & { id: string })[] {
  const path = resolve(process.cwd(), 'fixtures', name)
  const csv = readFileSync(path, 'utf8')
  const adapter = new HyperliquidCsvAdapter()
  const fills: (CanonicalFill & { id: string })[] = []
  // run the adapter synchronously for tests
  return runAdapter(adapter, csv)
}

function runAdapter(adapter: HyperliquidCsvAdapter, csv: string) {
  const fills: (CanonicalFill & { id: string })[] = []
  const gen = adapter.parse(csv, 'test-import')
  // Node's async iterator in sync test — use IIFE
  const rows: Array<{ raw: Record<string, unknown>; rowIndex: number }> = []
  ;(async () => {
    for await (const r of gen) rows.push(r)
  })()
  // papaparse is synchronous inside the generator, so rows populate immediately
  for (const row of rows) {
    const fill = adapter.normalize(row)
    if (fill) {
      fills.push({ ...fill, id: `fill_test_${row.rowIndex}` })
    }
  }
  return fills
}

/**
 * Returns HL CSV line. Prices in USD, sizes in base asset.
 * dir examples: 'Open Long', 'Add Long', 'Reduce Long', 'Close Long',
 *               'Open Short', 'Add Short', 'Reduce Short', 'Close Short', 'Liquidation'
 */
export function hlRow(args: {
  timeMs: number
  coin: string
  side: 'A' | 'B'
  px: number
  sz: number
  dir: string
  closedPnl?: number
  fee?: number
  tid: number
}): string {
  const { timeMs, coin, side, px, sz, dir, closedPnl = 0, fee = 0, tid } = args
  return `${timeMs},${coin},${side},${px},${sz},${dir},${closedPnl},${fee},USDC,0,0xhash${tid},${tid}`
}

export const HL_HEADER = 'time,coin,side,px,sz,dir,closedPnl,fee,feeToken,startPosition,hash,tid'
export const BASE_TIME_MS = 1704067200000 // 2024-01-01T00:00:00Z
export const MIN = 60_000
export const HOUR = 3_600_000
export const DAY = 86_400_000
```

Note: `runAdapter` above is tricky because the adapter's `parse` is an async generator. Replace it with a simpler synchronous parse:

```ts
import Papa from 'papaparse'

function runAdapter(adapter: HyperliquidCsvAdapter, csv: string) {
  const parsed = Papa.parse<Record<string, string>>(csv.trim(), { header: true, skipEmptyLines: true })
  const fills: (CanonicalFill & { id: string })[] = []
  let i = 0
  for (const raw of parsed.data) {
    const fill = adapter.normalize({ raw: raw as Record<string, unknown>, rowIndex: i })
    if (fill) fills.push({ ...fill, id: `fill_test_${i}` })
    i++
  }
  return fills
}
```

Use the Papa-based version. Delete the generator-based stub.

- [ ] **Step 2: Create `fixtures/steady-discipline.csv`**

30 balanced trades across BTC / ETH / SOL, ~55% win rate, consistent 0.01 BTC / 0.1 ETH / 1.0 SOL sizing, spread across morning + afternoon UTC hours. No revenge patterns, low fees. Timestamps start at 2024-01-01.

```csv
time,coin,side,px,sz,dir,closedPnl,fee,feeToken,startPosition,hash,tid
1704070800000,BTC,B,42000,0.01,Open Long,0,0.21,USDC,0,0xhash1001,1001
1704081600000,BTC,A,42500,0.01,Close Long,5,0.2125,USDC,0.01,0xhash1002,1002
1704157200000,ETH,B,2400,0.1,Open Long,0,0.12,USDC,0,0xhash1003,1003
1704168000000,ETH,A,2430,0.1,Close Long,3,0.1215,USDC,0.1,0xhash1004,1004
1704243600000,SOL,B,100,1.0,Open Long,0,0.05,USDC,0,0xhash1005,1005
1704254400000,SOL,A,102,1.0,Close Long,2,0.051,USDC,1.0,0xhash1006,1006
1704330000000,BTC,B,42100,0.01,Open Long,0,0.21,USDC,0,0xhash1007,1007
1704340800000,BTC,A,41900,0.01,Close Long,-2,0.2095,USDC,0.01,0xhash1008,1008
1704416400000,ETH,B,2410,0.1,Open Long,0,0.12,USDC,0,0xhash1009,1009
1704427200000,ETH,A,2440,0.1,Close Long,3,0.122,USDC,0.1,0xhash1010,1010
1704502800000,SOL,B,101,1.0,Open Long,0,0.05,USDC,0,0xhash1011,1011
1704513600000,SOL,A,103,1.0,Close Long,2,0.0515,USDC,1.0,0xhash1012,1012
1704589200000,BTC,B,42200,0.01,Open Long,0,0.21,USDC,0,0xhash1013,1013
1704600000000,BTC,A,42600,0.01,Close Long,4,0.213,USDC,0.01,0xhash1014,1014
1704675600000,ETH,B,2420,0.1,Open Long,0,0.12,USDC,0,0xhash1015,1015
1704686400000,ETH,A,2395,0.1,Close Long,-2.5,0.11975,USDC,0.1,0xhash1016,1016
1704762000000,SOL,B,102,1.0,Open Long,0,0.05,USDC,0,0xhash1017,1017
1704772800000,SOL,A,104,1.0,Close Long,2,0.052,USDC,1.0,0xhash1018,1018
1704848400000,BTC,B,42300,0.01,Open Long,0,0.21,USDC,0,0xhash1019,1019
1704859200000,BTC,A,42700,0.01,Close Long,4,0.2135,USDC,0.01,0xhash1020,1020
1704934800000,ETH,B,2430,0.1,Open Long,0,0.12,USDC,0,0xhash1021,1021
1704945600000,ETH,A,2460,0.1,Close Long,3,0.123,USDC,0.1,0xhash1022,1022
1705021200000,SOL,B,103,1.0,Open Long,0,0.05,USDC,0,0xhash1023,1023
1705032000000,SOL,A,105,1.0,Close Long,2,0.0525,USDC,1.0,0xhash1024,1024
1705107600000,BTC,B,42400,0.01,Open Long,0,0.21,USDC,0,0xhash1025,1025
1705118400000,BTC,A,42100,0.01,Close Long,-3,0.2105,USDC,0.01,0xhash1026,1026
1705194000000,ETH,B,2440,0.1,Open Long,0,0.12,USDC,0,0xhash1027,1027
1705204800000,ETH,A,2470,0.1,Close Long,3,0.1235,USDC,0.1,0xhash1028,1028
1705280400000,SOL,B,104,1.0,Open Long,0,0.05,USDC,0,0xhash1029,1029
1705291200000,SOL,A,106,1.0,Close Long,2,0.053,USDC,1.0,0xhash1030,1030
```

- [ ] **Step 3: Create `tests/integration/derivation/fixtures.test.ts`**

```ts
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
```

- [ ] **Step 4: Run + commit**

Run: `pnpm vitest run tests/integration/derivation/fixtures.test.ts`
Expected: 1 passing.

```bash
git add tests/_support/fixtures.ts fixtures/steady-discipline.csv tests/integration/derivation/fixtures.test.ts
git commit -m "test(derivation): fixture loader + steady-discipline baseline"
```

---

## Task 4 — Position merger (TDD)

**Why:** Merging is the single hardest correctness problem in this project (see Risk #1 in the spec). Build with TDD: every branch of the algorithm gets a test before implementation. Each test uses in-memory `CanonicalFill` objects — no DB, no CSV parsing.

**Files:**
- Create: `src/derivation/merge.ts`
- Create: `tests/unit/derivation/merge.test.ts`

- [ ] **Step 1: Write failing tests for a single full-open full-close perp long**

Create `tests/unit/derivation/merge.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mergeFillsIntoPositions } from '~/derivation/merge'
import type { CanonicalFill } from '~/domain/fill'

type F = CanonicalFill & { id: string }

function mkFill(o: Partial<F> & { id: string; tid: number }): F {
  return {
    id: o.id,
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/derivation/merge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal `src/derivation/merge.ts`**

```ts
import type { CanonicalFill } from '~/domain/fill'
import type { Position, PositionFillRef, PositionRole, PositionSide } from '~/domain/position'

type Fill = CanonicalFill & { id: string }

type Builder = {
  userId: string
  exchange: CanonicalFill['exchange']
  symbol: string
  instrumentType: CanonicalFill['instrumentType']
  side: PositionSide
  fills: PositionFillRef[]
  openedAt: Date
  netSize: number
  weightedEntrySum: number
  weightedExitSum: number
  totalOpenSize: number
  totalExitSize: number
  totalFees: number
  realizedPnl: number
  wasLiquidated: boolean
  maxNotionalUsd: number
  currentAvgEntry: number
  derivationVersion: number
}

function readDir(f: Fill): string | undefined {
  const hint = f.normalizerHint as { dir?: string } | null | undefined
  return hint?.dir
}

function interpretDir(dir: string | undefined): {
  kind: 'open' | 'add' | 'reduce' | 'close' | 'liq' | 'unknown'
  side: PositionSide | null
} {
  if (!dir) return { kind: 'unknown', side: null }
  if (dir === 'Liquidation') return { kind: 'liq', side: null }
  const side: PositionSide | null = dir.includes('Long') ? 'long' : dir.includes('Short') ? 'short' : null
  if (dir.startsWith('Open')) return { kind: 'open', side }
  if (dir.startsWith('Add')) return { kind: 'add', side }
  if (dir.startsWith('Reduce')) return { kind: 'reduce', side }
  if (dir.startsWith('Close')) return { kind: 'close', side }
  return { kind: 'unknown', side }
}

function num(s: string): number {
  return parseFloat(s)
}

function positionId(userId: string, symbol: string, openedAt: Date, tid: string): string {
  return `pos_${userId.slice(0, 8)}_${symbol}_${openedAt.getTime().toString(36)}_${tid.slice(0, 8)}`
}

function buildOpen(userId: string, f: Fill, side: PositionSide, version: number): Builder {
  const price = num(f.price), size = num(f.size), fee = num(f.fee)
  return {
    userId,
    exchange: f.exchange,
    symbol: f.symbol,
    instrumentType: f.instrumentType,
    side,
    fills: [{ fillId: f.id, role: 'open', price, size, fee, executedAt: f.executedAt }],
    openedAt: f.executedAt,
    netSize: size,
    weightedEntrySum: price * size,
    weightedExitSum: 0,
    totalOpenSize: size,
    totalExitSize: 0,
    totalFees: fee,
    realizedPnl: 0,
    wasLiquidated: false,
    maxNotionalUsd: price * size,
    currentAvgEntry: price,
    derivationVersion: version,
  }
}

function finalize(b: Builder, closedAt: Date | null): Position {
  const entryAvgPrice = b.totalOpenSize > 0 ? b.weightedEntrySum / b.totalOpenSize : 0
  const exitAvgPrice = b.totalExitSize > 0 ? b.weightedExitSum / b.totalExitSize : null
  const firstFillId = b.fills[0]?.fillId ?? 'unknown'
  return {
    id: positionId(b.userId, b.symbol, b.openedAt, firstFillId),
    userId: b.userId,
    exchange: b.exchange,
    symbol: b.symbol,
    instrumentType: b.instrumentType,
    side: b.side,
    entryAvgPrice,
    exitAvgPrice,
    size: b.totalOpenSize,
    notionalUsd: b.weightedEntrySum,
    maxNotionalUsd: b.maxNotionalUsd,
    realizedPnl: b.realizedPnl,
    totalFees: b.totalFees,
    fundingPnl: 0,
    wasLiquidated: b.wasLiquidated,
    needsReview: false,
    openedAt: b.openedAt,
    closedAt,
    fills: b.fills,
    derivationVersion: b.derivationVersion,
  }
}

export function mergeFillsIntoPositions(
  userId: string,
  fills: Fill[],
  derivationVersion: number,
): Position[] {
  // Group by (exchange, symbol, instrumentType); merge within each group
  const groups = new Map<string, Fill[]>()
  for (const f of fills) {
    const k = `${f.exchange}::${f.symbol}::${f.instrumentType}`
    const g = groups.get(k) ?? []
    g.push(f)
    groups.set(k, g)
  }
  const positions: Position[] = []
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime())
    positions.push(...mergeOne(userId, sorted, derivationVersion))
  }
  return positions
}

function mergeOne(userId: string, sorted: Fill[], version: number): Position[] {
  const out: Position[] = []
  let b: Builder | null = null

  for (const f of sorted) {
    const price = num(f.price), size = num(f.size), fee = num(f.fee)
    const intent = interpretDir(readDir(f))

    // Opening case
    if (!b) {
      const side: PositionSide | null = intent.side ?? (intent.kind === 'liq' ? null : null)
      if (intent.kind === 'open' && side) {
        b = buildOpen(userId, f, side, version)
        continue
      }
      // No dir hint: infer from side (buy → long open)
      if (intent.kind === 'unknown') {
        const inferred: PositionSide = f.side === 'buy' ? 'long' : 'short'
        b = buildOpen(userId, f, inferred, version)
        continue
      }
      // close/reduce/liq without open → flag and skip
      const orphan = buildOpen(userId, f, f.side === 'buy' ? 'long' : 'short', version)
      orphan.fills[0]!.role = 'close'
      const p = finalize(orphan, f.executedAt)
      out.push({ ...p, needsReview: true })
      continue
    }

    // Position is open
    const effective = intent.kind === 'unknown'
      ? inferIntent(b, f)
      : intent

    if (effective.kind === 'open') {
      // Side-flip: close existing, open new opposite
      if (effective.side && effective.side !== b.side) {
        b.fills.push({ fillId: f.id, role: 'close', price, size, fee, executedAt: f.executedAt })
        b.totalFees += fee
        // close out remaining netSize against this fill
        const closeSize = Math.min(b.netSize, size)
        b.weightedExitSum += price * closeSize
        b.totalExitSize += closeSize
        b.realizedPnl += pnlFor(b.side, b.currentAvgEntry, price, closeSize)
        out.push(finalize(b, f.executedAt))
        // remainder opens opposite-side position
        const remainder = size - closeSize
        if (remainder > 0) {
          const flip: Fill = { ...f, size: String(remainder) }
          b = buildOpen(userId, flip, effective.side, version)
        } else {
          b = null
        }
        continue
      }
      // Same-side "Open" while in a position → treat as add
      effective.kind = 'add'
    }

    if (effective.kind === 'add') {
      b.fills.push({ fillId: f.id, role: 'add', price, size, fee, executedAt: f.executedAt })
      b.netSize += size
      b.weightedEntrySum += price * size
      b.totalOpenSize += size
      b.totalFees += fee
      b.currentAvgEntry = b.weightedEntrySum / b.totalOpenSize
      b.maxNotionalUsd = Math.max(b.maxNotionalUsd, b.currentAvgEntry * b.netSize)
      continue
    }

    if (effective.kind === 'reduce' || effective.kind === 'close' || effective.kind === 'liq') {
      const closeSize = Math.min(b.netSize, size)
      const role: PositionRole = closeSize >= b.netSize - 1e-12 ? 'close' : 'reduce'
      b.fills.push({ fillId: f.id, role, price, size: closeSize, fee, executedAt: f.executedAt })
      b.totalFees += fee
      b.netSize -= closeSize
      b.weightedExitSum += price * closeSize
      b.totalExitSize += closeSize
      b.realizedPnl += pnlFor(b.side, b.currentAvgEntry, price, closeSize)
      if (effective.kind === 'liq') b.wasLiquidated = true
      if (b.netSize <= 1e-12) {
        out.push(finalize(b, f.executedAt))
        b = null
      }
    }
  }

  if (b) out.push(finalize(b, null))
  return out
}

function inferIntent(b: Builder, f: Fill): { kind: 'add' | 'reduce' | 'close', side: PositionSide | null } {
  // For longs: buy = add, sell = reduce/close
  // For shorts: sell = add, buy = reduce/close
  const isAdd = (b.side === 'long' && f.side === 'buy') || (b.side === 'short' && f.side === 'sell')
  if (isAdd) return { kind: 'add', side: b.side }
  return { kind: num(f.size) >= b.netSize - 1e-12 ? 'close' : 'reduce', side: b.side }
}

function pnlFor(side: PositionSide, entry: number, exit: number, size: number): number {
  return side === 'long' ? (exit - entry) * size : (entry - exit) * size
}
```

- [ ] **Step 4: Run test; expect PASS**

Run: `pnpm vitest run tests/unit/derivation/merge.test.ts`
Expected: 1 passing.

- [ ] **Step 5: Add tests for: add, reduce, partial close, side-flip, still-open, liquidation, spot FIFO**

Append to the same test file:

```ts
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
```

- [ ] **Step 6: Run all merge tests and iterate until green**

Run: `pnpm vitest run tests/unit/derivation/merge.test.ts`
Expected: all 7 tests pass.

If side-flip or FIFO fails, debug the specific branch. The merger already handles these — verify your implementation matches the pseudocode above.

- [ ] **Step 7: Commit**

```bash
git add src/derivation/merge.ts tests/unit/derivation/merge.test.ts
git commit -m "feat(derivation): position merger with perp + spot + side-flip coverage"
```

---

## Task 5 — Metrics computations (TDD)

**Files:**
- Create: `src/derivation/metrics/shared.ts`
- Create: `src/derivation/metrics/daily.ts`
- Create: `src/derivation/metrics/asset.ts`
- Create: `src/derivation/metrics/session.ts`
- Create: `src/derivation/metrics/summary.ts`
- Create: `tests/unit/derivation/metrics.test.ts`

- [ ] **Step 1: Write `src/derivation/metrics/shared.ts`**

```ts
export function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length
  return Math.sqrt(v)
}

export function variance(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[idx]!
}

export function expectancy(wins: number[], losses: number[]): number {
  const n = wins.length + losses.length
  if (n === 0) return 0
  const winRate = wins.length / n
  const avgWin = mean(wins)
  const avgLoss = losses.length ? Math.abs(mean(losses)) : 0
  return winRate * avgWin - (1 - winRate) * avgLoss
}

export function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
```

- [ ] **Step 2: Write `src/derivation/metrics/daily.ts`**

```ts
import type { Position } from '~/domain/position'
import type { DailyMetricValue } from '~/domain/metrics'
import { utcDate } from './shared'

export function computeDailyMetrics(positions: Position[]): DailyMetricValue[] {
  const byDate = new Map<string, DailyMetricValue>()
  for (const p of positions) {
    if (!p.closedAt) continue
    const date = utcDate(p.closedAt)
    const cur = byDate.get(date) ?? {
      date, tradeCount: 0, realizedPnl: 0, volumeUsd: 0,
      winCount: 0, lossCount: 0, totalFees: 0,
    }
    cur.tradeCount += 1
    cur.realizedPnl += p.realizedPnl
    cur.volumeUsd += p.notionalUsd
    cur.totalFees += p.totalFees
    if (p.realizedPnl > 0) cur.winCount += 1
    else if (p.realizedPnl < 0) cur.lossCount += 1
    byDate.set(date, cur)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}
```

- [ ] **Step 3: Write `src/derivation/metrics/asset.ts`**

```ts
import type { Position } from '~/domain/position'
import type { AssetMetricValue } from '~/domain/metrics'
import { expectancy, mean } from './shared'

export function computeAssetMetrics(positions: Position[]): AssetMetricValue[] {
  const bySymbol = new Map<string, Position[]>()
  for (const p of positions) {
    if (!p.closedAt) continue
    const list = bySymbol.get(p.symbol) ?? []
    list.push(p)
    bySymbol.set(p.symbol, list)
  }
  const out: AssetMetricValue[] = []
  for (const [symbol, ps] of bySymbol) {
    const wins = ps.filter(p => p.realizedPnl > 0).map(p => p.realizedPnl)
    const losses = ps.filter(p => p.realizedPnl < 0).map(p => p.realizedPnl)
    const realizedPnl = ps.reduce((a, b) => a + b.realizedPnl, 0)
    out.push({
      symbol,
      tradeCount: ps.length,
      realizedPnl,
      winRate: ps.length ? wins.length / ps.length : 0,
      avgWin: wins.length ? mean(wins) : 0,
      avgLoss: losses.length ? mean(losses) : 0,
      expectancy: expectancy(wins, losses),
    })
  }
  return out.sort((a, b) => b.realizedPnl - a.realizedPnl)
}
```

- [ ] **Step 4: Write `src/derivation/metrics/session.ts`**

```ts
import type { Position } from '~/domain/position'
import type { SessionMetricValue } from '~/domain/metrics'
import { expectancy } from './shared'

export function computeSessionMetrics(positions: Position[]): SessionMetricValue[] {
  const byHour = new Map<number, Position[]>()
  for (const p of positions) {
    if (!p.closedAt) continue
    const hour = p.openedAt.getUTCHours()
    const list = byHour.get(hour) ?? []
    list.push(p)
    byHour.set(hour, list)
  }
  const out: SessionMetricValue[] = []
  for (const [hourOfDayUtc, ps] of byHour) {
    const wins = ps.filter(p => p.realizedPnl > 0).map(p => p.realizedPnl)
    const losses = ps.filter(p => p.realizedPnl < 0).map(p => p.realizedPnl)
    out.push({
      hourOfDayUtc,
      tradeCount: ps.length,
      realizedPnl: ps.reduce((a, b) => a + b.realizedPnl, 0),
      winRate: ps.length ? wins.length / ps.length : 0,
      expectancy: expectancy(wins, losses),
    })
  }
  return out.sort((a, b) => a.hourOfDayUtc - b.hourOfDayUtc)
}
```

- [ ] **Step 5: Write `src/derivation/metrics/summary.ts`**

```ts
import type { Position } from '~/domain/position'
import type { SummaryRollupValue } from '~/domain/metrics'
import type { DailyMetricValue } from '~/domain/metrics'
import { mean, median } from './shared'

export function computeSummaryRollup(
  positions: Position[],
  daily: DailyMetricValue[],
): SummaryRollupValue {
  const closed = positions.filter(p => p.closedAt)
  const wins = closed.filter(p => p.realizedPnl > 0).map(p => p.realizedPnl)
  const losses = closed.filter(p => p.realizedPnl < 0).map(p => p.realizedPnl)
  const grossProfit = wins.reduce((a, b) => a + b, 0)
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0))
  const totalPnl = grossProfit - grossLoss
  const totalFees = closed.reduce((a, b) => a + b.totalFees, 0)
  const winRate = closed.length ? wins.length / closed.length : 0
  const avgWin = wins.length ? mean(wins) : 0
  const avgLoss = losses.length ? mean(losses) : 0
  const expectancyVal = winRate * avgWin - (1 - winRate) * Math.abs(avgLoss)

  // Max drawdown on equity curve from daily metrics
  let peak = 0, cum = 0, maxDd = 0
  const sortedDaily = [...daily].sort((a, b) => a.date.localeCompare(b.date))
  for (const d of sortedDaily) {
    cum += d.realizedPnl
    peak = Math.max(peak, cum)
    maxDd = Math.max(maxDd, peak - cum)
  }

  return {
    totalPnl,
    grossProfit,
    grossLoss,
    totalFees,
    winRate,
    expectancy: expectancyVal,
    avgWin,
    avgLoss,
    profitFactor: grossLoss === 0 ? null : grossProfit / grossLoss,
    maxDrawdown: maxDd,
    tradeCount: closed.length,
    medianPositionSizeUsd: median(closed.map(p => p.notionalUsd)),
  }
}
```

- [ ] **Step 6: Write `tests/unit/derivation/metrics.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { computeDailyMetrics } from '~/derivation/metrics/daily'
import { computeAssetMetrics } from '~/derivation/metrics/asset'
import { computeSessionMetrics } from '~/derivation/metrics/session'
import { computeSummaryRollup } from '~/derivation/metrics/summary'
import type { Position } from '~/domain/position'

function p(overrides: Partial<Position> & { id: string; realizedPnl: number; openedAt: Date; closedAt: Date }): Position {
  return {
    id: overrides.id,
    userId: 'u1',
    exchange: 'hyperliquid',
    symbol: 'BTC',
    instrumentType: 'perp',
    side: 'long',
    entryAvgPrice: 40000,
    exitAvgPrice: 41000,
    size: 0.01,
    notionalUsd: 400,
    maxNotionalUsd: 400,
    realizedPnl: overrides.realizedPnl,
    totalFees: 0.4,
    fundingPnl: 0,
    wasLiquidated: false,
    needsReview: false,
    openedAt: overrides.openedAt,
    closedAt: overrides.closedAt,
    fills: [],
    derivationVersion: 1,
    ...overrides,
  } as Position
}

describe('computeDailyMetrics', () => {
  it('groups positions by UTC date of closedAt', () => {
    const positions = [
      p({ id: 'p1', realizedPnl: 10, openedAt: new Date('2024-01-01T09:00Z'), closedAt: new Date('2024-01-01T10:00Z') }),
      p({ id: 'p2', realizedPnl: -5, openedAt: new Date('2024-01-01T14:00Z'), closedAt: new Date('2024-01-01T15:00Z') }),
      p({ id: 'p3', realizedPnl: 7, openedAt: new Date('2024-01-02T09:00Z'), closedAt: new Date('2024-01-02T10:00Z') }),
    ]
    const daily = computeDailyMetrics(positions)
    expect(daily).toHaveLength(2)
    expect(daily[0]!.date).toBe('2024-01-01')
    expect(daily[0]!.realizedPnl).toBeCloseTo(5, 2)
    expect(daily[0]!.winCount).toBe(1)
    expect(daily[0]!.lossCount).toBe(1)
    expect(daily[1]!.date).toBe('2024-01-02')
  })
})

describe('computeAssetMetrics', () => {
  it('aggregates per symbol with expectancy', () => {
    const positions = [
      p({ id: 'p1', symbol: 'BTC', realizedPnl: 10, openedAt: new Date(0), closedAt: new Date(1) }),
      p({ id: 'p2', symbol: 'BTC', realizedPnl: -4, openedAt: new Date(0), closedAt: new Date(1) }),
      p({ id: 'p3', symbol: 'ETH', realizedPnl: 3, openedAt: new Date(0), closedAt: new Date(1) }),
    ]
    const asset = computeAssetMetrics(positions)
    const btc = asset.find(a => a.symbol === 'BTC')!
    expect(btc.tradeCount).toBe(2)
    expect(btc.winRate).toBe(0.5)
    expect(btc.expectancy).toBeCloseTo(0.5 * 10 - 0.5 * 4, 2) // 3
  })
})

describe('computeSessionMetrics', () => {
  it('buckets positions by UTC hour of openedAt', () => {
    const positions = [
      p({ id: 'p1', realizedPnl: 10, openedAt: new Date('2024-01-01T09:30Z'), closedAt: new Date('2024-01-01T10:00Z') }),
      p({ id: 'p2', realizedPnl: -5, openedAt: new Date('2024-01-02T09:00Z'), closedAt: new Date('2024-01-02T11:00Z') }),
      p({ id: 'p3', realizedPnl: 3, openedAt: new Date('2024-01-02T22:00Z'), closedAt: new Date('2024-01-03T00:00Z') }),
    ]
    const session = computeSessionMetrics(positions)
    const h9 = session.find(s => s.hourOfDayUtc === 9)!
    expect(h9.tradeCount).toBe(2)
    const h22 = session.find(s => s.hourOfDayUtc === 22)!
    expect(h22.tradeCount).toBe(1)
  })
})

describe('computeSummaryRollup', () => {
  it('computes profit factor, drawdown, median size', () => {
    const positions = [
      p({ id: 'p1', realizedPnl: 10, openedAt: new Date('2024-01-01'), closedAt: new Date('2024-01-01T01:00Z') }),
      p({ id: 'p2', realizedPnl: -5, openedAt: new Date('2024-01-02'), closedAt: new Date('2024-01-02T01:00Z') }),
      p({ id: 'p3', realizedPnl: 8, openedAt: new Date('2024-01-03'), closedAt: new Date('2024-01-03T01:00Z') }),
    ]
    const daily = computeDailyMetrics(positions)
    const s = computeSummaryRollup(positions, daily)
    expect(s.totalPnl).toBeCloseTo(13, 2)
    expect(s.winRate).toBeCloseTo(2 / 3, 4)
    expect(s.profitFactor).toBeCloseTo(18 / 5, 2)
    expect(s.maxDrawdown).toBeCloseTo(5, 2)
    expect(s.medianPositionSizeUsd).toBe(400)
  })
})
```

- [ ] **Step 7: Run tests**

Run: `pnpm vitest run tests/unit/derivation/metrics.test.ts`
Expected: 4 passing.

- [ ] **Step 8: Commit**

```bash
git add src/derivation/metrics tests/unit/derivation/metrics.test.ts
git commit -m "feat(derivation): daily/asset/session/summary metrics + shared stats helpers"
```

---

## Task 6 — Detector: `revenge_trading`

**Rule:** Opens a new position within ≤15 minutes of a losing close AND sized >1.5× median position size.

**Files:**
- Create: `fixtures/revenge-trader.csv`
- Create: `src/derivation/detectors/revenge-trading.ts`
- Create: `tests/unit/derivation/detectors/revenge-trading.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/derivation/detectors/revenge-trading.test.ts
import { describe, it, expect } from 'vitest'
import { RevengeTradingDetector } from '~/derivation/detectors/revenge-trading'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { Position } from '~/domain/position'

const MIN = 60_000
function buildCtx(positions: Position[]): DerivationContext {
  return {
    userId: 'u1',
    derivationVersion: 1,
    now: new Date(),
    fills: [],
    positions,
    summary: { totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0, winRate: 0, expectancy: 0,
               avgWin: 0, avgLoss: 0, profitFactor: null, maxDrawdown: 0, tradeCount: 0,
               medianPositionSizeUsd: 400 },
    daily: [], asset: [], session: [],
  }
}
function pos(o: { id: string; pnl: number; notionalUsd: number; openedAt: Date; closedAt: Date }): Position {
  return {
    id: o.id, userId: 'u1', exchange: 'hyperliquid', symbol: 'BTC',
    instrumentType: 'perp', side: 'long',
    entryAvgPrice: 40000, exitAvgPrice: 41000, size: o.notionalUsd / 40000,
    notionalUsd: o.notionalUsd, maxNotionalUsd: o.notionalUsd,
    realizedPnl: o.pnl, totalFees: 0.4, fundingPnl: 0,
    wasLiquidated: false, needsReview: false,
    openedAt: o.openedAt, closedAt: o.closedAt, fills: [], derivationVersion: 1,
  }
}

describe('revenge_trading detector', () => {
  it('fires when a loss is followed <15 min by a >1.5× median position', () => {
    const t = Date.UTC(2024, 0, 1, 9, 0, 0)
    const positions: Position[] = [
      pos({ id: 'p1', pnl: -20, notionalUsd: 400, openedAt: new Date(t), closedAt: new Date(t + 30 * MIN) }),
      pos({ id: 'p2', pnl: -5,  notionalUsd: 800, openedAt: new Date(t + 35 * MIN), closedAt: new Date(t + 60 * MIN) }), // 5 min after loss, 2× median
    ]
    const ctx = buildCtx(positions)
    const findings = new RevengeTradingDetector().run(ctx)
    expect(findings).toHaveLength(1)
    const f = findings[0]!
    expect(f.detectorId).toBe('revenge_trading')
    expect(f.referencedPositionIds).toEqual(['p2'])
    expect(f.evidence).toMatchObject({ thresholdMinutes: 15, thresholdSizeMultiplier: 1.5 })
  })

  it('does not fire when gap > 15 min', () => {
    const t = 0
    const positions = [
      pos({ id: 'p1', pnl: -20, notionalUsd: 400, openedAt: new Date(t), closedAt: new Date(t + 10 * MIN) }),
      pos({ id: 'p2', pnl: -5, notionalUsd: 800, openedAt: new Date(t + 30 * MIN), closedAt: new Date(t + 60 * MIN) }),
    ]
    expect(new RevengeTradingDetector().run(buildCtx(positions))).toHaveLength(0)
  })

  it('does not fire when size ≤ 1.5× median', () => {
    const t = 0
    const positions = [
      pos({ id: 'p1', pnl: -20, notionalUsd: 400, openedAt: new Date(t), closedAt: new Date(t + 10 * MIN) }),
      pos({ id: 'p2', pnl: -5, notionalUsd: 500, openedAt: new Date(t + 12 * MIN), closedAt: new Date(t + 30 * MIN) }),
    ]
    expect(new RevengeTradingDetector().run(buildCtx(positions))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test; expect FAIL**

Run: `pnpm vitest run tests/unit/derivation/detectors/revenge-trading.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/derivation/detectors/revenge-trading.ts`**

```ts
import type { Detector, DerivationContext } from './types'
import type { Finding, RevengeTradingEvidence } from '~/domain/finding'
import { median } from '../metrics/shared'

const THRESHOLD_MINUTES = 15
const THRESHOLD_SIZE_MULTIPLIER = 1.5

export class RevengeTradingDetector implements Detector {
  readonly id = 'revenge_trading'
  readonly description = 'New position opened within 15m of a losing close at >1.5× median size'

  run(ctx: DerivationContext): Finding<RevengeTradingEvidence>[] {
    const closed = ctx.positions.filter(p => p.closedAt).sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime())
    const medianSize = median(closed.map(p => p.notionalUsd)) || ctx.summary.medianPositionSizeUsd
    if (!medianSize) return []

    const instances: RevengeTradingEvidence['instances'] = []
    const refs: string[] = []

    for (let i = 1; i < closed.length; i++) {
      const prev = closed[i - 1]!
      const cur = closed[i]!
      if (prev.realizedPnl >= 0 || !prev.closedAt) continue
      const minutesBetween = (cur.openedAt.getTime() - prev.closedAt.getTime()) / 60000
      if (minutesBetween < 0 || minutesBetween > THRESHOLD_MINUTES) continue
      const mult = cur.notionalUsd / medianSize
      if (mult <= THRESHOLD_SIZE_MULTIPLIER) continue
      instances.push({
        positionId: cur.id,
        priorPositionId: prev.id,
        minutesBetween,
        priorRealizedPnlUsd: prev.realizedPnl,
        sizeMultiplierVsMedian: mult,
      })
      refs.push(cur.id)
    }

    if (instances.length === 0) return []

    return [{
      id: `find_revenge_trading_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId,
      detectorId: 'revenge_trading',
      severity: instances.length >= 5 ? 'critical' : 'warning',
      title: 'Revenge trading pattern detected',
      bodyMarkdown: `${instances.length} instance(s) of opening a new position within ${THRESHOLD_MINUTES} minutes of a losing close at >${THRESHOLD_SIZE_MULTIPLIER}× your median size.`,
      evidence: {
        thresholdMinutes: THRESHOLD_MINUTES,
        thresholdSizeMultiplier: THRESHOLD_SIZE_MULTIPLIER,
        medianSizeUsd: medianSize,
        instances,
      },
      referencedPositionIds: refs,
      periodStart: closed[0]?.openedAt ?? null,
      periodEnd: closed[closed.length - 1]?.closedAt ?? null,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}
```

- [ ] **Step 4: Create `fixtures/revenge-trader.csv`**

20 baseline BTC positions at 0.01 BTC (median notional 400), plus 5 revenge instances: each preceded by a losing close, opened ≤10 min later at 0.02 BTC (2× median). Base time 1704067200000.

```csv
time,coin,side,px,sz,dir,closedPnl,fee,feeToken,startPosition,hash,tid
1704067200000,BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh2001,2001
1704070800000,BTC,A,40500,0.01,Close Long,5,0.2025,USDC,0.01,0xh2002,2002
1704074400000,BTC,B,40400,0.01,Open Long,0,0.202,USDC,0,0xh2003,2003
1704078000000,BTC,A,40000,0.01,Close Long,-4,0.2,USDC,0.01,0xh2004,2004
1704078300000,BTC,B,40000,0.02,Open Long,0,0.4,USDC,0,0xh2005,2005
1704081900000,BTC,A,39900,0.02,Close Long,-2,0.399,USDC,0.02,0xh2006,2006
1704085500000,BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh2007,2007
1704089100000,BTC,A,40200,0.01,Close Long,2,0.201,USDC,0.01,0xh2008,2008
1704092700000,BTC,B,40200,0.01,Open Long,0,0.201,USDC,0,0xh2009,2009
1704096300000,BTC,A,39800,0.01,Close Long,-4,0.199,USDC,0.01,0xh2010,2010
1704096600000,BTC,B,39800,0.02,Open Long,0,0.398,USDC,0,0xh2011,2011
1704100200000,BTC,A,39700,0.02,Close Long,-2,0.397,USDC,0.02,0xh2012,2012
1704103800000,BTC,B,39800,0.01,Open Long,0,0.199,USDC,0,0xh2013,2013
1704107400000,BTC,A,40000,0.01,Close Long,2,0.2,USDC,0.01,0xh2014,2014
1704111000000,BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh2015,2015
1704114600000,BTC,A,39700,0.01,Close Long,-3,0.1985,USDC,0.01,0xh2016,2016
1704114900000,BTC,B,39700,0.02,Open Long,0,0.397,USDC,0,0xh2017,2017
1704118500000,BTC,A,39800,0.02,Close Long,2,0.398,USDC,0.02,0xh2018,2018
1704122100000,BTC,B,39800,0.01,Open Long,0,0.199,USDC,0,0xh2019,2019
1704125700000,BTC,A,40100,0.01,Close Long,3,0.2005,USDC,0.01,0xh2020,2020
1704129300000,BTC,B,40100,0.01,Open Long,0,0.2005,USDC,0,0xh2021,2021
1704132900000,BTC,A,39700,0.01,Close Long,-4,0.1985,USDC,0.01,0xh2022,2022
1704133200000,BTC,B,39700,0.02,Open Long,0,0.397,USDC,0,0xh2023,2023
1704136800000,BTC,A,39800,0.02,Close Long,2,0.398,USDC,0.02,0xh2024,2024
1704140400000,BTC,B,39800,0.01,Open Long,0,0.199,USDC,0,0xh2025,2025
1704144000000,BTC,A,40000,0.01,Close Long,2,0.2,USDC,0.01,0xh2026,2026
1704147600000,BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh2027,2027
1704151200000,BTC,A,39700,0.01,Close Long,-3,0.1985,USDC,0.01,0xh2028,2028
1704151500000,BTC,B,39700,0.02,Open Long,0,0.397,USDC,0,0xh2029,2029
1704155100000,BTC,A,39800,0.02,Close Long,2,0.398,USDC,0.02,0xh2030,2030
```

- [ ] **Step 5: Run tests; verify green**

Run: `pnpm vitest run tests/unit/derivation/detectors/revenge-trading.test.ts`
Expected: 3 passing.

- [ ] **Step 6: Commit**

```bash
git add src/derivation/detectors/revenge-trading.ts fixtures/revenge-trader.csv tests/unit/derivation/detectors/revenge-trading.test.ts
git commit -m "feat(detectors): revenge_trading with fixture + unit tests"
```

---

## Task 7 — Detector: `oversized_positions`

**Rule:** Top 10% by notional have loss rate ≥1.5× baseline loss rate, across ≥15 positions in the top bucket.

**Files:**
- Create: `fixtures/size-bloater.csv`
- Create: `src/derivation/detectors/oversized-positions.ts`
- Create: `tests/unit/derivation/detectors/oversized-positions.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/derivation/detectors/oversized-positions.test.ts
import { describe, it, expect } from 'vitest'
import { OversizedPositionsDetector } from '~/derivation/detectors/oversized-positions'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { Position } from '~/domain/position'

function pos(id: string, notional: number, pnl: number): Position {
  return {
    id, userId: 'u1', exchange: 'hyperliquid', symbol: 'BTC',
    instrumentType: 'perp', side: 'long',
    entryAvgPrice: 40000, exitAvgPrice: 40000, size: notional / 40000,
    notionalUsd: notional, maxNotionalUsd: notional,
    realizedPnl: pnl, totalFees: 0.4, fundingPnl: 0,
    wasLiquidated: false, needsReview: false,
    openedAt: new Date(0), closedAt: new Date(1), fills: [], derivationVersion: 1,
  }
}
function ctx(positions: Position[]): DerivationContext {
  return {
    userId: 'u1', derivationVersion: 1, now: new Date(), fills: [], positions,
    summary: { totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0, winRate: 0, expectancy: 0,
               avgWin: 0, avgLoss: 0, profitFactor: null, maxDrawdown: 0, tradeCount: 0, medianPositionSizeUsd: 0 },
    daily: [], asset: [], session: [],
  }
}

describe('oversized_positions detector', () => {
  it('fires when top-decile loss rate ≥1.5× baseline and top has ≥15', () => {
    // 150 positions; top 15 (= 10%) are big losers, rest are 50/50
    const positions: Position[] = []
    for (let i = 0; i < 135; i++) positions.push(pos(`p${i}`, 400, i % 2 === 0 ? 10 : -10))
    for (let i = 0; i < 15; i++) positions.push(pos(`big${i}`, 2000, -50)) // all lose
    const findings = new OversizedPositionsDetector().run(ctx(positions))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.evidence).toMatchObject({ sampleSize: 15 })
  })

  it('does not fire with <15 top-decile positions', () => {
    const positions: Position[] = []
    for (let i = 0; i < 50; i++) positions.push(pos(`p${i}`, 400, i % 2 === 0 ? 10 : -10))
    for (let i = 0; i < 5; i++) positions.push(pos(`big${i}`, 2000, -50))
    expect(new OversizedPositionsDetector().run(ctx(positions))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Implement `src/derivation/detectors/oversized-positions.ts`**

```ts
import type { Detector, DerivationContext } from './types'
import type { Finding, OversizedPositionsEvidence } from '~/domain/finding'

const LOSS_RATIO_THRESHOLD = 1.5
const MIN_TOP_SAMPLE = 15

export class OversizedPositionsDetector implements Detector {
  readonly id = 'oversized_positions'
  readonly description = 'Top 10% by size have ≥1.5× baseline loss rate (min 15 top positions)'

  run(ctx: DerivationContext): Finding<OversizedPositionsEvidence>[] {
    const closed = ctx.positions.filter(p => p.closedAt)
    if (closed.length < MIN_TOP_SAMPLE * 10) return [] // need ≥150 for ≥15 in top decile

    const sorted = [...closed].sort((a, b) => b.notionalUsd - a.notionalUsd)
    const topCount = Math.floor(sorted.length * 0.1)
    if (topCount < MIN_TOP_SAMPLE) return []

    const top = sorted.slice(0, topCount)
    const rest = sorted.slice(topCount)
    const topLossRate = top.filter(p => p.realizedPnl < 0).length / top.length
    const baseLossRate = rest.filter(p => p.realizedPnl < 0).length / rest.length
    if (baseLossRate === 0) return []
    const ratio = topLossRate / baseLossRate
    if (ratio < LOSS_RATIO_THRESHOLD) return []

    return [{
      id: `find_oversized_positions_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId,
      detectorId: 'oversized_positions',
      severity: 'warning',
      title: 'Oversized positions lose more often',
      bodyMarkdown: `Your largest 10% of positions lose at ${(topLossRate * 100).toFixed(0)}% — ${ratio.toFixed(1)}× your baseline rate.`,
      evidence: {
        baselineLossRate: baseLossRate,
        topDecileLossRate: topLossRate,
        ratio,
        topDecilePositionIds: top.map(p => p.id),
        sampleSize: top.length,
      },
      referencedPositionIds: top.map(p => p.id),
      periodStart: sorted[sorted.length - 1]?.openedAt ?? null,
      periodEnd: sorted[0]?.closedAt ?? null,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}
```

- [ ] **Step 3: Create `fixtures/size-bloater.csv`** (150 BTC positions — 135 at 0.01 BTC with ~50% win rate, 15 at 0.05 BTC all losers). Generate programmatically in the fixture file:

Because writing 150 rows inline is unwieldy, use this shell one-liner to generate the fixture (run once, then commit the output file):

```bash
node -e '
const lines = ["time,coin,side,px,sz,dir,closedPnl,fee,feeToken,startPosition,hash,tid"];
let t = 1704067200000;
const HOUR = 3600000;
let tid = 3001;
// 135 normal positions
for (let i = 0; i < 135; i++) {
  const pnl = i % 2 === 0 ? 5 : -5;
  const exit = 40000 + pnl * 100;
  lines.push(`${t},BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh${tid},${tid}`); tid++;
  lines.push(`${t + HOUR},BTC,A,${exit},0.01,Close Long,${pnl},0.2,USDC,0.01,0xh${tid},${tid}`); tid++;
  t += 2 * HOUR;
}
// 15 oversized losers
for (let i = 0; i < 15; i++) {
  lines.push(`${t},BTC,B,40000,0.05,Open Long,0,1.0,USDC,0,0xh${tid},${tid}`); tid++;
  lines.push(`${t + HOUR},BTC,A,39000,0.05,Close Long,-50,0.975,USDC,0.05,0xh${tid},${tid}`); tid++;
  t += 2 * HOUR;
}
require("fs").writeFileSync("fixtures/size-bloater.csv", lines.join("\n") + "\n");
console.log("wrote", lines.length - 1, "rows");
'
```

- [ ] **Step 4: Run tests + commit**

Run: `pnpm vitest run tests/unit/derivation/detectors/oversized-positions.test.ts`
Expected: 2 passing.

```bash
git add src/derivation/detectors/oversized-positions.ts fixtures/size-bloater.csv tests/unit/derivation/detectors/oversized-positions.test.ts
git commit -m "feat(detectors): oversized_positions with fixture + unit tests"
```

---

## Task 8 — Detector: `loss_of_discipline_windows`

**Rule:** Hour-of-day buckets with ≥10 trades and expectancy ≥1.0σ below overall mean.

**Files:**
- Create: `fixtures/evening-tilt.csv`
- Create: `src/derivation/detectors/loss-of-discipline-windows.ts`
- Create: `tests/unit/derivation/detectors/loss-of-discipline-windows.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest'
import { LossOfDisciplineWindowsDetector } from '~/derivation/detectors/loss-of-discipline-windows'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { SessionMetricValue } from '~/domain/metrics'

function ctx(session: SessionMetricValue[]): DerivationContext {
  return {
    userId: 'u1', derivationVersion: 1, now: new Date(), fills: [], positions: [],
    summary: { totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0, winRate: 0, expectancy: 0,
               avgWin: 0, avgLoss: 0, profitFactor: null, maxDrawdown: 0, tradeCount: 0, medianPositionSizeUsd: 0 },
    daily: [], asset: [], session,
  }
}

describe('loss_of_discipline_windows', () => {
  it('fires on an hour bucket ≥1σ below mean with ≥10 trades', () => {
    const session: SessionMetricValue[] = [
      { hourOfDayUtc: 9,  tradeCount: 12, realizedPnl: 60,  winRate: 0.55, expectancy: 5 },
      { hourOfDayUtc: 14, tradeCount: 12, realizedPnl: 72,  winRate: 0.58, expectancy: 6 },
      { hourOfDayUtc: 16, tradeCount: 12, realizedPnl: 48,  winRate: 0.5,  expectancy: 4 },
      { hourOfDayUtc: 22, tradeCount: 12, realizedPnl: -360, winRate: 0.2, expectancy: -30 }, // way below
    ]
    const findings = new LossOfDisciplineWindowsDetector().run(ctx(session))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.evidence).toMatchObject({
      windows: expect.arrayContaining([expect.objectContaining({ hourOfDayUtc: 22 })]),
    })
  })

  it('ignores buckets with <10 trades', () => {
    const session: SessionMetricValue[] = [
      { hourOfDayUtc: 9,  tradeCount: 12, realizedPnl: 60,  winRate: 0.55, expectancy: 5 },
      { hourOfDayUtc: 22, tradeCount: 5,  realizedPnl: -100, winRate: 0.2, expectancy: -20 },
    ]
    expect(new LossOfDisciplineWindowsDetector().run(ctx(session))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/derivation/detectors/loss-of-discipline-windows.ts
import type { Detector, DerivationContext } from './types'
import type { Finding, LossOfDisciplineWindowsEvidence } from '~/domain/finding'
import { mean, stddev } from '../metrics/shared'

const MIN_TRADES = 10
const SIGMA_THRESHOLD = 1.0

export class LossOfDisciplineWindowsDetector implements Detector {
  readonly id = 'loss_of_discipline_windows'
  readonly description = 'Hour-of-day buckets ≥1σ below user mean expectancy, min 10 trades'

  run(ctx: DerivationContext): Finding<LossOfDisciplineWindowsEvidence>[] {
    const eligible = ctx.session.filter(s => s.tradeCount >= MIN_TRADES)
    if (eligible.length < 2) return []
    const expectancies = eligible.map(s => s.expectancy)
    const m = mean(expectancies)
    const sd = stddev(expectancies)
    if (sd === 0) return []

    const windows: LossOfDisciplineWindowsEvidence['windows'] = []
    for (const s of eligible) {
      const sigmas = (m - s.expectancy) / sd
      if (sigmas >= SIGMA_THRESHOLD) {
        windows.push({ hourOfDayUtc: s.hourOfDayUtc, tradeCount: s.tradeCount, expectancyUsd: s.expectancy, sigmasBelowMean: sigmas })
      }
    }
    if (windows.length === 0) return []

    return [{
      id: `find_lodw_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId, detectorId: 'loss_of_discipline_windows', severity: 'warning',
      title: 'Hour-of-day discipline windows',
      bodyMarkdown: `${windows.length} hour bucket(s) consistently underperform your overall expectancy.`,
      evidence: { meanExpectancyUsd: m, stdExpectancyUsd: sd, sigmaThreshold: SIGMA_THRESHOLD, windows },
      referencedPositionIds: [],
      periodStart: null, periodEnd: null,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}
```

- [ ] **Step 3: Create `fixtures/evening-tilt.csv`** via Node one-liner:

```bash
node -e '
const lines = ["time,coin,side,px,sz,dir,closedPnl,fee,feeToken,startPosition,hash,tid"];
const HOUR = 3600000;
let tid = 4001;
// 4 hour buckets × 12 trades: 3 healthy, 1 tilt
const dayStart = 1704067200000;
const buckets = [
  { hour: 9,  pnl: [5,5,5,-3,5,5,-3,5,5,5,5,-3] },
  { hour: 14, pnl: [6,6,6,-2,6,6,-2,6,6,6,6,-2] },
  { hour: 16, pnl: [4,4,4,-2,4,4,-2,4,4,4,4,-2] },
  { hour: 22, pnl: [-30,-30,-30,10,-30,-30,10,-30,-30,-30,-30,10] },
];
for (const b of buckets) {
  for (let i = 0; i < b.pnl.length; i++) {
    const t = dayStart + i * 24 * HOUR + b.hour * HOUR;
    const p = b.pnl[i]; const exit = 40000 + p * 10;
    lines.push(`${t},BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh${tid},${tid}`); tid++;
    lines.push(`${t + 30*60000},BTC,A,${exit},0.01,Close Long,${p},0.2,USDC,0.01,0xh${tid},${tid}`); tid++;
  }
}
require("fs").writeFileSync("fixtures/evening-tilt.csv", lines.join("\n") + "\n");
console.log("wrote", lines.length - 1, "rows");
'
```

- [ ] **Step 4: Run + commit**

```bash
pnpm vitest run tests/unit/derivation/detectors/loss-of-discipline-windows.test.ts
git add src/derivation/detectors/loss-of-discipline-windows.ts fixtures/evening-tilt.csv tests/unit/derivation/detectors/loss-of-discipline-windows.test.ts
git commit -m "feat(detectors): loss_of_discipline_windows with fixture + unit tests"
```

---

## Task 9 — Detector: `position_sizing_instability`

**Rule:** Rolling-30-day size variance ≥1.5× prior-30-day variance.

**Files:**
- Create: `fixtures/size-drift.csv`
- Create: `src/derivation/detectors/position-sizing-instability.ts`
- Create: `tests/unit/derivation/detectors/position-sizing-instability.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest'
import { PositionSizingInstabilityDetector } from '~/derivation/detectors/position-sizing-instability'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { Position } from '~/domain/position'

const DAY = 86_400_000
function p(id: string, notional: number, openDaysAgo: number, now: Date): Position {
  const t = now.getTime() - openDaysAgo * DAY
  return {
    id, userId: 'u1', exchange: 'hyperliquid', symbol: 'BTC',
    instrumentType: 'perp', side: 'long',
    entryAvgPrice: 40000, exitAvgPrice: 40000, size: notional / 40000,
    notionalUsd: notional, maxNotionalUsd: notional,
    realizedPnl: 0, totalFees: 0.2, fundingPnl: 0,
    wasLiquidated: false, needsReview: false,
    openedAt: new Date(t), closedAt: new Date(t + 3600000), fills: [], derivationVersion: 1,
  }
}
function ctx(now: Date, positions: Position[]): DerivationContext {
  return {
    userId: 'u1', derivationVersion: 1, now, fills: [], positions,
    summary: { totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0, winRate: 0, expectancy: 0,
               avgWin: 0, avgLoss: 0, profitFactor: null, maxDrawdown: 0, tradeCount: 0, medianPositionSizeUsd: 400 },
    daily: [], asset: [], session: [],
  }
}

describe('position_sizing_instability', () => {
  it('fires when recent variance ≥1.5× prior variance', () => {
    const now = new Date('2024-03-02T00:00Z')
    const positions: Position[] = []
    // Prior 30 days (days 31..60 ago): uniform ~400 USD
    for (let i = 0; i < 20; i++) positions.push(p(`old${i}`, 400, 45 + (i % 15), now))
    // Recent 30 days (days 0..29 ago): wildly varying 200..1000
    const recentSizes = [200, 900, 250, 1000, 300, 850, 200, 950, 400, 800, 220, 980, 310, 770, 250, 1020, 330, 860, 280, 940]
    for (let i = 0; i < recentSizes.length; i++) positions.push(p(`new${i}`, recentSizes[i]!, i + 1, now))
    const findings = new PositionSizingInstabilityDetector().run(ctx(now, positions))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.evidence.ratio).toBeGreaterThanOrEqual(1.5)
  })

  it('does not fire when both windows are equally stable', () => {
    const now = new Date('2024-03-02T00:00Z')
    const positions: Position[] = []
    for (let i = 0; i < 15; i++) positions.push(p(`o${i}`, 400, 45 + (i % 15), now))
    for (let i = 0; i < 15; i++) positions.push(p(`n${i}`, 400, 1 + (i % 29), now))
    expect(new PositionSizingInstabilityDetector().run(ctx(now, positions))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/derivation/detectors/position-sizing-instability.ts
import type { Detector, DerivationContext } from './types'
import type { Finding, PositionSizingInstabilityEvidence } from '~/domain/finding'
import { variance } from '../metrics/shared'

const WINDOW_DAYS = 30
const RATIO_THRESHOLD = 1.5
const MIN_PER_WINDOW = 10
const DAY_MS = 86_400_000

export class PositionSizingInstabilityDetector implements Detector {
  readonly id = 'position_sizing_instability'
  readonly description = 'Recent 30-day size variance ≥1.5× prior 30-day variance'

  run(ctx: DerivationContext): Finding<PositionSizingInstabilityEvidence>[] {
    const nowMs = ctx.now.getTime()
    const recentStart = nowMs - WINDOW_DAYS * DAY_MS
    const priorStart = nowMs - 2 * WINDOW_DAYS * DAY_MS

    const recent: number[] = [], prior: number[] = []
    for (const p of ctx.positions) {
      if (!p.closedAt) continue
      const t = p.openedAt.getTime()
      if (t >= recentStart && t < nowMs) recent.push(p.notionalUsd)
      else if (t >= priorStart && t < recentStart) prior.push(p.notionalUsd)
    }
    if (recent.length < MIN_PER_WINDOW || prior.length < MIN_PER_WINDOW) return []

    const vr = variance(recent), vp = variance(prior)
    if (vp === 0) return []
    const ratio = vr / vp
    if (ratio < RATIO_THRESHOLD) return []

    return [{
      id: `find_psi_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId, detectorId: 'position_sizing_instability', severity: 'warning',
      title: 'Position sizing is getting less consistent',
      bodyMarkdown: `Your last 30 days of trades show ${ratio.toFixed(1)}× the size variance of the prior 30 days.`,
      evidence: { priorVariance: vp, recentVariance: vr, ratio, windowDays: WINDOW_DAYS },
      referencedPositionIds: [],
      periodStart: new Date(priorStart), periodEnd: ctx.now,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}
```

- [ ] **Step 3: Create `fixtures/size-drift.csv`**

```bash
node -e '
const lines = ["time,coin,side,px,sz,dir,closedPnl,fee,feeToken,startPosition,hash,tid"];
const DAY = 86400000;
const HOUR = 3600000;
let tid = 5001;
// Use a fixed "now" of 2024-03-02; positions span 60 days ending 2024-03-02
const NOW = 1709337600000;
// Prior 30 days (days 30..59 before now): consistent 0.01 BTC
for (let i = 0; i < 20; i++) {
  const t = NOW - (30 + i + 0.5) * DAY;
  lines.push(`${Math.floor(t)},BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh${tid},${tid}`); tid++;
  lines.push(`${Math.floor(t + HOUR)},BTC,A,40100,0.01,Close Long,1,0.2005,USDC,0.01,0xh${tid},${tid}`); tid++;
}
// Recent 30 days: wildly varying sizes
const sizes = [0.005,0.022,0.006,0.025,0.0075,0.021,0.005,0.024,0.01,0.02,0.0055,0.0245,0.0078,0.019,0.0062,0.0255,0.0083,0.0215,0.007,0.0235];
for (let i = 0; i < sizes.length; i++) {
  const t = NOW - (i + 1) * DAY;
  lines.push(`${Math.floor(t)},BTC,B,40000,${sizes[i]},Open Long,0,${(0.2*sizes[i]/0.01).toFixed(4)},USDC,0,0xh${tid},${tid}`); tid++;
  lines.push(`${Math.floor(t + HOUR)},BTC,A,40100,${sizes[i]},Close Long,${(sizes[i]*100).toFixed(2)},${(0.2005*sizes[i]/0.01).toFixed(4)},USDC,${sizes[i]},0xh${tid},${tid}`); tid++;
}
require("fs").writeFileSync("fixtures/size-drift.csv", lines.join("\n") + "\n");
console.log("wrote", lines.length - 1, "rows");
'
```

- [ ] **Step 4: Run + commit**

```bash
pnpm vitest run tests/unit/derivation/detectors/position-sizing-instability.test.ts
git add src/derivation/detectors/position-sizing-instability.ts fixtures/size-drift.csv tests/unit/derivation/detectors/position-sizing-instability.test.ts
git commit -m "feat(detectors): position_sizing_instability with fixture + unit tests"
```

---

## Task 10 — Detector: `cut_winners_ride_losers`

**Rule:** Avg losing duration ≥1.5× avg winning duration AND avg win < avg loss (by magnitude).

**Files:**
- Create: `fixtures/winner-cutter.csv`
- Create: `src/derivation/detectors/cut-winners-ride-losers.ts`
- Create: `tests/unit/derivation/detectors/cut-winners-ride-losers.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect } from 'vitest'
import { CutWinnersRideLosersDetector } from '~/derivation/detectors/cut-winners-ride-losers'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { Position } from '~/domain/position'

const MIN = 60_000
function p(id: string, pnl: number, durationMin: number): Position {
  const open = new Date('2024-01-01T09:00Z')
  return {
    id, userId: 'u1', exchange: 'hyperliquid', symbol: 'BTC',
    instrumentType: 'perp', side: 'long',
    entryAvgPrice: 40000, exitAvgPrice: 40000, size: 0.01, notionalUsd: 400, maxNotionalUsd: 400,
    realizedPnl: pnl, totalFees: 0.4, fundingPnl: 0, wasLiquidated: false, needsReview: false,
    openedAt: open, closedAt: new Date(open.getTime() + durationMin * MIN), fills: [], derivationVersion: 1,
  }
}
function ctx(positions: Position[]): DerivationContext {
  return {
    userId: 'u1', derivationVersion: 1, now: new Date(), fills: [], positions,
    summary: { totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0, winRate: 0, expectancy: 0,
               avgWin: 0, avgLoss: 0, profitFactor: null, maxDrawdown: 0, tradeCount: 0, medianPositionSizeUsd: 400 },
    daily: [], asset: [], session: [],
  }
}

describe('cut_winners_ride_losers', () => {
  it('fires when loss duration ≥1.5× win duration AND avg win < avg loss', () => {
    const positions = [
      p('w1', 30, 30), p('w2', 25, 25), p('w3', 35, 35),    // avg win 30, duration 30
      p('l1', -60, 240), p('l2', -55, 220), p('l3', -50, 200), // avg loss -55, duration 220
    ]
    const findings = new CutWinnersRideLosersDetector().run(ctx(positions))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.evidence.durationRatio).toBeGreaterThanOrEqual(1.5)
  })

  it('does not fire when durations balanced', () => {
    const positions = [
      p('w1', 30, 60), p('w2', 25, 50), p('w3', 35, 55),
      p('l1', -20, 60), p('l2', -25, 55), p('l3', -15, 65),
    ]
    expect(new CutWinnersRideLosersDetector().run(ctx(positions))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/derivation/detectors/cut-winners-ride-losers.ts
import type { Detector, DerivationContext } from './types'
import type { Finding, CutWinnersRideLosersEvidence } from '~/domain/finding'
import { mean } from '../metrics/shared'

const DURATION_RATIO = 1.5
const MIN_PER_BUCKET = 3

export class CutWinnersRideLosersDetector implements Detector {
  readonly id = 'cut_winners_ride_losers'
  readonly description = 'Losing duration ≥1.5× winning duration, with avg win < avg loss'

  run(ctx: DerivationContext): Finding<CutWinnersRideLosersEvidence>[] {
    const closed = ctx.positions.filter(p => p.closedAt)
    const wins = closed.filter(p => p.realizedPnl > 0)
    const losses = closed.filter(p => p.realizedPnl < 0)
    if (wins.length < MIN_PER_BUCKET || losses.length < MIN_PER_BUCKET) return []

    const dur = (p: (typeof closed)[number]) => (p.closedAt!.getTime() - p.openedAt.getTime()) / 60000
    const avgWinDur = mean(wins.map(dur))
    const avgLossDur = mean(losses.map(dur))
    const avgWin = mean(wins.map(p => p.realizedPnl))
    const avgLoss = Math.abs(mean(losses.map(p => p.realizedPnl)))

    const ratio = avgWinDur === 0 ? 0 : avgLossDur / avgWinDur
    if (ratio < DURATION_RATIO || avgWin >= avgLoss) return []

    return [{
      id: `find_cwrl_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId, detectorId: 'cut_winners_ride_losers', severity: 'warning',
      title: 'Cutting winners, riding losers',
      bodyMarkdown: `You hold losers ${ratio.toFixed(1)}× longer than winners, and your avg loss ($${avgLoss.toFixed(0)}) is larger than your avg win ($${avgWin.toFixed(0)}).`,
      evidence: {
        avgWinDurationMinutes: avgWinDur, avgLossDurationMinutes: avgLossDur,
        durationRatio: ratio, avgWinUsd: avgWin, avgLossUsd: avgLoss,
      },
      referencedPositionIds: [],
      periodStart: null, periodEnd: null,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}
```

- [ ] **Step 3: `fixtures/winner-cutter.csv`**

```bash
node -e '
const lines = ["time,coin,side,px,sz,dir,closedPnl,fee,feeToken,startPosition,hash,tid"];
const HOUR = 3600000;
const MIN = 60000;
let tid = 6001;
let t = 1704067200000;
// 10 winners held 30 min, +$30 each
for (let i = 0; i < 10; i++) {
  lines.push(`${t},BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh${tid},${tid}`); tid++;
  lines.push(`${t + 30*MIN},BTC,A,43000,0.01,Close Long,30,0.215,USDC,0.01,0xh${tid},${tid}`); tid++;
  t += 6 * HOUR;
}
// 10 losers held 4 hours, -$60 each
for (let i = 0; i < 10; i++) {
  lines.push(`${t},BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh${tid},${tid}`); tid++;
  lines.push(`${t + 4*HOUR},BTC,A,34000,0.01,Close Long,-60,0.17,USDC,0.01,0xh${tid},${tid}`); tid++;
  t += 8 * HOUR;
}
require("fs").writeFileSync("fixtures/winner-cutter.csv", lines.join("\n") + "\n");
console.log("wrote", lines.length - 1, "rows");
'
```

- [ ] **Step 4: Run + commit**

```bash
pnpm vitest run tests/unit/derivation/detectors/cut-winners-ride-losers.test.ts
git add src/derivation/detectors/cut-winners-ride-losers.ts fixtures/winner-cutter.csv tests/unit/derivation/detectors/cut-winners-ride-losers.test.ts
git commit -m "feat(detectors): cut_winners_ride_losers with fixture + unit tests"
```

---

## Task 11 — Detector: `overtrading_after_losses`

**Rule:** Avg daily trade count on days-after-loss ≥1.4× days-after-win, across ≥10 days in each cohort.

**Files:**
- Create: `fixtures/loss-chaser.csv`
- Create: `src/derivation/detectors/overtrading-after-losses.ts`
- Create: `tests/unit/derivation/detectors/overtrading-after-losses.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect } from 'vitest'
import { OvertradingAfterLossesDetector } from '~/derivation/detectors/overtrading-after-losses'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { DailyMetricValue } from '~/domain/metrics'

function ctx(daily: DailyMetricValue[]): DerivationContext {
  return {
    userId: 'u1', derivationVersion: 1, now: new Date(), fills: [], positions: [],
    summary: { totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0, winRate: 0, expectancy: 0,
               avgWin: 0, avgLoss: 0, profitFactor: null, maxDrawdown: 0, tradeCount: 0, medianPositionSizeUsd: 0 },
    daily, asset: [], session: [],
  }
}
function day(date: string, pnl: number, count: number): DailyMetricValue {
  return { date, tradeCount: count, realizedPnl: pnl, volumeUsd: 0,
           winCount: pnl > 0 ? count : 0, lossCount: pnl < 0 ? count : 0, totalFees: 0 }
}

describe('overtrading_after_losses', () => {
  it('fires when after-loss trade count ≥1.4× after-win count (≥10 each)', () => {
    const daily: DailyMetricValue[] = []
    // Alternating loss/win sequences — construct 12 loss days, each followed by a "chase" day, and 12 win days each followed by calm day
    let d = new Date('2024-01-01')
    for (let i = 0; i < 12; i++) {
      daily.push(day(d.toISOString().slice(0, 10), -10, 2)); d = new Date(d.getTime() + 86400000)
      daily.push(day(d.toISOString().slice(0, 10), -20, 6)); d = new Date(d.getTime() + 86400000) // chase
    }
    for (let i = 0; i < 12; i++) {
      daily.push(day(d.toISOString().slice(0, 10), 10, 2)); d = new Date(d.getTime() + 86400000)
      daily.push(day(d.toISOString().slice(0, 10), 15, 2)); d = new Date(d.getTime() + 86400000) // calm
    }
    const findings = new OvertradingAfterLossesDetector().run(ctx(daily))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.evidence.ratio).toBeGreaterThanOrEqual(1.4)
  })

  it('does not fire with <10 samples per cohort', () => {
    const daily: DailyMetricValue[] = []
    let d = new Date('2024-01-01')
    for (let i = 0; i < 5; i++) {
      daily.push(day(d.toISOString().slice(0, 10), -10, 2)); d = new Date(d.getTime() + 86400000)
      daily.push(day(d.toISOString().slice(0, 10), -20, 6)); d = new Date(d.getTime() + 86400000)
    }
    expect(new OvertradingAfterLossesDetector().run(ctx(daily))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/derivation/detectors/overtrading-after-losses.ts
import type { Detector, DerivationContext } from './types'
import type { Finding, OvertradingAfterLossesEvidence } from '~/domain/finding'
import { mean } from '../metrics/shared'

const RATIO_THRESHOLD = 1.4
const MIN_SAMPLE = 10

export class OvertradingAfterLossesDetector implements Detector {
  readonly id = 'overtrading_after_losses'
  readonly description = 'Avg daily trades after a losing day ≥1.4× avg after a winning day'

  run(ctx: DerivationContext): Finding<OvertradingAfterLossesEvidence>[] {
    const sorted = [...ctx.daily].sort((a, b) => a.date.localeCompare(b.date))
    const afterLoss: number[] = [], afterWin: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!, cur = sorted[i]!
      if (!isConsecutiveDay(prev.date, cur.date)) continue
      if (prev.realizedPnl < 0) afterLoss.push(cur.tradeCount)
      else if (prev.realizedPnl > 0) afterWin.push(cur.tradeCount)
    }
    if (afterLoss.length < MIN_SAMPLE || afterWin.length < MIN_SAMPLE) return []
    const aAL = mean(afterLoss), aAW = mean(afterWin)
    if (aAW === 0) return []
    const ratio = aAL / aAW
    if (ratio < RATIO_THRESHOLD) return []

    return [{
      id: `find_oal_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId, detectorId: 'overtrading_after_losses', severity: 'warning',
      title: 'Overtrading after losing days',
      bodyMarkdown: `You place ${ratio.toFixed(1)}× more trades on days after a loss vs. days after a win.`,
      evidence: { avgTradesAfterLoss: aAL, avgTradesAfterWin: aAW, ratio, daysAfterLoss: afterLoss.length, daysAfterWin: afterWin.length },
      referencedPositionIds: [],
      periodStart: null, periodEnd: null,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}

function isConsecutiveDay(a: string, b: string): boolean {
  const dateA = new Date(a + 'T00:00:00Z').getTime()
  const dateB = new Date(b + 'T00:00:00Z').getTime()
  return dateB - dateA === 86_400_000
}
```

- [ ] **Step 3: `fixtures/loss-chaser.csv`**

```bash
node -e '
const lines = ["time,coin,side,px,sz,dir,closedPnl,fee,feeToken,startPosition,hash,tid"];
const DAY = 86400000;
const HOUR = 3600000;
let tid = 7001;
let day = 1704067200000;
// 12 loss-day → chase-day pairs
for (let i = 0; i < 12; i++) {
  // loss day: 2 losing trades
  for (let k = 0; k < 2; k++) {
    const t = day + (k+1) * HOUR;
    lines.push(`${t},BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh${tid},${tid}`); tid++;
    lines.push(`${t + 30*60000},BTC,A,39500,0.01,Close Long,-5,0.1975,USDC,0.01,0xh${tid},${tid}`); tid++;
  }
  day += DAY;
  // chase day: 6 trades (mixed losses)
  for (let k = 0; k < 6; k++) {
    const t = day + (k+1) * HOUR;
    const pnl = k % 2 === 0 ? -3 : 1;
    lines.push(`${t},BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh${tid},${tid}`); tid++;
    lines.push(`${t + 20*60000},BTC,A,${40000 + pnl * 100},0.01,Close Long,${pnl},0.2,USDC,0.01,0xh${tid},${tid}`); tid++;
  }
  day += DAY;
}
// 12 win-day → calm-day pairs
for (let i = 0; i < 12; i++) {
  for (let k = 0; k < 2; k++) {
    const t = day + (k+1) * HOUR;
    lines.push(`${t},BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh${tid},${tid}`); tid++;
    lines.push(`${t + 30*60000},BTC,A,40500,0.01,Close Long,5,0.2025,USDC,0.01,0xh${tid},${tid}`); tid++;
  }
  day += DAY;
  for (let k = 0; k < 2; k++) {
    const t = day + (k+1) * HOUR;
    lines.push(`${t},BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh${tid},${tid}`); tid++;
    lines.push(`${t + 30*60000},BTC,A,40300,0.01,Close Long,3,0.2015,USDC,0.01,0xh${tid},${tid}`); tid++;
  }
  day += DAY;
}
require("fs").writeFileSync("fixtures/loss-chaser.csv", lines.join("\n") + "\n");
console.log("wrote", lines.length - 1, "rows");
'
```

- [ ] **Step 4: Run + commit**

```bash
pnpm vitest run tests/unit/derivation/detectors/overtrading-after-losses.test.ts
git add src/derivation/detectors/overtrading-after-losses.ts fixtures/loss-chaser.csv tests/unit/derivation/detectors/overtrading-after-losses.test.ts
git commit -m "feat(detectors): overtrading_after_losses with fixture + unit tests"
```

---

## Task 12 — Detector: `fee_drag`

**Rule:** Total fees ≥25% of gross PnL, OR fees flip gross-profit to net-loss.

**Files:**
- Create: `fixtures/fee-bleed.csv`
- Create: `src/derivation/detectors/fee-drag.ts`
- Create: `tests/unit/derivation/detectors/fee-drag.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect } from 'vitest'
import { FeeDragDetector } from '~/derivation/detectors/fee-drag'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { SummaryRollupValue } from '~/domain/metrics'

function ctx(summary: Partial<SummaryRollupValue>): DerivationContext {
  return {
    userId: 'u1', derivationVersion: 1, now: new Date(), fills: [], positions: [],
    summary: { totalPnl: 100, grossProfit: 200, grossLoss: 100, totalFees: 20, winRate: 0.5,
               expectancy: 5, avgWin: 10, avgLoss: -10, profitFactor: 2, maxDrawdown: 0,
               tradeCount: 40, medianPositionSizeUsd: 400, ...summary },
    daily: [], asset: [], session: [],
  }
}

describe('fee_drag', () => {
  it('fires when fees ≥25% of gross profit', () => {
    const f = new FeeDragDetector().run(ctx({ grossProfit: 200, totalFees: 60 }))
    expect(f).toHaveLength(1)
    expect(f[0]!.evidence).toMatchObject({ flippedProfitToLoss: false })
  })
  it('fires when fees flip profit to loss', () => {
    const f = new FeeDragDetector().run(ctx({ grossProfit: 100, grossLoss: 90, totalFees: 20, totalPnl: -10 }))
    expect(f).toHaveLength(1)
    expect(f[0]!.evidence.flippedProfitToLoss).toBe(true)
  })
  it('does not fire when fees are small', () => {
    expect(new FeeDragDetector().run(ctx({ grossProfit: 200, totalFees: 10 }))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/derivation/detectors/fee-drag.ts
import type { Detector, DerivationContext } from './types'
import type { Finding, FeeDragEvidence } from '~/domain/finding'

const FEE_RATIO_THRESHOLD = 0.25

export class FeeDragDetector implements Detector {
  readonly id = 'fee_drag'
  readonly description = 'Total fees ≥25% of gross PnL, or fees flip gross profit to net loss'

  run(ctx: DerivationContext): Finding<FeeDragEvidence>[] {
    const { grossProfit, grossLoss, totalFees } = ctx.summary
    const grossPnl = grossProfit - grossLoss
    if (grossProfit <= 0 || totalFees <= 0) return []
    const ratio = totalFees / grossProfit
    const flipped = grossPnl > 0 && grossPnl - totalFees < 0
    if (ratio < FEE_RATIO_THRESHOLD && !flipped) return []

    return [{
      id: `find_fee_drag_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId, detectorId: 'fee_drag', severity: flipped ? 'critical' : 'warning',
      title: flipped ? 'Fees turned your profit into a loss' : 'Fees are eating your edge',
      bodyMarkdown: flipped
        ? `You were ahead $${grossPnl.toFixed(0)} gross, but $${totalFees.toFixed(0)} in fees pushed you net-negative.`
        : `Fees are ${(ratio * 100).toFixed(0)}% of your gross profit.`,
      evidence: { totalFeesUsd: totalFees, grossPnlUsd: grossPnl, feeRatio: ratio, flippedProfitToLoss: flipped },
      referencedPositionIds: [],
      periodStart: null, periodEnd: null,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}
```

- [ ] **Step 3: `fixtures/fee-bleed.csv`** — 30 small winners with outsized fees (hand-written, small):

```csv
time,coin,side,px,sz,dir,closedPnl,fee,feeToken,startPosition,hash,tid
1704067200000,BTC,B,40000,0.01,Open Long,0,2.0,USDC,0,0xh8001,8001
1704068400000,BTC,A,40030,0.01,Close Long,0.3,2.0,USDC,0.01,0xh8002,8002
1704070800000,BTC,B,40000,0.01,Open Long,0,2.0,USDC,0,0xh8003,8003
1704072000000,BTC,A,40040,0.01,Close Long,0.4,2.0,USDC,0.01,0xh8004,8004
1704074400000,BTC,B,40000,0.01,Open Long,0,2.0,USDC,0,0xh8005,8005
1704075600000,BTC,A,40035,0.01,Close Long,0.35,2.0,USDC,0.01,0xh8006,8006
1704078000000,BTC,B,40000,0.01,Open Long,0,2.0,USDC,0,0xh8007,8007
1704079200000,BTC,A,40030,0.01,Close Long,0.3,2.0,USDC,0.01,0xh8008,8008
1704081600000,BTC,B,40000,0.01,Open Long,0,2.0,USDC,0,0xh8009,8009
1704082800000,BTC,A,40050,0.01,Close Long,0.5,2.0,USDC,0.01,0xh8010,8010
1704085200000,BTC,B,40000,0.01,Open Long,0,2.0,USDC,0,0xh8011,8011
1704086400000,BTC,A,40040,0.01,Close Long,0.4,2.0,USDC,0.01,0xh8012,8012
1704088800000,BTC,B,40000,0.01,Open Long,0,2.0,USDC,0,0xh8013,8013
1704090000000,BTC,A,40035,0.01,Close Long,0.35,2.0,USDC,0.01,0xh8014,8014
1704092400000,BTC,B,40000,0.01,Open Long,0,2.0,USDC,0,0xh8015,8015
1704093600000,BTC,A,40030,0.01,Close Long,0.3,2.0,USDC,0.01,0xh8016,8016
1704096000000,BTC,B,40000,0.01,Open Long,0,2.0,USDC,0,0xh8017,8017
1704097200000,BTC,A,40045,0.01,Close Long,0.45,2.0,USDC,0.01,0xh8018,8018
1704099600000,BTC,B,40000,0.01,Open Long,0,2.0,USDC,0,0xh8019,8019
1704100800000,BTC,A,40040,0.01,Close Long,0.4,2.0,USDC,0.01,0xh8020,8020
```

- [ ] **Step 4: Run + commit**

```bash
pnpm vitest run tests/unit/derivation/detectors/fee-drag.test.ts
git add src/derivation/detectors/fee-drag.ts fixtures/fee-bleed.csv tests/unit/derivation/detectors/fee-drag.test.ts
git commit -m "feat(detectors): fee_drag with fixture + unit tests"
```

---

## Task 13 — Detector: `scaling_into_losers`

**Rule:** Rate of add-role fills on underwater positions (current price < avg entry for longs, > entry for shorts at time of add) ≥2× the rate on in-profit positions.

**Files:**
- Create: `fixtures/pyramid-losers.csv`
- Create: `src/derivation/detectors/scaling-into-losers.ts`
- Create: `tests/unit/derivation/detectors/scaling-into-losers.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect } from 'vitest'
import { ScalingIntoLosersDetector } from '~/derivation/detectors/scaling-into-losers'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { Position, PositionFillRef } from '~/domain/position'

function fill(price: number, size: number, role: 'open'|'add'|'reduce'|'close', t: number): PositionFillRef {
  return { fillId: `f_${t}`, role, price, size, fee: 0.2, executedAt: new Date(t) }
}
function pos(id: string, side: 'long'|'short', fills: PositionFillRef[], pnl: number): Position {
  const opens = fills.filter(f => f.role === 'open' || f.role === 'add')
  const totalSize = opens.reduce((a, b) => a + b.size, 0)
  const entry = opens.reduce((a, b) => a + b.price * b.size, 0) / (totalSize || 1)
  return {
    id, userId: 'u1', exchange: 'hyperliquid', symbol: 'BTC',
    instrumentType: 'perp', side, entryAvgPrice: entry, exitAvgPrice: entry,
    size: totalSize, notionalUsd: entry * totalSize, maxNotionalUsd: entry * totalSize,
    realizedPnl: pnl, totalFees: 1, fundingPnl: 0, wasLiquidated: false, needsReview: false,
    openedAt: fills[0]!.executedAt, closedAt: fills[fills.length - 1]!.executedAt, fills,
    derivationVersion: 1,
  }
}
function ctx(positions: Position[]): DerivationContext {
  return {
    userId: 'u1', derivationVersion: 1, now: new Date(), fills: [], positions,
    summary: { totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0, winRate: 0, expectancy: 0,
               avgWin: 0, avgLoss: 0, profitFactor: null, maxDrawdown: 0, tradeCount: 0, medianPositionSizeUsd: 0 },
    daily: [], asset: [], session: [],
  }
}

describe('scaling_into_losers', () => {
  it('fires when adds-on-underwater ≥2× adds-on-in-profit', () => {
    const positions = [
      // 3 "add when underwater" (long: add price < open price)
      pos('L1', 'long', [fill(40000, 0.01, 'open', 0), fill(39000, 0.01, 'add', 60_000), fill(38500, 0.01, 'close', 120_000)], -25),
      pos('L2', 'long', [fill(40000, 0.01, 'open', 0), fill(38500, 0.01, 'add', 60_000), fill(38000, 0.01, 'close', 120_000)], -35),
      pos('L3', 'long', [fill(40000, 0.01, 'open', 0), fill(39200, 0.01, 'add', 60_000), fill(39100, 0.01, 'close', 120_000)], -17),
      pos('L4', 'long', [fill(40000, 0.01, 'open', 0), fill(38800, 0.01, 'add', 60_000), fill(38700, 0.01, 'close', 120_000)], -25),
      // 1 "add when in profit" (long: add price > open price)
      pos('W1', 'long', [fill(40000, 0.01, 'open', 0), fill(41000, 0.01, 'add', 60_000), fill(42000, 0.01, 'close', 120_000)], 30),
    ]
    const f = new ScalingIntoLosersDetector().run(ctx(positions))
    expect(f).toHaveLength(1)
    expect(f[0]!.evidence.ratio).toBeGreaterThanOrEqual(2)
  })

  it('does not fire when rates are comparable', () => {
    const positions = [
      pos('L1', 'long', [fill(40000, 0.01, 'open', 0), fill(39500, 0.01, 'add', 60_000), fill(40000, 0.01, 'close', 120_000)], 0),
      pos('W1', 'long', [fill(40000, 0.01, 'open', 0), fill(41000, 0.01, 'add', 60_000), fill(42000, 0.01, 'close', 120_000)], 30),
    ]
    expect(new ScalingIntoLosersDetector().run(ctx(positions))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/derivation/detectors/scaling-into-losers.ts
import type { Detector, DerivationContext } from './types'
import type { Finding, ScalingIntoLosersEvidence } from '~/domain/finding'

const RATIO_THRESHOLD = 2.0
const MIN_TOTAL_ADDS = 5

export class ScalingIntoLosersDetector implements Detector {
  readonly id = 'scaling_into_losers'
  readonly description = 'Add-role fills on underwater positions ≥2× rate on in-profit positions'

  run(ctx: DerivationContext): Finding<ScalingIntoLosersEvidence>[] {
    let underwater = 0, inProfit = 0
    const samples: string[] = []

    for (const p of ctx.positions) {
      // Walk fills; track running avg entry for long/short
      let weightedEntrySum = 0, totalOpenSize = 0
      for (const f of p.fills) {
        if (f.role === 'open' || f.role === 'add') {
          if (totalOpenSize > 0) {
            const avgEntry = weightedEntrySum / totalOpenSize
            const underwaterNow = p.side === 'long' ? f.price < avgEntry : f.price > avgEntry
            if (f.role === 'add') {
              if (underwaterNow) { underwater++; if (samples.length < 10) samples.push(p.id) }
              else inProfit++
            }
          }
          weightedEntrySum += f.price * f.size
          totalOpenSize += f.size
        }
      }
    }

    if (underwater + inProfit < MIN_TOTAL_ADDS || inProfit === 0) return []
    const ratio = underwater / inProfit
    if (ratio < RATIO_THRESHOLD) return []

    return [{
      id: `find_sil_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId, detectorId: 'scaling_into_losers', severity: 'warning',
      title: 'Scaling into losers',
      bodyMarkdown: `You add to losing positions ${ratio.toFixed(1)}× more often than to winning ones (${underwater} adds underwater vs ${inProfit} in profit).`,
      evidence: { addsUnderwater: underwater, addsInProfit: inProfit, ratio, samplePositionIds: samples },
      referencedPositionIds: samples,
      periodStart: null, periodEnd: null,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}
```

- [ ] **Step 3: `fixtures/pyramid-losers.csv`** (8 losers with adds below entry, 2 winners with adds above entry — HL `dir` field provides Add Long hints)

```csv
time,coin,side,px,sz,dir,closedPnl,fee,feeToken,startPosition,hash,tid
1704067200000,BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh9001,9001
1704070800000,BTC,B,39000,0.01,Add Long,0,0.195,USDC,0.01,0xh9002,9002
1704074400000,BTC,A,38500,0.02,Close Long,-25,0.385,USDC,0.02,0xh9003,9003
1704078000000,BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh9004,9004
1704081600000,BTC,B,38500,0.01,Add Long,0,0.1925,USDC,0.01,0xh9005,9005
1704085200000,BTC,A,38000,0.02,Close Long,-35,0.38,USDC,0.02,0xh9006,9006
1704088800000,BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh9007,9007
1704092400000,BTC,B,39200,0.01,Add Long,0,0.196,USDC,0.01,0xh9008,9008
1704096000000,BTC,A,39100,0.02,Close Long,-17,0.391,USDC,0.02,0xh9009,9009
1704099600000,BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh9010,9010
1704103200000,BTC,B,38800,0.01,Add Long,0,0.194,USDC,0.01,0xh9011,9011
1704106800000,BTC,A,38700,0.02,Close Long,-25,0.387,USDC,0.02,0xh9012,9012
1704110400000,BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh9013,9013
1704114000000,BTC,B,38600,0.01,Add Long,0,0.193,USDC,0.01,0xh9014,9014
1704117600000,BTC,A,38400,0.02,Close Long,-32,0.384,USDC,0.02,0xh9015,9015
1704121200000,BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh9016,9016
1704124800000,BTC,B,38700,0.01,Add Long,0,0.1935,USDC,0.01,0xh9017,9017
1704128400000,BTC,A,38500,0.02,Close Long,-28,0.385,USDC,0.02,0xh9018,9018
1704132000000,BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh9019,9019
1704135600000,BTC,B,38400,0.01,Add Long,0,0.192,USDC,0.01,0xh9020,9020
1704139200000,BTC,A,38200,0.02,Close Long,-36,0.382,USDC,0.02,0xh9021,9021
1704142800000,BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh9022,9022
1704146400000,BTC,B,38900,0.01,Add Long,0,0.1945,USDC,0.01,0xh9023,9023
1704150000000,BTC,A,38800,0.02,Close Long,-23,0.388,USDC,0.02,0xh9024,9024
1704153600000,BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh9025,9025
1704157200000,BTC,B,41000,0.01,Add Long,0,0.205,USDC,0.01,0xh9026,9026
1704160800000,BTC,A,42000,0.02,Close Long,30,0.42,USDC,0.02,0xh9027,9027
1704164400000,BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh9028,9028
1704168000000,BTC,B,40500,0.01,Add Long,0,0.2025,USDC,0.01,0xh9029,9029
1704171600000,BTC,A,41000,0.02,Close Long,15,0.41,USDC,0.02,0xh9030,9030
```

- [ ] **Step 4: Run + commit**

```bash
pnpm vitest run tests/unit/derivation/detectors/scaling-into-losers.test.ts
git add src/derivation/detectors/scaling-into-losers.ts fixtures/pyramid-losers.csv tests/unit/derivation/detectors/scaling-into-losers.test.ts
git commit -m "feat(detectors): scaling_into_losers with fixture + unit tests"
```

---

## Task 14 — Detector: `short_hold_scalping`

**Rule:** Positions held <5 minutes have expectancy ≥0.8σ below positions held ≥5 minutes, across ≥20 short-hold samples.

**Files:**
- Create: `fixtures/scalp-gambler.csv`
- Create: `src/derivation/detectors/short-hold-scalping.ts`
- Create: `tests/unit/derivation/detectors/short-hold-scalping.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect } from 'vitest'
import { ShortHoldScalpingDetector } from '~/derivation/detectors/short-hold-scalping'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { Position } from '~/domain/position'

function p(id: string, pnl: number, holdSec: number): Position {
  const open = new Date('2024-01-01T09:00Z')
  return {
    id, userId: 'u1', exchange: 'hyperliquid', symbol: 'BTC',
    instrumentType: 'perp', side: 'long',
    entryAvgPrice: 40000, exitAvgPrice: 40000, size: 0.01, notionalUsd: 400, maxNotionalUsd: 400,
    realizedPnl: pnl, totalFees: 0.2, fundingPnl: 0, wasLiquidated: false, needsReview: false,
    openedAt: open, closedAt: new Date(open.getTime() + holdSec * 1000), fills: [], derivationVersion: 1,
  }
}
function ctx(positions: Position[]): DerivationContext {
  return {
    userId: 'u1', derivationVersion: 1, now: new Date(), fills: [], positions,
    summary: { totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0, winRate: 0, expectancy: 0,
               avgWin: 0, avgLoss: 0, profitFactor: null, maxDrawdown: 0, tradeCount: 0, medianPositionSizeUsd: 0 },
    daily: [], asset: [], session: [],
  }
}

describe('short_hold_scalping', () => {
  it('fires when short-hold expectancy ≥0.8σ below long-hold expectancy', () => {
    const positions: Position[] = []
    // 22 short-hold losers (1 min each)
    for (let i = 0; i < 22; i++) positions.push(p(`s${i}`, -8, 60))
    // 20 long-hold winners (1 hour each)
    for (let i = 0; i < 20; i++) positions.push(p(`l${i}`, 12, 3600))
    const f = new ShortHoldScalpingDetector().run(ctx(positions))
    expect(f).toHaveLength(1)
    expect(f[0]!.evidence.shortHoldSampleSize).toBeGreaterThanOrEqual(20)
  })

  it('does not fire with <20 short-hold samples', () => {
    const positions: Position[] = []
    for (let i = 0; i < 10; i++) positions.push(p(`s${i}`, -8, 60))
    for (let i = 0; i < 20; i++) positions.push(p(`l${i}`, 12, 3600))
    expect(new ShortHoldScalpingDetector().run(ctx(positions))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/derivation/detectors/short-hold-scalping.ts
import type { Detector, DerivationContext } from './types'
import type { Finding, ShortHoldScalpingEvidence } from '~/domain/finding'
import { mean, stddev } from '../metrics/shared'

const SHORT_HOLD_SECONDS = 5 * 60
const SIGMA_THRESHOLD = 0.8
const MIN_SHORT_SAMPLE = 20

export class ShortHoldScalpingDetector implements Detector {
  readonly id = 'short_hold_scalping'
  readonly description = '<5-min positions expectancy ≥0.8σ below longer-held, ≥20 samples'

  run(ctx: DerivationContext): Finding<ShortHoldScalpingEvidence>[] {
    const closed = ctx.positions.filter(p => p.closedAt)
    const short: number[] = [], long: number[] = []
    for (const p of closed) {
      const hold = (p.closedAt!.getTime() - p.openedAt.getTime()) / 1000
      if (hold < SHORT_HOLD_SECONDS) short.push(p.realizedPnl)
      else long.push(p.realizedPnl)
    }
    if (short.length < MIN_SHORT_SAMPLE || long.length < 5) return []
    const sExp = mean(short), lExp = mean(long)
    const combined = [...short, ...long]
    const sd = stddev(combined)
    if (sd === 0) return []
    const sigmas = (lExp - sExp) / sd
    if (sigmas < SIGMA_THRESHOLD) return []

    return [{
      id: `find_shs_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId, detectorId: 'short_hold_scalping', severity: 'warning',
      title: 'Short-hold scalping underperforms',
      bodyMarkdown: `Your <5-min positions have expectancy $${sExp.toFixed(1)} vs $${lExp.toFixed(1)} for longer holds — ${sigmas.toFixed(1)}σ below.`,
      evidence: { shortHoldExpectancyUsd: sExp, longHoldExpectancyUsd: lExp, sigmasBelow: sigmas, shortHoldSampleSize: short.length },
      referencedPositionIds: [],
      periodStart: null, periodEnd: null,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}
```

- [ ] **Step 3: `fixtures/scalp-gambler.csv`**

```bash
node -e '
const lines = ["time,coin,side,px,sz,dir,closedPnl,fee,feeToken,startPosition,hash,tid"];
const MIN = 60000;
const HOUR = 3600000;
let tid = 10001;
let t = 1704067200000;
// 22 short-hold losers (1 minute each)
for (let i = 0; i < 22; i++) {
  lines.push(`${t},BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh${tid},${tid}`); tid++;
  lines.push(`${t + MIN},BTC,A,39200,0.01,Close Long,-8,0.196,USDC,0.01,0xh${tid},${tid}`); tid++;
  t += 10 * MIN;
}
// 20 long-hold winners (1 hour each)
for (let i = 0; i < 20; i++) {
  lines.push(`${t},BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh${tid},${tid}`); tid++;
  lines.push(`${t + HOUR},BTC,A,41200,0.01,Close Long,12,0.206,USDC,0.01,0xh${tid},${tid}`); tid++;
  t += 2 * HOUR;
}
require("fs").writeFileSync("fixtures/scalp-gambler.csv", lines.join("\n") + "\n");
console.log("wrote", lines.length - 1, "rows");
'
```

- [ ] **Step 4: Run + commit**

```bash
pnpm vitest run tests/unit/derivation/detectors/short-hold-scalping.test.ts
git add src/derivation/detectors/short-hold-scalping.ts fixtures/scalp-gambler.csv tests/unit/derivation/detectors/short-hold-scalping.test.ts
git commit -m "feat(detectors): short_hold_scalping with fixture + unit tests"
```

---

## Task 15 — Detector: `symbol_underperformance`

**Rule:** Symbols with ≥10 trades and expectancy ≥1.0σ below overall user expectancy.

**Files:**
- Create: `fixtures/bad-ticker.csv`
- Create: `src/derivation/detectors/symbol-underperformance.ts`
- Create: `tests/unit/derivation/detectors/symbol-underperformance.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect } from 'vitest'
import { SymbolUnderperformanceDetector } from '~/derivation/detectors/symbol-underperformance'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { AssetMetricValue } from '~/domain/metrics'

function ctx(asset: AssetMetricValue[]): DerivationContext {
  return {
    userId: 'u1', derivationVersion: 1, now: new Date(), fills: [], positions: [],
    summary: { totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0, winRate: 0, expectancy: 0,
               avgWin: 0, avgLoss: 0, profitFactor: null, maxDrawdown: 0, tradeCount: 0, medianPositionSizeUsd: 0 },
    daily: [], asset, session: [],
  }
}
const a = (symbol: string, tradeCount: number, expectancy: number): AssetMetricValue => ({
  symbol, tradeCount, realizedPnl: expectancy * tradeCount, winRate: 0.5, avgWin: 0, avgLoss: 0, expectancy,
})

describe('symbol_underperformance', () => {
  it('fires when a symbol is ≥1σ below mean with ≥10 trades', () => {
    const asset = [a('BTC', 15, 5), a('ETH', 15, 6), a('SOL', 15, 4), a('DOGE', 12, -20)]
    const f = new SymbolUnderperformanceDetector().run(ctx(asset))
    expect(f).toHaveLength(1)
    expect(f[0]!.evidence.symbols[0]!.symbol).toBe('DOGE')
  })
  it('ignores symbols with <10 trades', () => {
    const asset = [a('BTC', 15, 5), a('DOGE', 8, -20)]
    expect(new SymbolUnderperformanceDetector().run(ctx(asset))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/derivation/detectors/symbol-underperformance.ts
import type { Detector, DerivationContext } from './types'
import type { Finding, SymbolUnderperformanceEvidence } from '~/domain/finding'
import { mean, stddev } from '../metrics/shared'

const MIN_TRADES = 10
const SIGMA_THRESHOLD = 1.0

export class SymbolUnderperformanceDetector implements Detector {
  readonly id = 'symbol_underperformance'
  readonly description = 'Symbols ≥1σ below user expectancy with ≥10 trades'

  run(ctx: DerivationContext): Finding<SymbolUnderperformanceEvidence>[] {
    const eligible = ctx.asset.filter(a => a.tradeCount >= MIN_TRADES)
    if (eligible.length < 2) return []
    const m = mean(eligible.map(a => a.expectancy))
    const sd = stddev(eligible.map(a => a.expectancy))
    if (sd === 0) return []
    const bad: SymbolUnderperformanceEvidence['symbols'] = []
    for (const a of eligible) {
      const sigmas = (m - a.expectancy) / sd
      if (sigmas >= SIGMA_THRESHOLD) {
        bad.push({ symbol: a.symbol, tradeCount: a.tradeCount, expectancyUsd: a.expectancy, sigmasBelowMean: sigmas })
      }
    }
    if (bad.length === 0) return []

    return [{
      id: `find_sup_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId, detectorId: 'symbol_underperformance', severity: 'warning',
      title: 'Specific symbols underperform',
      bodyMarkdown: `${bad.length} symbol(s) consistently underperform your overall expectancy.`,
      evidence: { overallExpectancyUsd: m, stdExpectancyUsd: sd, sigmaThreshold: SIGMA_THRESHOLD, symbols: bad },
      referencedPositionIds: [],
      periodStart: null, periodEnd: null,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}
```

- [ ] **Step 3: `fixtures/bad-ticker.csv`** — 15 BTC + 15 ETH + 12 DOGE; DOGE consistently losing.

```bash
node -e '
const lines = ["time,coin,side,px,sz,dir,closedPnl,fee,feeToken,startPosition,hash,tid"];
const HOUR = 3600000;
let tid = 11001;
let t = 1704067200000;
function trade(coin, px, pnl, size) {
  lines.push(`${t},${coin},B,${px},${size},Open Long,0,${(px*size*0.0001).toFixed(4)},USDC,0,0xh${tid},${tid}`); tid++;
  lines.push(`${t + HOUR},${coin},A,${px + pnl / size},${size},Close Long,${pnl},${(px*size*0.0001).toFixed(4)},USDC,${size},0xh${tid},${tid}`); tid++;
  t += 2 * HOUR;
}
// 15 BTC: expectancy +5
for (let i = 0; i < 15; i++) trade("BTC", 40000, i % 2 === 0 ? 10 : 0, 0.01);
// 15 ETH: expectancy +6
for (let i = 0; i < 15; i++) trade("ETH", 2400, i % 2 === 0 ? 12 : 0, 0.1);
// 12 DOGE: expectancy -20
for (let i = 0; i < 12; i++) trade("DOGE", 0.1, -20, 200);
require("fs").writeFileSync("fixtures/bad-ticker.csv", lines.join("\n") + "\n");
console.log("wrote", lines.length - 1, "rows");
'
```

- [ ] **Step 4: Run + commit**

```bash
pnpm vitest run tests/unit/derivation/detectors/symbol-underperformance.test.ts
git add src/derivation/detectors/symbol-underperformance.ts fixtures/bad-ticker.csv tests/unit/derivation/detectors/symbol-underperformance.test.ts
git commit -m "feat(detectors): symbol_underperformance with fixture + unit tests"
```

---

## Task 16 — Detector: `leverage_creep`

**Rule:** Recent-30-day avg `maxNotionalUsd` ≥1.3× prior-30-day average, ≥10 perp positions in each window.
(Since HL CSV does not expose explicit account leverage, we track `maxNotionalUsd` as a proxy. When real leverage becomes available via wallet API, this detector can be tightened without changing its call signature.)

**Files:**
- Create: `fixtures/leverage-creep.csv`
- Create: `src/derivation/detectors/leverage-creep.ts`
- Create: `tests/unit/derivation/detectors/leverage-creep.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect } from 'vitest'
import { LeverageCreepDetector } from '~/derivation/detectors/leverage-creep'
import type { DerivationContext } from '~/derivation/detectors/types'
import type { Position } from '~/domain/position'

const DAY = 86_400_000
function p(id: string, notional: number, daysAgo: number, now: Date): Position {
  const t = now.getTime() - daysAgo * DAY
  return {
    id, userId: 'u1', exchange: 'hyperliquid', symbol: 'BTC',
    instrumentType: 'perp', side: 'long',
    entryAvgPrice: 40000, exitAvgPrice: 40000, size: notional / 40000,
    notionalUsd: notional, maxNotionalUsd: notional,
    realizedPnl: 0, totalFees: 0.2, fundingPnl: 0, wasLiquidated: false, needsReview: false,
    openedAt: new Date(t), closedAt: new Date(t + 3600000), fills: [], derivationVersion: 1,
  }
}
function ctx(now: Date, positions: Position[]): DerivationContext {
  return {
    userId: 'u1', derivationVersion: 1, now, fills: [], positions,
    summary: { totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0, winRate: 0, expectancy: 0,
               avgWin: 0, avgLoss: 0, profitFactor: null, maxDrawdown: 0, tradeCount: 0, medianPositionSizeUsd: 0 },
    daily: [], asset: [], session: [],
  }
}

describe('leverage_creep', () => {
  it('fires when recent avg maxNotional ≥1.3× prior avg (≥10 each window)', () => {
    const now = new Date('2024-03-02T00:00Z')
    const positions: Position[] = []
    for (let i = 0; i < 12; i++) positions.push(p(`old${i}`, 400, 45 + (i % 15), now))
    for (let i = 0; i < 12; i++) positions.push(p(`new${i}`, 600, 1 + (i % 29), now))
    const f = new LeverageCreepDetector().run(ctx(now, positions))
    expect(f).toHaveLength(1)
    expect(f[0]!.evidence.ratio).toBeCloseTo(1.5, 1)
  })

  it('does not fire with <10 per window', () => {
    const now = new Date('2024-03-02T00:00Z')
    const positions: Position[] = []
    for (let i = 0; i < 5; i++) positions.push(p(`old${i}`, 400, 45, now))
    for (let i = 0; i < 5; i++) positions.push(p(`new${i}`, 600, 2, now))
    expect(new LeverageCreepDetector().run(ctx(now, positions))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/derivation/detectors/leverage-creep.ts
import type { Detector, DerivationContext } from './types'
import type { Finding, LeverageCreepEvidence } from '~/domain/finding'
import { mean } from '../metrics/shared'

const WINDOW_DAYS = 30
const RATIO_THRESHOLD = 1.3
const MIN_PER_WINDOW = 10
const DAY_MS = 86_400_000

export class LeverageCreepDetector implements Detector {
  readonly id = 'leverage_creep'
  readonly description = 'Recent 30-day avg position max-notional ≥1.3× prior 30-day (perps only)'

  run(ctx: DerivationContext): Finding<LeverageCreepEvidence>[] {
    const nowMs = ctx.now.getTime()
    const recentStart = nowMs - WINDOW_DAYS * DAY_MS
    const priorStart = nowMs - 2 * WINDOW_DAYS * DAY_MS
    const recent: number[] = [], prior: number[] = []
    for (const p of ctx.positions) {
      if (p.instrumentType !== 'perp') continue
      const t = p.openedAt.getTime()
      if (t >= recentStart && t < nowMs) recent.push(p.maxNotionalUsd)
      else if (t >= priorStart && t < recentStart) prior.push(p.maxNotionalUsd)
    }
    if (recent.length < MIN_PER_WINDOW || prior.length < MIN_PER_WINDOW) return []
    const mR = mean(recent), mP = mean(prior)
    if (mP === 0) return []
    const ratio = mR / mP
    if (ratio < RATIO_THRESHOLD) return []

    return [{
      id: `find_lev_creep_${ctx.userId.slice(0, 8)}_v${ctx.derivationVersion}`,
      userId: ctx.userId, detectorId: 'leverage_creep', severity: 'warning',
      title: 'Leverage creeping up',
      bodyMarkdown: `Your average perp position size is ${ratio.toFixed(1)}× larger over the last ${WINDOW_DAYS} days than the ${WINDOW_DAYS} before.`,
      evidence: {
        priorAvgMaxNotionalUsd: mP, recentAvgMaxNotionalUsd: mR, ratio,
        priorSampleSize: prior.length, recentSampleSize: recent.length, windowDays: WINDOW_DAYS,
      },
      referencedPositionIds: [],
      periodStart: new Date(priorStart), periodEnd: ctx.now,
      derivationVersion: ctx.derivationVersion,
    }]
  }
}
```

- [ ] **Step 3: `fixtures/leverage-creep.csv`**

```bash
node -e '
const lines = ["time,coin,side,px,sz,dir,closedPnl,fee,feeToken,startPosition,hash,tid"];
const DAY = 86400000;
const HOUR = 3600000;
let tid = 12001;
const NOW = 1709337600000;
// Prior 30 days: 12 trades at 0.01 BTC
for (let i = 0; i < 12; i++) {
  const t = Math.floor(NOW - (30 + (i * 2)) * DAY);
  lines.push(`${t},BTC,B,40000,0.01,Open Long,0,0.2,USDC,0,0xh${tid},${tid}`); tid++;
  lines.push(`${t + HOUR},BTC,A,40100,0.01,Close Long,1,0.2005,USDC,0.01,0xh${tid},${tid}`); tid++;
}
// Recent 30 days: 12 trades at 0.015 BTC (1.5× size)
for (let i = 0; i < 12; i++) {
  const t = Math.floor(NOW - ((i + 1) * 2) * DAY);
  lines.push(`${t},BTC,B,40000,0.015,Open Long,0,0.3,USDC,0,0xh${tid},${tid}`); tid++;
  lines.push(`${t + HOUR},BTC,A,40100,0.015,Close Long,1.5,0.30075,USDC,0.015,0xh${tid},${tid}`); tid++;
}
require("fs").writeFileSync("fixtures/leverage-creep.csv", lines.join("\n") + "\n");
console.log("wrote", lines.length - 1, "rows");
'
```

- [ ] **Step 4: Run + commit**

```bash
pnpm vitest run tests/unit/derivation/detectors/leverage-creep.test.ts
git add src/derivation/detectors/leverage-creep.ts fixtures/leverage-creep.csv tests/unit/derivation/detectors/leverage-creep.test.ts
git commit -m "feat(detectors): leverage_creep with fixture + unit tests"
```

---

## Task 17 — Detector registry + runner

**Why:** Glues merge → metrics → 11 detectors into one `runDerivation({ userId })` entrypoint. Every write happens at `DERIVATION_VERSION` and is upserted (idempotent re-derive at same version is a no-op).

**Files:**
- Create: `src/derivation/detectors/index.ts`
- Create: `src/derivation/persist.ts`
- Create: `src/derivation/runner.ts`
- Create: `tests/unit/derivation/runner.test.ts`

- [ ] **Step 1: Create `src/derivation/detectors/index.ts`**

```ts
import type { Detector } from './types'
import { RevengeTradingDetector } from './revenge-trading'
import { OversizedPositionsDetector } from './oversized-positions'
import { LossOfDisciplineWindowsDetector } from './loss-of-discipline-windows'
import { PositionSizingInstabilityDetector } from './position-sizing-instability'
import { CutWinnersRideLosersDetector } from './cut-winners-ride-losers'
import { OvertradingAfterLossesDetector } from './overtrading-after-losses'
import { FeeDragDetector } from './fee-drag'
import { ScalingIntoLosersDetector } from './scaling-into-losers'
import { ShortHoldScalpingDetector } from './short-hold-scalping'
import { SymbolUnderperformanceDetector } from './symbol-underperformance'
import { LeverageCreepDetector } from './leverage-creep'

export const DETECTORS: Detector[] = [
  new RevengeTradingDetector(),
  new OversizedPositionsDetector(),
  new LossOfDisciplineWindowsDetector(),
  new PositionSizingInstabilityDetector(),
  new CutWinnersRideLosersDetector(),
  new OvertradingAfterLossesDetector(),
  new FeeDragDetector(),
  new ScalingIntoLosersDetector(),
  new ShortHoldScalpingDetector(),
  new SymbolUnderperformanceDetector(),
  new LeverageCreepDetector(),
]
```

- [ ] **Step 2: Create `src/derivation/persist.ts`**

```ts
import { and, eq } from 'drizzle-orm'
import type { DB } from '~/db/client'
import {
  position as positionTable, positionFill, dailyMetric, assetMetric,
  sessionMetric, summaryRollup, finding as findingTable,
} from '~/db/schema/derivation'
import type { Position } from '~/domain/position'
import type { DailyMetricValue, AssetMetricValue, SessionMetricValue, SummaryRollupValue } from '~/domain/metrics'
import type { Finding } from '~/domain/finding'

export async function persistDerivation(
  db: DB,
  userId: string,
  version: number,
  positions: Position[],
  daily: DailyMetricValue[],
  asset: AssetMetricValue[],
  session: SessionMetricValue[],
  summary: SummaryRollupValue,
  findings: Finding[],
) {
  // Positions + position_fill upsert (delete old at this version, insert fresh)
  await db.delete(positionTable).where(
    and(eq(positionTable.userId, userId), eq(positionTable.derivationVersion, version)),
  )
  if (positions.length) {
    await db.insert(positionTable).values(positions.map(p => ({
      id: p.id, userId: p.userId, exchange: p.exchange, symbol: p.symbol,
      instrumentType: p.instrumentType, side: p.side,
      entryAvgPrice: String(p.entryAvgPrice),
      exitAvgPrice: p.exitAvgPrice != null ? String(p.exitAvgPrice) : null,
      size: String(p.size),
      notionalUsd: String(p.notionalUsd),
      maxNotionalUsd: String(p.maxNotionalUsd),
      realizedPnl: String(p.realizedPnl),
      totalFees: String(p.totalFees),
      fundingPnl: String(p.fundingPnl),
      wasLiquidated: p.wasLiquidated,
      needsReview: p.needsReview,
      openedAt: p.openedAt, closedAt: p.closedAt,
      derivationVersion: version,
    })))
    const rows = positions.flatMap(p => p.fills.map((f, i) => ({
      id: `${p.id}_fill_${i}`,
      positionId: p.id, fillId: f.fillId, role: f.role, derivationVersion: version,
    })))
    if (rows.length) await db.insert(positionFill).values(rows).onConflictDoNothing()
  }

  // Daily metrics
  await db.delete(dailyMetric).where(
    and(eq(dailyMetric.userId, userId), eq(dailyMetric.derivationVersion, version)),
  )
  if (daily.length) {
    await db.insert(dailyMetric).values(daily.map(d => ({
      id: `dm_${userId.slice(0, 8)}_${d.date}_v${version}`,
      userId, date: d.date,
      tradeCount: d.tradeCount,
      realizedPnl: String(d.realizedPnl),
      volumeUsd: String(d.volumeUsd),
      winCount: d.winCount, lossCount: d.lossCount,
      totalFees: String(d.totalFees),
      derivationVersion: version,
    })))
  }

  // Asset metrics
  await db.delete(assetMetric).where(
    and(eq(assetMetric.userId, userId), eq(assetMetric.derivationVersion, version)),
  )
  if (asset.length) {
    await db.insert(assetMetric).values(asset.map(a => ({
      id: `am_${userId.slice(0, 8)}_${a.symbol}_v${version}`,
      userId, symbol: a.symbol,
      tradeCount: a.tradeCount,
      realizedPnl: String(a.realizedPnl),
      winRate: String(a.winRate),
      avgWin: String(a.avgWin),
      avgLoss: String(a.avgLoss),
      expectancy: String(a.expectancy),
      derivationVersion: version,
    })))
  }

  // Session metrics
  await db.delete(sessionMetric).where(
    and(eq(sessionMetric.userId, userId), eq(sessionMetric.derivationVersion, version)),
  )
  if (session.length) {
    await db.insert(sessionMetric).values(session.map(s => ({
      id: `sm_${userId.slice(0, 8)}_h${s.hourOfDayUtc}_v${version}`,
      userId, hourOfDayUtc: s.hourOfDayUtc,
      tradeCount: s.tradeCount,
      realizedPnl: String(s.realizedPnl),
      winRate: String(s.winRate),
      expectancy: String(s.expectancy),
      derivationVersion: version,
    })))
  }

  // Summary rollup
  await db.delete(summaryRollup).where(
    and(eq(summaryRollup.userId, userId), eq(summaryRollup.derivationVersion, version)),
  )
  await db.insert(summaryRollup).values({
    id: `sum_${userId.slice(0, 8)}_v${version}`,
    userId,
    totalPnl: String(summary.totalPnl),
    grossProfit: String(summary.grossProfit),
    grossLoss: String(summary.grossLoss),
    totalFees: String(summary.totalFees),
    winRate: String(summary.winRate),
    expectancy: String(summary.expectancy),
    avgWin: String(summary.avgWin),
    avgLoss: String(summary.avgLoss),
    profitFactor: summary.profitFactor != null ? String(summary.profitFactor) : null,
    maxDrawdown: String(summary.maxDrawdown),
    tradeCount: summary.tradeCount,
    medianPositionSizeUsd: String(summary.medianPositionSizeUsd),
    derivationVersion: version,
  })

  // Findings
  await db.delete(findingTable).where(
    and(eq(findingTable.userId, userId), eq(findingTable.derivationVersion, version)),
  )
  if (findings.length) {
    await db.insert(findingTable).values(findings.map(f => ({
      id: f.id, userId: f.userId, detectorId: f.detectorId, severity: f.severity,
      title: f.title, bodyMarkdown: f.bodyMarkdown,
      evidence: f.evidence as unknown,
      referencedPositionIds: f.referencedPositionIds,
      periodStart: f.periodStart, periodEnd: f.periodEnd,
      derivationVersion: version,
    })))
  }
}
```

- [ ] **Step 3: Create `src/derivation/runner.ts`**

```ts
import { eq } from 'drizzle-orm'
import type { DB } from '~/db/client'
import { fill as fillTable } from '~/db/schema/canonical'
import { mergeFillsIntoPositions } from './merge'
import { computeDailyMetrics } from './metrics/daily'
import { computeAssetMetrics } from './metrics/asset'
import { computeSessionMetrics } from './metrics/session'
import { computeSummaryRollup } from './metrics/summary'
import { DETECTORS } from './detectors'
import type { DerivationContext } from './detectors/types'
import { persistDerivation } from './persist'
import { DERIVATION_VERSION } from './version'
import { log } from '~/lib/log'
import type { CanonicalFill } from '~/domain/fill'

export type RunDerivationArgs = {
  db: DB
  userId: string
  version?: number
  now?: Date
}

export async function runDerivation(args: RunDerivationArgs) {
  const { db, userId, version = DERIVATION_VERSION, now = new Date() } = args
  log.info('derivation: start', { userId, version })

  const rows = await db.select().from(fillTable).where(eq(fillTable.userId, userId))
  const fills = rows.map(r => ({
    id: r.id, userId: r.userId, exchange: r.exchange as CanonicalFill['exchange'],
    symbol: r.symbol, instrumentType: r.instrumentType, side: r.side,
    price: r.price, size: r.size, fee: r.fee, feeCurrency: r.feeCurrency,
    executedAt: r.executedAt, externalId: r.externalId,
    normalizerHint: (r.normalizerHint as Record<string, unknown> | null) ?? undefined,
  })) as (CanonicalFill & { id: string })[]

  const positions = mergeFillsIntoPositions(userId, fills, version)
  const daily = computeDailyMetrics(positions)
  const asset = computeAssetMetrics(positions)
  const session = computeSessionMetrics(positions)
  const summary = computeSummaryRollup(positions, daily)
  const ctx: DerivationContext = { userId, derivationVersion: version, now, fills, positions, daily, asset, session, summary }
  const findings = DETECTORS.flatMap(d => {
    try { return d.run(ctx) }
    catch (err) { log.error('detector threw', { id: d.id, err: String(err) }); return [] }
  })

  await persistDerivation(db, userId, version, positions, daily, asset, session, summary, findings)

  log.info('derivation: done', { userId, version, positions: positions.length, findings: findings.length })
  return { positionCount: positions.length, findingCount: findings.length }
}
```

- [ ] **Step 4: Create `tests/unit/derivation/runner.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { loadHlFixture } from '~/../tests/_support/fixtures'
import { mergeFillsIntoPositions } from '~/derivation/merge'
import { computeDailyMetrics } from '~/derivation/metrics/daily'
import { computeAssetMetrics } from '~/derivation/metrics/asset'
import { computeSessionMetrics } from '~/derivation/metrics/session'
import { computeSummaryRollup } from '~/derivation/metrics/summary'
import { DETECTORS } from '~/derivation/detectors'
import type { DerivationContext } from '~/derivation/detectors/types'

describe('derivation runner (in-memory, no DB)', () => {
  it('steady-discipline fixture produces zero findings', () => {
    const fills = loadHlFixture('steady-discipline.csv')
    const positions = mergeFillsIntoPositions('u1', fills, 1)
    const daily = computeDailyMetrics(positions)
    const asset = computeAssetMetrics(positions)
    const session = computeSessionMetrics(positions)
    const summary = computeSummaryRollup(positions, daily)
    const ctx: DerivationContext = {
      userId: 'u1', derivationVersion: 1, now: new Date('2024-02-01'),
      fills, positions, daily, asset, session, summary,
    }
    const findings = DETECTORS.flatMap(d => d.run(ctx))
    expect(findings).toHaveLength(0)
  })
})
```

- [ ] **Step 5: Run + commit**

```bash
pnpm vitest run tests/unit/derivation/runner.test.ts
git add src/derivation/detectors/index.ts src/derivation/persist.ts src/derivation/runner.ts tests/unit/derivation/runner.test.ts
git commit -m "feat(derivation): runner + persist + detector registry"
```

---

## Task 18 — Inngest function on `ingestion/complete`

**Files:**
- Modify: `src/jobs/events.ts`
- Create: `src/jobs/derivation.ts`
- Modify: `src/jobs/functions.ts`

- [ ] **Step 1: Modify `src/jobs/events.ts` — add derivation events**

Append:

```ts
export type DerivationCompletePayload = {
  name: 'derivation/complete'
  data: { userId: string; derivationVersion: number; positionCount: number; findingCount: number }
}
export type DerivationRederivePayload = {
  name: 'derivation/rederive'
  data: { userId: string; derivationVersion: number }
}
export async function sendDerivationComplete(data: DerivationCompletePayload['data']) {
  await inngest.send({ name: 'derivation/complete', data })
}
export async function sendDerivationRederive(data: DerivationRederivePayload['data']) {
  await inngest.send({ name: 'derivation/rederive', data })
}
```

- [ ] **Step 2: Create `src/jobs/derivation.ts`**

```ts
import { inngest } from './client'
import { db } from '~/db/client'
import { importRecord } from '~/db/schema/ingestion'
import { eq } from 'drizzle-orm'
import { runDerivation } from '~/derivation/runner'
import { DERIVATION_VERSION } from '~/derivation/version'
import { sendDerivationComplete } from './events'
import { log } from '~/lib/log'

export const deriveOnIngestionCompleteFn = inngest.createFunction(
  {
    id: 'derive-on-ingestion-complete',
    name: 'Derive after ingestion complete',
    triggers: [{ event: 'ingestion/complete' }],
    concurrency: { limit: 3, key: 'event.data.userId' },
    retries: 2,
  },
  async ({ event, step }) => {
    const { userId, importId } = event.data as { userId: string; importId: string }
    log.info('derive: triggered', { userId, importId })
    await step.run('mark-deriving', async () => {
      if (importId) {
        await db.update(importRecord).set({ status: 'deriving' }).where(eq(importRecord.id, importId))
      }
    })
    const result = await step.run('run-derivation', () =>
      runDerivation({ db, userId, version: DERIVATION_VERSION }),
    )
    await step.run('emit-complete', () =>
      sendDerivationComplete({ userId, derivationVersion: DERIVATION_VERSION, ...result }),
    )
    await step.run('mark-complete', async () => {
      if (importId) {
        await db.update(importRecord).set({ status: 'complete' }).where(eq(importRecord.id, importId))
      }
    })
    return result
  },
)

export const rederiveFn = inngest.createFunction(
  {
    id: 'rederive',
    name: 'Rederive at version',
    triggers: [{ event: 'derivation/rederive' }],
    concurrency: { limit: 1, key: 'event.data.userId' },
    retries: 2,
  },
  async ({ event, step }) => {
    const { userId, derivationVersion } = event.data as { userId: string; derivationVersion: number }
    const result = await step.run('run-derivation', () =>
      runDerivation({ db, userId, version: derivationVersion }),
    )
    await step.run('emit-complete', () =>
      sendDerivationComplete({ userId, derivationVersion, ...result }),
    )
    return result
  },
)
```

- [ ] **Step 3: Modify `src/jobs/functions.ts`**

```ts
import { cron } from 'inngest'
import { inngest } from './client'
import { hlWalletPullFn } from './ingestion'
import { deriveOnIngestionCompleteFn, rederiveFn } from './derivation'

const heartbeat = inngest.createFunction(
  { id: 'heartbeat', name: 'Heartbeat', triggers: [cron('0 * * * *')] },
  async ({ step }) => { await step.run('ping', () => ({ ok: true, ts: new Date().toISOString() })) },
)

export const functions = [heartbeat, hlWalletPullFn, deriveOnIngestionCompleteFn, rederiveFn]
```

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm typecheck
git add src/jobs/events.ts src/jobs/derivation.ts src/jobs/functions.ts
git commit -m "feat(jobs): derive-on-ingestion-complete + rederive Inngest functions"
```

---

## Task 19 — Admin `rederive` CLI

**Files:**
- Create: `scripts/rederive.ts`
- Modify: `package.json` (add script)

- [ ] **Step 1: Create `scripts/rederive.ts`**

```ts
#!/usr/bin/env tsx
import { db } from '~/db/client'
import { user } from '~/db/schema/auth'
import { runDerivation } from '~/derivation/runner'
import { DERIVATION_VERSION } from '~/derivation/version'

function parseArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const userArg = parseArg('--user')
  const versionArg = parseArg('--version')
  const version = versionArg ? parseInt(versionArg, 10) : DERIVATION_VERSION

  const users = userArg
    ? [{ id: userArg }]
    : await db.select({ id: user.id }).from(user)

  console.log(`Rederiving ${users.length} user(s) at version ${version}…`)
  for (const u of users) {
    const res = await runDerivation({ db, userId: u.id, version })
    console.log(`  ${u.id}: ${res.positionCount} positions, ${res.findingCount} findings`)
  }
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
```

- [ ] **Step 2: Modify `package.json` — add script**

```json
"scripts": {
  ...existing,
  "rederive": "tsx scripts/rederive.ts"
}
```

- [ ] **Step 3: Smoke-test + commit**

Run: `pnpm rederive --user=nonexistent-user` — should print `0 positions, 0 findings` and exit 0.

```bash
git add scripts/rederive.ts package.json
git commit -m "feat(scripts): rederive CLI for version bumps"
```

---

## Task 20 — Golden-fixture integration tests

**Why:** Every detector should fire on its fixture; `steady-discipline` fires zero. This is the final gate on the whole pipeline.

**Files:**
- Create: `tests/integration/derivation/golden-fixtures.test.ts`

- [ ] **Step 1: Write the matrix test**

```ts
import { describe, it, expect } from 'vitest'
import { loadHlFixture } from '~/../tests/_support/fixtures'
import { mergeFillsIntoPositions } from '~/derivation/merge'
import { computeDailyMetrics } from '~/derivation/metrics/daily'
import { computeAssetMetrics } from '~/derivation/metrics/asset'
import { computeSessionMetrics } from '~/derivation/metrics/session'
import { computeSummaryRollup } from '~/derivation/metrics/summary'
import { DETECTORS } from '~/derivation/detectors'
import type { DerivationContext } from '~/derivation/detectors/types'

type Case = { fixture: string; expect: string | null; now?: Date }

const CASES: Case[] = [
  { fixture: 'steady-discipline.csv',      expect: null },
  { fixture: 'revenge-trader.csv',         expect: 'revenge_trading' },
  { fixture: 'size-bloater.csv',           expect: 'oversized_positions' },
  { fixture: 'evening-tilt.csv',           expect: 'loss_of_discipline_windows' },
  { fixture: 'size-drift.csv',             expect: 'position_sizing_instability', now: new Date('2024-03-02T00:00Z') },
  { fixture: 'winner-cutter.csv',          expect: 'cut_winners_ride_losers' },
  { fixture: 'loss-chaser.csv',            expect: 'overtrading_after_losses' },
  { fixture: 'fee-bleed.csv',              expect: 'fee_drag' },
  { fixture: 'pyramid-losers.csv',         expect: 'scaling_into_losers' },
  { fixture: 'scalp-gambler.csv',          expect: 'short_hold_scalping' },
  { fixture: 'bad-ticker.csv',             expect: 'symbol_underperformance' },
  { fixture: 'leverage-creep.csv',         expect: 'leverage_creep',           now: new Date('2024-03-02T00:00Z') },
]

describe.each(CASES)('golden fixture: $fixture', ({ fixture, expect: expected, now }) => {
  it(`${expected ? `fires ${expected}` : 'fires nothing'}`, () => {
    const fills = loadHlFixture(fixture)
    const positions = mergeFillsIntoPositions('u1', fills, 1)
    const daily = computeDailyMetrics(positions)
    const asset = computeAssetMetrics(positions)
    const session = computeSessionMetrics(positions)
    const summary = computeSummaryRollup(positions, daily)
    const ctx: DerivationContext = {
      userId: 'u1', derivationVersion: 1,
      now: now ?? new Date('2024-02-01T00:00Z'),
      fills, positions, daily, asset, session, summary,
    }
    const findings = DETECTORS.flatMap(d => d.run(ctx))
    const ids = findings.map(f => f.detectorId)
    if (expected === null) {
      expect(ids, `steady-discipline should fire nothing, got ${ids.join(', ')}`).toHaveLength(0)
    } else {
      expect(ids, `expected ${expected} in ${ids.join(', ') || '(none)'}`).toContain(expected)
    }
  })
})
```

- [ ] **Step 2: Run whole suite**

Run: `pnpm vitest run`
Expected: full suite green, including all 12 golden-fixture rows.

If any fixture row fails, iterate on the *fixture* (not the detector) unless the unit test for that detector is failing too. Fixtures are easier to tune than detectors.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/derivation/golden-fixtures.test.ts
git commit -m "test(derivation): golden fixture matrix — all 12 personas"
```

---

## Self-review checklist

- [ ] All 11 detectors have: a positive fixture CSV, a unit test file, a row in `golden-fixtures.test.ts`, and a line in `DETECTORS` registry.
- [ ] `DERIVATION_VERSION = 1` is imported everywhere (no hard-coded 1s outside tests).
- [ ] Evidence-schema shapes match what the detector writes and what `Finding.evidence` JSONB will store.
- [ ] `persistDerivation` upserts by deleting the `(userId, version)` slice first — reruns at the same version are idempotent.
- [ ] `ingestion/complete` → `derive-on-ingestion-complete` chain is wired through `src/jobs/functions.ts`.
- [ ] `pnpm typecheck` and `pnpm vitest run` are both green before opening a PR.

## Wiki update (post-implementation)

Once all tasks are green on `main` (or the feature branch), append a Phase 2 entry to `docs/wiki/phases.md` covering: deliverables shipped, notable design decisions (e.g. using `maxNotionalUsd` as leverage proxy), fixture structure, and any follow-up items deferred to Phase 3.
