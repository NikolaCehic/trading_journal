import { pgTable, text, timestamp, numeric, jsonb, pgEnum, unique } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { rawImportRow } from './ingestion'

export const instrumentTypeEnum = pgEnum('instrument_type', ['spot', 'perp'])
export const sideEnum = pgEnum('side', ['buy', 'sell'])

export const fill = pgTable('fill', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  exchange: text('exchange').notNull(),
  symbol: text('symbol').notNull(),
  instrumentType: instrumentTypeEnum('instrument_type').notNull(),
  side: sideEnum('side').notNull(),
  price: numeric('price', { precision: 36, scale: 18 }).notNull(),
  size: numeric('size', { precision: 36, scale: 18 }).notNull(),
  fee: numeric('fee', { precision: 36, scale: 18 }).notNull().default('0'),
  feeCurrency: text('fee_currency').notNull(),
  executedAt: timestamp('executed_at', { withTimezone: true }).notNull(),
  externalId: text('external_id').notNull(),
  rawImportRowId: text('raw_import_row_id').references(() => rawImportRow.id),
  normalizerHint: jsonb('normalizer_hint'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('fill_user_exchange_external_id').on(t.userId, t.exchange, t.externalId),
])
