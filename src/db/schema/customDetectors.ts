import { pgTable, text, pgEnum, timestamp, boolean, jsonb, index } from 'drizzle-orm/pg-core'
import { user } from './auth'
import type { PositionPredicate } from '~/domain/userDetector'

export const detectorSeverityEnum = pgEnum('detector_severity', ['info', 'warning', 'critical'])

export const userDetector = pgTable('user_detector', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  title: text('title').notNull(),
  severity: detectorSeverityEnum('severity').notNull(),
  predicate: jsonb('predicate').$type<PositionPredicate>().notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('user_detector_user_idx').on(t.userId),
])

export type UserDetectorRow = typeof userDetector.$inferSelect
