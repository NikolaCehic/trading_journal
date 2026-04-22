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
