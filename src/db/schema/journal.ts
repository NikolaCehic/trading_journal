import {
  pgTable, text, timestamp, integer, boolean, jsonb, numeric,
  unique, index, pgEnum,
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import { position } from './derivation'

export const planSideEnum = pgEnum('plan_side', ['long', 'short'])
export const tagKindEnum = pgEnum('tag_kind', ['setup', 'mistake'])
export const emotionalStateEnum = pgEnum('emotional_state', [
  'calm', 'fomo', 'revenge', 'bored', 'anxious', 'confident',
])

export const tradeNote = pgTable('trade_note', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  positionId: text('position_id').notNull().references(() => position.id, { onDelete: 'cascade' }),
  bodyMarkdown: text('body_markdown').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('trade_note_unique_position').on(t.userId, t.positionId),
])

export const setupTag = pgTable('setup_tag', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  color: text('color'),                // hex, optional
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('setup_tag_unique_label').on(t.userId, t.label),
  index('setup_tag_user_idx').on(t.userId),
])

export const mistakeTag = pgTable('mistake_tag', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  color: text('color'),
  isDefault: boolean('is_default').notNull().default(false),   // true for seeded starters
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('mistake_tag_unique_label').on(t.userId, t.label),
  index('mistake_tag_user_idx').on(t.userId),
])

export const positionTag = pgTable('position_tag', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  positionId: text('position_id').notNull().references(() => position.id, { onDelete: 'cascade' }),
  kind: tagKindEnum('kind').notNull(),
  setupTagId: text('setup_tag_id').references(() => setupTag.id, { onDelete: 'cascade' }),
  mistakeTagId: text('mistake_tag_id').references(() => mistakeTag.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('position_tag_unique').on(t.positionId, t.kind, t.setupTagId, t.mistakeTagId),
  index('position_tag_position_idx').on(t.positionId),
])

export const positionReflection = pgTable('position_reflection', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  positionId: text('position_id').notNull().references(() => position.id, { onDelete: 'cascade' }),
  confidence: integer('confidence'),                  // 1..5 nullable
  emotionalState: emotionalStateEnum('emotional_state'),
  reflectionMarkdown: text('reflection_markdown'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('position_reflection_unique').on(t.userId, t.positionId),
])

export const tradePlan = pgTable('trade_plan', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  symbol: text('symbol').notNull(),
  intendedSide: planSideEnum('intended_side').notNull(),
  entryPrice: numeric('entry_price', { precision: 20, scale: 8 }),
  stopPrice: numeric('stop_price', { precision: 20, scale: 8 }),
  targetPrice: numeric('target_price', { precision: 20, scale: 8 }),
  plannedSize: numeric('planned_size', { precision: 20, scale: 8 }),
  rationale: text('rationale'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (t) => [
  index('trade_plan_user_symbol_idx').on(t.userId, t.symbol),
])

export type TradePlanRow = typeof tradePlan.$inferSelect
