import { and, eq, gte, lte, isNull, sql } from 'drizzle-orm'
import type { DB } from '~/db/client'
import { position, finding, summaryRollup } from '~/db/schema/derivation'
import { digestRule } from '~/db/schema/narrator'
import { user as userTable } from '~/db/schema/auth'
import { DERIVATION_VERSION } from '~/derivation/version'
import type { DetectorId, FindingSeverity } from '~/domain/finding'
import type { SummaryRollupValue } from '~/domain/metrics'
import type { DigestFactBundle, JsonValue } from './types'

// ---------------------------------------------------------------------------
// ISO week helpers (no external deps)
// ---------------------------------------------------------------------------

/**
 * Parse an ISO week string like "2026-W17" into the Monday 00:00 UTC Date
 * and the Sunday 23:59:59.999 UTC Date for that week.
 */
export function parseIsoWeek(isoWeek: string): { monday: Date; sunday: Date } {
  const m = /^(\d{4})-W(\d{2})$/.exec(isoWeek)
  if (!m) throw new Error(`Invalid ISO week: ${isoWeek}`)
  const year = parseInt(m[1]!, 10)
  const week = parseInt(m[2]!, 10)

  // Jan 4th is always in week 1 per ISO 8601
  const jan4 = Date.UTC(year, 0, 4)
  // Day-of-week for Jan 4 (0=Sun, normalised to 1=Mon .. 7=Sun)
  const jan4Dow = new Date(jan4).getUTCDay() || 7 // 0→7
  // Monday of week 1
  const week1Mon = jan4 - (jan4Dow - 1) * 86_400_000
  const monday = new Date(week1Mon + (week - 1) * 7 * 86_400_000)
  const sunday = new Date(monday.getTime() + 7 * 86_400_000 - 1)
  return { monday, sunday }
}

/** Return the ISO week string for the week prior to the given one. */
function priorIsoWeek(isoWeek: string): string {
  const { monday } = parseIsoWeek(isoWeek)
  const priorMonday = new Date(monday.getTime() - 7 * 86_400_000)
  const year = priorMonday.getUTCFullYear()
  // ISO week number for a given date
  const jan4 = Date.UTC(year, 0, 4)
  const jan4Dow = new Date(jan4).getUTCDay() || 7
  const week1Mon = jan4 - (jan4Dow - 1) * 86_400_000
  const week = Math.round((priorMonday.getTime() - week1Mon) / (7 * 86_400_000)) + 1
  // Edge case: priorMonday may belong to previous year's week 52/53
  if (week < 1) {
    const prevYear = year - 1
    const pjan4 = Date.UTC(prevYear, 0, 4)
    const pjan4Dow = new Date(pjan4).getUTCDay() || 7
    const pWeek1Mon = pjan4 - (pjan4Dow - 1) * 86_400_000
    const pWeek = Math.round((priorMonday.getTime() - pWeek1Mon) / (7 * 86_400_000)) + 1
    return `${prevYear}-W${String(pWeek).padStart(2, '0')}`
  }
  return `${year}-W${String(week).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Summary helper — compute SummaryRollupValue from a set of position rows
// ---------------------------------------------------------------------------

type PositionRow = {
  realizedPnl: string
  notionalUsd: string
  openedAt: Date
  closedAt: Date | null
}

function computeWeeklySummary(rows: PositionRow[]): SummaryRollupValue {
  if (rows.length === 0) {
    return {
      totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0,
      winRate: 0, expectancy: 0, avgWin: 0, avgLoss: 0,
      profitFactor: null, maxDrawdown: 0, tradeCount: 0, medianPositionSizeUsd: 0,
    }
  }
  let grossProfit = 0
  let grossLoss = 0
  let winCount = 0
  let lossCount = 0
  const notionals: number[] = []

  for (const r of rows) {
    const pnl = Number(r.realizedPnl)
    if (pnl > 0) { grossProfit += pnl; winCount++ }
    else if (pnl < 0) { grossLoss += Math.abs(pnl); lossCount++ }
    notionals.push(Number(r.notionalUsd))
  }

  const tradeCount = rows.length
  const totalPnl = grossProfit - grossLoss
  const expectancy = tradeCount === 0 ? 0 : totalPnl / tradeCount
  const winRate = tradeCount === 0 ? 0 : winCount / tradeCount
  const avgWin = winCount === 0 ? 0 : grossProfit / winCount
  const avgLoss = lossCount === 0 ? 0 : grossLoss / lossCount
  const profitFactor = grossLoss === 0 ? null : grossProfit / grossLoss

  // Max drawdown: running equity curve
  notionals.sort((a, b) => a - b)
  const mid = Math.floor(notionals.length / 2)
  const medianPositionSizeUsd = notionals.length % 2 === 0
    ? ((notionals[mid - 1]! + notionals[mid]!) / 2)
    : notionals[mid]!

  // Simple max drawdown from equity curve
  let peak = 0
  let equity = 0
  let maxDrawdown = 0
  for (const r of rows) {
    equity += Number(r.realizedPnl)
    if (equity > peak) peak = equity
    const dd = peak - equity
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  return {
    totalPnl, grossProfit, grossLoss, totalFees: 0,
    winRate, expectancy, avgWin, avgLoss,
    profitFactor, maxDrawdown, tradeCount, medianPositionSizeUsd,
  }
}

// ---------------------------------------------------------------------------
// Severity ordering
// ---------------------------------------------------------------------------
const SEVERITY_ORDER: Record<FindingSeverity, number> = { critical: 2, warning: 1, info: 0 }

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function buildDigestFacts(
  db: DB,
  userId: string,
  isoWeek: string,
): Promise<DigestFactBundle> {
  const { monday, sunday } = parseIsoWeek(isoWeek)

  // ---- User ----------------------------------------------------------------
  const userRow = await db.query.user.findFirst({ where: eq(userTable.id, userId) })
  if (!userRow) throw new Error(`User not found: ${userId}`)

  // ---- Positions closed this week -----------------------------------------
  const weekPositions = await db.select().from(position).where(
    and(
      eq(position.userId, userId),
      eq(position.derivationVersion, DERIVATION_VERSION),
      gte(position.closedAt, monday),
      lte(position.closedAt, sunday),
    ),
  )

  // ---- Weekly summary (computed from positions) ----------------------------
  const summary = computeWeeklySummary(weekPositions)

  // ---- Prior week summary --------------------------------------------------
  const prior = priorIsoWeek(isoWeek)
  const { monday: priorMonday, sunday: priorSunday } = parseIsoWeek(prior)
  const priorPositions = await db.select().from(position).where(
    and(
      eq(position.userId, userId),
      eq(position.derivationVersion, DERIVATION_VERSION),
      gte(position.closedAt, priorMonday),
      lte(position.closedAt, priorSunday),
    ),
  )
  const priorSummary: SummaryRollupValue | null = priorPositions.length > 0
    ? computeWeeklySummary(priorPositions)
    : null

  // ---- Biggest win / loss --------------------------------------------------
  type PnlRow = typeof weekPositions[0]
  const wins = weekPositions.filter(p => Number(p.realizedPnl) > 0)
  const losses = weekPositions.filter(p => Number(p.realizedPnl) < 0)

  const topWin: PnlRow | undefined = wins.reduce<PnlRow | undefined>(
    (best, cur) => !best || Number(cur.realizedPnl) > Number(best.realizedPnl) ? cur : best,
    undefined,
  )
  const topLoss: PnlRow | undefined = losses.reduce<PnlRow | undefined>(
    (best, cur) => !best || Number(cur.realizedPnl) < Number(best.realizedPnl) ? cur : best,
    undefined,
  )

  const biggestWin = topWin
    ? { positionId: topWin.id, symbol: topWin.symbol, side: topWin.side, realizedPnl: Number(topWin.realizedPnl), rMultiple: null }
    : null

  const biggestLoss = topLoss
    ? { positionId: topLoss.id, symbol: topLoss.symbol, side: topLoss.side, realizedPnl: Number(topLoss.realizedPnl), rMultiple: null }
    : null

  // ---- Top finding in the week --------------------------------------------
  const findings = await db.select().from(finding).where(
    and(
      eq(finding.userId, userId),
      eq(finding.derivationVersion, DERIVATION_VERSION),
      gte(finding.periodStart, monday),
      lte(finding.periodEnd, sunday),
    ),
  )

  const topFindingRow = findings.reduce<typeof findings[0] | undefined>((best, cur) => {
    if (!best) return cur
    const cmp = SEVERITY_ORDER[cur.severity] - SEVERITY_ORDER[best.severity]
    if (cmp > 0) return cur
    if (cmp < 0) return best
    // Same severity: prefer more recent
    return cur.createdAt >= best.createdAt ? cur : best
  }, undefined)

  const topFinding = topFindingRow
    ? {
        findingId: topFindingRow.id,
        detectorId: topFindingRow.detectorId as DetectorId,
        severity: topFindingRow.severity as FindingSeverity,
        evidence: topFindingRow.evidence as Record<string, JsonValue>,
        referencedPositionIds: topFindingRow.referencedPositionIds,
      }
    : null

  // ---- Active rules --------------------------------------------------------
  const rules = await db.select().from(digestRule).where(
    and(eq(digestRule.userId, userId), isNull(digestRule.archivedAt)),
  )

  // For each rule, count how many week positions have a finding with that detectorId
  const weekPositionIds = new Set(weekPositions.map(p => p.id))
  const weekFindings = await db.select().from(finding).where(
    and(
      eq(finding.userId, userId),
      eq(finding.derivationVersion, DERIVATION_VERSION),
    ),
  )
  // Build a map: detectorId → set of position IDs with a finding of that detector in this week
  const detectorToWeekPositions = new Map<string, Set<string>>()
  for (const f of weekFindings) {
    for (const posId of f.referencedPositionIds) {
      if (weekPositionIds.has(posId)) {
        if (!detectorToWeekPositions.has(f.detectorId)) {
          detectorToWeekPositions.set(f.detectorId, new Set())
        }
        detectorToWeekPositions.get(f.detectorId)!.add(posId)
      }
    }
  }

  const activeRules = rules.map(r => ({
    ruleId: r.id,
    detectorId: r.detectorId as DetectorId,
    ruleText: r.ruleText,
    violationsThisWeek: detectorToWeekPositions.get(r.detectorId)?.size ?? 0,
  }))

  // ---- Grounding allowlists ------------------------------------------------
  const allowedPositionIdsSet = new Set<string>()
  if (biggestWin) allowedPositionIdsSet.add(biggestWin.positionId)
  if (biggestLoss) allowedPositionIdsSet.add(biggestLoss.positionId)
  if (topFinding) {
    for (const id of topFinding.referencedPositionIds) allowedPositionIdsSet.add(id)
  }
  for (const [, posIds] of detectorToWeekPositions) {
    for (const id of posIds) allowedPositionIdsSet.add(id)
  }

  const allowedFindingIdsSet = new Set<string>()
  if (topFinding) allowedFindingIdsSet.add(topFinding.findingId)

  return {
    user: { id: userRow.id, email: userRow.email },
    isoWeek,
    period: {
      start: monday.toISOString(),
      end: sunday.toISOString(),
    },
    summary,
    priorSummary,
    biggestWin,
    biggestLoss,
    topFinding,
    activeRules,
    allowedPositionIds: [...allowedPositionIdsSet],
    allowedFindingIds: [...allowedFindingIdsSet],
  }
}
