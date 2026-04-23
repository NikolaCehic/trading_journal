import {
  pgTable, text, timestamp, numeric, jsonb, integer, boolean,
  unique, index, pgEnum, primaryKey,
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import { fill, instrumentTypeEnum } from './canonical'
import { tradePlan } from './journal'

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
  rMultiple: numeric('r_multiple', { precision: 20, scale: 8 }),
  maxDrawdownPct: numeric('max_drawdown_pct', { precision: 10, scale: 6 }),
  planId: text('plan_id').references(() => tradePlan.id, { onDelete: 'set null' }),
  planSnapshotEntryPrice: numeric('plan_snapshot_entry_price', { precision: 20, scale: 8 }),
  planSnapshotStopPrice: numeric('plan_snapshot_stop_price', { precision: 20, scale: 8 }),
  planSnapshotTargetPrice: numeric('plan_snapshot_target_price', { precision: 20, scale: 8 }),
  planSnapshotSize: numeric('plan_snapshot_size', { precision: 20, scale: 8 }),
  planSnapshotRationale: text('plan_snapshot_rationale'),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  derivationVersion: integer('derivation_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
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
  index('position_fill_position_id_idx').on(t.positionId),
  index('position_fill_fill_id_idx').on(t.fillId),
])

export const dailyMetric = pgTable('daily_metric', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
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
  hourOfDayUtc: integer('hour_of_day_utc').notNull(),
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

// Day-of-week × hour heatmap metric.
// dayOfWeekUtc uses ISO 8601 style: Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6.
// Derived from: ((new Date(closedAt).getUTCDay() + 6) % 7)
export const dayOfWeekMetric = pgTable('day_of_week_metric', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  dayOfWeekUtc: integer('day_of_week_utc').notNull(),
  hourOfDayUtc: integer('hour_of_day_utc').notNull(),
  tradeCount: integer('trade_count').notNull().default(0),
  realizedPnl: numeric('realized_pnl', { precision: 36, scale: 18 }).notNull().default('0'),
  winRate: numeric('win_rate', { precision: 8, scale: 6 }).notNull().default('0'),
  expectancy: numeric('expectancy', { precision: 36, scale: 18 }).notNull().default('0'),
  derivationVersion: integer('derivation_version').notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.dayOfWeekUtc, t.hourOfDayUtc, t.derivationVersion] }),
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
