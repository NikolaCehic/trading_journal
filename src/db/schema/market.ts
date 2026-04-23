import { pgTable, text, pgEnum, timestamp, numeric, primaryKey, index } from 'drizzle-orm/pg-core'

export const candleIntervalEnum = pgEnum('candle_interval', ['5m', '15m', '1h', '4h', '1d'])

export const marketCandle = pgTable('market_candle', {
  exchange: text('exchange').notNull(),
  symbol: text('symbol').notNull(),
  interval: candleIntervalEnum('interval').notNull(),
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

export type MarketCandleRow = typeof marketCandle.$inferSelect
