import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import type { DB } from '~/db/client'
import { position, positionFill, finding } from '~/db/schema/derivation'
import { fill as fillTable } from '~/db/schema/canonical'
import { DERIVATION_VERSION } from '~/derivation/version'
import type { DetectorId, FindingSeverity } from '~/domain/finding'
import type { CoachFactBundle } from './types'

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function buildCoachFacts(
  db: DB,
  userId: string,
  positionId: string,
): Promise<CoachFactBundle> {
  // ---- Position (with ownership check) ------------------------------------
  const pos = await db.query.position.findFirst({
    where: and(
      eq(position.id, positionId),
      eq(position.userId, userId),
      eq(position.derivationVersion, DERIVATION_VERSION),
    ),
  })
  if (!pos) throw new Error(`Position not found or access denied: ${positionId}`)

  const durationMinutes = pos.closedAt
    ? Math.round((pos.closedAt.getTime() - pos.openedAt.getTime()) / 60_000)
    : 0

  // ---- Fills ---------------------------------------------------------------
  const positionFills = await db.select().from(positionFill).where(
    eq(positionFill.positionId, positionId),
  )
  const fillIds = positionFills.map(pf => pf.fillId)
  const fills = fillIds.length
    ? await db.select().from(fillTable).where(inArray(fillTable.id, fillIds))
    : []
  const fillMap = new Map(fills.map(f => [f.id, f]))

  const fillsOut = positionFills
    .map(pf => {
      const f = fillMap.get(pf.fillId)
      if (!f) return null
      return {
        id: f.id,
        side: f.side as 'buy' | 'sell',
        price: Number(f.price),
        size: Number(f.size),
        fee: Number(f.fee),
        executedAt: f.executedAt.toISOString(),
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.executedAt.localeCompare(b.executedAt))

  // ---- Findings for this position ------------------------------------------
  const posFindings = await db.select().from(finding).where(
    and(
      eq(finding.userId, userId),
      eq(finding.derivationVersion, DERIVATION_VERSION),
      sql`${positionId} = ANY(${finding.referencedPositionIds})`,
    ),
  )

  const thisPositionFindings = posFindings.map(f => ({
    findingId: f.id,
    detectorId: f.detectorId as DetectorId,
    severity: f.severity as FindingSeverity,
  }))

  // ---- Recent pattern matches (last 90d, same detector, other positions) ---
  const cutoff = new Date(Date.now() - 90 * 86_400_000)
  const detectorIds = [...new Set(posFindings.map(f => f.detectorId))]

  const patternMatches: CoachFactBundle['recentPatternMatches'] = []
  if (detectorIds.length > 0) {
    // Get findings with the same detectors in last 90d
    const recentFindings = await db.select().from(finding).where(
      and(
        eq(finding.userId, userId),
        eq(finding.derivationVersion, DERIVATION_VERSION),
        inArray(finding.detectorId, detectorIds),
        gte(finding.createdAt, cutoff),
      ),
    )

    // Gather referenced position IDs from those findings (excluding this position)
    const otherPositionIds = new Set<string>()
    const findingByPositionId = new Map<string, typeof recentFindings[0]>()
    for (const f of recentFindings) {
      for (const pid of f.referencedPositionIds) {
        if (pid !== positionId) {
          otherPositionIds.add(pid)
          findingByPositionId.set(pid, f)
        }
      }
    }

    if (otherPositionIds.size > 0) {
      const otherPositions = await db.select().from(position).where(
        and(
          eq(position.userId, userId),
          inArray(position.id, [...otherPositionIds]),
          gte(position.closedAt, cutoff),
        ),
      )

      for (const p of otherPositions) {
        const relatedFinding = findingByPositionId.get(p.id)
        if (!relatedFinding) continue
        patternMatches.push({
          positionId: p.id,
          symbol: p.symbol,
          detectorId: relatedFinding.detectorId as DetectorId,
          realizedPnl: Number(p.realizedPnl),
          executedAt: (p.closedAt ?? p.openedAt).toISOString(),
        })
        if (patternMatches.length >= 10) break
      }
    }
  }

  // ---- User baselines (last 90d positions) ---------------------------------
  const recentPositions = await db.select().from(position).where(
    and(
      eq(position.userId, userId),
      eq(position.derivationVersion, DERIVATION_VERSION),
      gte(position.closedAt, cutoff),
    ),
  )

  const baseline = computeBaselines(recentPositions)

  // ---- Grounding allowlists ------------------------------------------------
  const allowedPositionIds = [
    positionId,
    ...patternMatches.map(m => m.positionId),
  ]
  const allowedFindingIds = posFindings.map(f => f.id)

  return {
    userId,
    position: {
      id: pos.id,
      symbol: pos.symbol,
      side: pos.side as 'long' | 'short',
      instrumentType: pos.instrumentType as 'spot' | 'perp',
      entryAvg: Number(pos.entryAvgPrice),
      exitAvg: pos.exitAvgPrice != null ? Number(pos.exitAvgPrice) : 0,
      size: Number(pos.size),
      realizedPnl: Number(pos.realizedPnl),
      rMultiple: null,
      durationMinutes,
    },
    fills: fillsOut,
    thisPositionFindings,
    recentPatternMatches: patternMatches,
    userBaselines: baseline,
    allowedPositionIds,
    allowedFindingIds,
  }
}

// ---------------------------------------------------------------------------
// Baselines helper
// ---------------------------------------------------------------------------

type BaselineRow = {
  realizedPnl: string
  openedAt: Date
  closedAt: Date | null
}

function computeBaselines(rows: BaselineRow[]): { medianR: number; winRate: number; avgDurationMinutes: number } {
  if (rows.length === 0) {
    return { medianR: 0, winRate: 0, avgDurationMinutes: 0 }
  }

  const winCount = rows.filter(r => Number(r.realizedPnl) > 0).length
  const winRate = winCount / rows.length

  const durations = rows
    .filter(r => r.closedAt != null)
    .map(r => Math.round((r.closedAt!.getTime() - r.openedAt.getTime()) / 60_000))
  const avgDurationMinutes = durations.length === 0
    ? 0
    : durations.reduce((a, b) => a + b, 0) / durations.length

  return { medianR: 0, winRate, avgDurationMinutes }
}
