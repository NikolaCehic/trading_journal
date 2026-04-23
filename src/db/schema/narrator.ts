import {
  pgTable, text, timestamp, integer, jsonb,
  unique, index, uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import { position } from './derivation'

// ---------------------------------------------------------------------------
// digest_run — one row per composed weekly digest
// ---------------------------------------------------------------------------
export const digestRun = pgTable('digest_run', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  isoWeek: text('iso_week').notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  status: text('status').notNull().$type<'pending' | 'composed' | 'sent' | 'failed'>(),
  narrative: jsonb('narrative').$type<Record<string, unknown> | null>(),
  emailMessageId: text('email_message_id'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
}, (t) => [
  unique('digest_run_user_week_key').on(t.userId, t.isoWeek),
])

export type DigestRun = typeof digestRun.$inferSelect
export type NewDigestRun = typeof digestRun.$inferInsert

// ---------------------------------------------------------------------------
// digest_rule — user-opt-in behavioural rule
// ---------------------------------------------------------------------------
export const digestRule = pgTable('digest_rule', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  detectorId: text('detector_id').notNull(),
  ruleText: text('rule_text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (t) => [
  index('digest_rule_user_detector_idx').on(t.userId, t.detectorId),
])

export type DigestRule = typeof digestRule.$inferSelect
export type NewDigestRule = typeof digestRule.$inferInsert

// ---------------------------------------------------------------------------
// trade_coach_note — cached AI commentary per position
// ---------------------------------------------------------------------------
export const tradeCoachNote = pgTable('trade_coach_note', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  positionId: text('position_id').notNull().references(() => position.id, { onDelete: 'cascade' }),
  derivationVersion: integer('derivation_version').notNull(),
  narrativeMarkdown: text('narrative_markdown').notNull(),
  referencedPositionIds: text('referenced_position_ids').array().notNull().default([]),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('trade_coach_note_pos_ver_key').on(t.positionId, t.derivationVersion),
])

export type TradeCoachNote = typeof tradeCoachNote.$inferSelect
export type NewTradeCoachNote = typeof tradeCoachNote.$inferInsert
