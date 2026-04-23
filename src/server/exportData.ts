import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { eq, inArray } from 'drizzle-orm'
import { auth } from '~/auth/server'
import { db } from '~/db/client'
import { user } from '~/db/schema/auth'
import { fill } from '~/db/schema/canonical'
import { position, positionFill, finding } from '~/db/schema/derivation'
import {
  tradeNote,
  setupTag,
  mistakeTag,
  positionTag,
  positionReflection,
} from '~/db/schema/journal'
import { importRecord } from '~/db/schema/ingestion'
import { digestRule } from '~/db/schema/narrator'

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type ExportBundle = {
  exportedAt: string
  user: { id: string; email: string; timezone: string; digestEnabled: boolean; createdAt: string }
  positions: unknown[]
  fills: unknown[]
  notes: unknown[]
  tags: { setup: unknown[]; mistake: unknown[] }
  positionTags: unknown[]
  reflections: unknown[]
  findings: unknown[]
  rules: unknown[]
  imports: unknown[]
}

export const exportAllData = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await auth.api.getSession({ headers: getRequest().headers })
  if (!session?.user) throw new Error('Unauthorized')
  const userId = session.user.id

  // Load user row directly to get digestEnabled
  const [userRow] = await db
    .select({
      id: user.id,
      email: user.email,
      timezone: user.timezone,
      digestEnabled: user.digestEnabled,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, userId))

  if (!userRow) throw new Error('User not found')

  // Positions
  const positions = await db
    .select()
    .from(position)
    .where(eq(position.userId, userId))

  // Fills — only those linked to user's positions, with jsonb field typed
  type FillExport = {
    id: string; userId: string; exchange: string; symbol: string
    instrumentType: 'spot' | 'perp'; side: 'buy' | 'sell'
    price: string; size: string; fee: string; feeCurrency: string
    executedAt: Date; externalId: string; rawImportRowId: string | null
    normalizerHint: JsonValue; createdAt: Date
  }
  let rawFills: FillExport[] = []
  if (positions.length > 0) {
    const positionIds = positions.map(p => p.id)
    const pfLinks = await db
      .select({ fillId: positionFill.fillId })
      .from(positionFill)
      .where(inArray(positionFill.positionId, positionIds))
    const fillIds = [...new Set(pfLinks.map(pf => pf.fillId))]
    if (fillIds.length > 0) {
      const rows = await db
        .select({
          id: fill.id,
          userId: fill.userId,
          exchange: fill.exchange,
          symbol: fill.symbol,
          instrumentType: fill.instrumentType,
          side: fill.side,
          price: fill.price,
          size: fill.size,
          fee: fill.fee,
          feeCurrency: fill.feeCurrency,
          executedAt: fill.executedAt,
          externalId: fill.externalId,
          rawImportRowId: fill.rawImportRowId,
          normalizerHint: fill.normalizerHint,
          createdAt: fill.createdAt,
        })
        .from(fill)
        .where(inArray(fill.id, fillIds))
      rawFills = rows.map(r => ({
        ...r,
        normalizerHint: (r.normalizerHint ?? null) as JsonValue,
      }))
    }
  }

  // Notes, reflections, positionTags
  const [notes, reflections, positionTags] = await Promise.all([
    db.select().from(tradeNote).where(eq(tradeNote.userId, userId)),
    db.select().from(positionReflection).where(eq(positionReflection.userId, userId)),
    db.select().from(positionTag).where(eq(positionTag.userId, userId)),
  ])

  // Setup + mistake tags
  const [setupTags, mistakeTags] = await Promise.all([
    db.select().from(setupTag).where(eq(setupTag.userId, userId)),
    db.select().from(mistakeTag).where(eq(mistakeTag.userId, userId)),
  ])

  // Findings — evidence is jsonb, type it explicitly
  type FindingExport = {
    id: string; userId: string; detectorId: string
    severity: 'info' | 'warning' | 'critical'; title: string; bodyMarkdown: string
    evidence: JsonValue; referencedPositionIds: string[]
    periodStart: Date | null; periodEnd: Date | null
    derivationVersion: number; createdAt: Date
  }
  const findingRows = await db.select().from(finding).where(eq(finding.userId, userId))
  const findings: FindingExport[] = findingRows.map(f => ({
    ...f,
    evidence: f.evidence as JsonValue,
  }))

  // Rules
  const rules = await db.select().from(digestRule).where(eq(digestRule.userId, userId))

  // Imports — errorDetail is jsonb
  type ImportExport = {
    id: string; userId: string; exchangeAccountId: string | null
    exchange: 'binance' | 'hyperliquid' | 'bybit' | 'okx'
    source: string; status: 'pending' | 'parsing' | 'normalizing' | 'deriving' | 'complete' | 'failed'
    fileName: string | null; rowCount: number; fillCount: number; skippedCount: number
    errorMessage: string | null; errorDetail: JsonValue
    startedAt: Date | null; completedAt: Date | null; createdAt: Date
  }
  const importRows = await db.select().from(importRecord).where(eq(importRecord.userId, userId))
  const imports: ImportExport[] = importRows.map(i => ({
    ...i,
    errorDetail: (i.errorDetail ?? null) as JsonValue,
  }))

  return {
    exportedAt: new Date().toISOString(),
    user: {
      id: userRow.id,
      email: userRow.email,
      timezone: userRow.timezone,
      digestEnabled: userRow.digestEnabled,
      createdAt: userRow.createdAt.toISOString(),
    },
    positions,
    fills: rawFills,
    notes,
    tags: { setup: setupTags, mistake: mistakeTags },
    positionTags,
    reflections,
    findings,
    rules,
    imports,
  }
})
