import { pgTable, text, timestamp, integer, jsonb, pgEnum } from 'drizzle-orm/pg-core'
import { user } from './auth'

export const importStatusEnum = pgEnum('import_status', [
  'pending',
  'parsing',
  'normalizing',
  'deriving',
  'complete',
  'failed',
])

export const exchangeKindEnum = pgEnum('exchange_kind', [
  'binance',
  'hyperliquid',
  'bybit',
  'okx',
])

export const normalizeStatusEnum = pgEnum('normalize_status', [
  'normalized',
  'skipped',
  'errored',
])

export const exchangeAccount = pgTable('exchange_account', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  exchange: exchangeKindEnum('exchange').notNull(),
  walletAddress: text('wallet_address'),
  label: text('label'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const importRecord = pgTable('import', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  exchangeAccountId: text('exchange_account_id').references(() => exchangeAccount.id),
  exchange: exchangeKindEnum('exchange').notNull(),
  source: text('source').notNull(),
  status: importStatusEnum('status').notNull().default('pending'),
  fileName: text('file_name'),
  rowCount: integer('row_count').notNull().default(0),
  fillCount: integer('fill_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  errorMessage: text('error_message'),
  errorDetail: jsonb('error_detail'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const rawImportRow = pgTable('raw_import_row', {
  id: text('id').primaryKey(),
  importId: text('import_id').notNull().references(() => importRecord.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  rowIndex: integer('row_index').notNull(),
  rawData: jsonb('raw_data').notNull(),
  normalizeStatus: normalizeStatusEnum('normalize_status').notNull().default('normalized'),
  normalizeError: text('normalize_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
