import { describe, it, expect, vi } from 'vitest'
import { buildDigestFacts, parseIsoWeek } from '~/narrator/facts/digestFacts'
import { buildCoachFacts } from '~/narrator/facts/coachFacts'

// ---------------------------------------------------------------------------
// Stub out env + derivation version so there's no real DB connection
// ---------------------------------------------------------------------------
vi.mock('~/lib/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://x:x@localhost/test',
    BETTER_AUTH_SECRET: 'aaaabbbbccccddddeeeeffffgggghhhhiiii',
    BETTER_AUTH_URL: 'http://localhost:3000',
    GOOGLE_CLIENT_ID: 'test',
    GOOGLE_CLIENT_SECRET: 'test',
    ANTHROPIC_API_KEY: 'test',
    AI_ENABLED: 'on',
  },
}))

vi.mock('~/derivation/version', () => ({ DERIVATION_VERSION: 1 }))

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const USER_ID = 'user_abc'
const WEEK = '2026-W17' // Mon 2026-04-20 → Sun 2026-04-26

const MON = new Date('2026-04-20T00:00:00.000Z')
const TUE = new Date('2026-04-21T10:00:00.000Z')
const WED = new Date('2026-04-22T10:00:00.000Z')
const THU = new Date('2026-04-23T10:00:00.000Z')
const SUN = new Date('2026-04-26T23:59:59.999Z')

// Three positions closed in week 17: 2 wins + 1 loss
const weekPositions = [
  {
    id: 'pos_win_big', userId: USER_ID, symbol: 'BTC', side: 'long',
    instrumentType: 'perp', entryAvgPrice: '40000', exitAvgPrice: '41000',
    size: '0.1', notionalUsd: '4000', maxNotionalUsd: '4000',
    realizedPnl: '150', totalFees: '0', fundingPnl: '0',
    wasLiquidated: false, needsReview: false,
    openedAt: TUE, closedAt: WED, derivationVersion: 1, createdAt: MON,
  },
  {
    id: 'pos_win_small', userId: USER_ID, symbol: 'ETH', side: 'short',
    instrumentType: 'perp', entryAvgPrice: '2000', exitAvgPrice: '1950',
    size: '1', notionalUsd: '2000', maxNotionalUsd: '2000',
    realizedPnl: '50', totalFees: '0', fundingPnl: '0',
    wasLiquidated: false, needsReview: false,
    openedAt: TUE, closedAt: TUE, derivationVersion: 1, createdAt: MON,
  },
  {
    id: 'pos_loss', userId: USER_ID, symbol: 'SOL', side: 'long',
    instrumentType: 'spot', entryAvgPrice: '100', exitAvgPrice: '80',
    size: '5', notionalUsd: '500', maxNotionalUsd: '500',
    realizedPnl: '-80', totalFees: '0', fundingPnl: '0',
    wasLiquidated: false, needsReview: false,
    openedAt: WED, closedAt: THU, derivationVersion: 1, createdAt: MON,
  },
]

const weekFinding = {
  id: 'finding_001',
  userId: USER_ID,
  detectorId: 'revenge_trading',
  severity: 'warning',
  title: 'Revenge trading detected',
  bodyMarkdown: 'You traded after a loss.',
  evidence: { thresholdMinutes: 30, instances: [] },
  referencedPositionIds: ['pos_loss'],
  periodStart: MON,
  periodEnd: SUN,
  derivationVersion: 1,
  createdAt: WED,
}

const digestRule1 = {
  id: 'rule_001',
  userId: USER_ID,
  detectorId: 'revenge_trading',
  ruleText: 'No revenge trades within 1 hour of a loss.',
  createdAt: MON,
  archivedAt: null,
}

// ---------------------------------------------------------------------------
// Coach fixture data
// ---------------------------------------------------------------------------
const POSITION_ID = 'coach_pos_001'
const OPENED_AT = new Date('2026-04-21T09:00:00.000Z')
const CLOSED_AT = new Date('2026-04-21T11:30:00.000Z') // 150 minutes later

const coachPosition = {
  id: POSITION_ID, userId: USER_ID, symbol: 'BTC', side: 'long',
  instrumentType: 'perp', entryAvgPrice: '40000', exitAvgPrice: '41000',
  size: '0.1', notionalUsd: '4000', maxNotionalUsd: '4000',
  realizedPnl: '100', totalFees: '4', fundingPnl: '0',
  wasLiquidated: false, needsReview: false,
  openedAt: OPENED_AT, closedAt: CLOSED_AT, derivationVersion: 1, createdAt: OPENED_AT,
}

const positionFills = [
  { id: 'pf_1', positionId: POSITION_ID, fillId: 'fill_1', role: 'open', derivationVersion: 1 },
  { id: 'pf_2', positionId: POSITION_ID, fillId: 'fill_2', role: 'add', derivationVersion: 1 },
  { id: 'pf_3', positionId: POSITION_ID, fillId: 'fill_3', role: 'close', derivationVersion: 1 },
]

const fills = [
  {
    id: 'fill_1', userId: USER_ID, exchange: 'hl', symbol: 'BTC',
    instrumentType: 'perp', side: 'buy', price: '40000', size: '0.05',
    fee: '1', feeCurrency: 'USDC', externalId: 'e1',
    executedAt: new Date('2026-04-21T09:00:00.000Z'),
    normalizerHint: null, createdAt: OPENED_AT, rawImportRowId: null,
  },
  {
    id: 'fill_2', userId: USER_ID, exchange: 'hl', symbol: 'BTC',
    instrumentType: 'perp', side: 'buy', price: '40200', size: '0.05',
    fee: '1.5', feeCurrency: 'USDC', externalId: 'e2',
    executedAt: new Date('2026-04-21T10:00:00.000Z'),
    normalizerHint: null, createdAt: OPENED_AT, rawImportRowId: null,
  },
  {
    id: 'fill_3', userId: USER_ID, exchange: 'hl', symbol: 'BTC',
    instrumentType: 'perp', side: 'sell', price: '41000', size: '0.1',
    fee: '2', feeCurrency: 'USDC', externalId: 'e3',
    executedAt: new Date('2026-04-21T11:30:00.000Z'),
    normalizerHint: null, createdAt: CLOSED_AT, rawImportRowId: null,
  },
]

const coachFinding = {
  id: 'finding_coach_001',
  userId: USER_ID,
  detectorId: 'oversized_positions',
  severity: 'warning',
  title: 'Oversized',
  bodyMarkdown: 'Too large.',
  evidence: { ratio: 2.5 },
  referencedPositionIds: [POSITION_ID],
  periodStart: OPENED_AT,
  periodEnd: CLOSED_AT,
  derivationVersion: 1,
  createdAt: OPENED_AT,
}

// ---------------------------------------------------------------------------
// DB mock factory
//
// The actual functions call db.select().from(table).where(cond) and
// db.query.X.findFirst(opts).  Both return Promises.
//
// For select chains, we use a call-count approach: each successive call to
// .where() returns the next item in `selectSequence`.  The sequence must
// match the exact order that the function under test fires its queries.
//
// For query.findFirst, we key by table name string (proxy traps the property).
// ---------------------------------------------------------------------------

function makeDb(opts: {
  /** Results returned in the order that db.select()...where() is called. */
  selectSequence: unknown[][]
  /** Results returned by db.query.<tableName>.findFirst() */
  queryResults?: Record<string, unknown>
}): import('~/db/client').DB {
  let callIdx = 0
  const { selectSequence, queryResults = {} } = opts

  // Mutable chain — .from() sets the context, .where() consumes the next slot
  const chain = {
    from: (_table: unknown) => chain,
    where: (_cond?: unknown) => {
      const result = selectSequence[callIdx++] ?? []
      return Promise.resolve(result)
    },
  }

  // Proxy that intercepts db.query.<tableName>.findFirst
  const queryProxy = new Proxy({} as Record<string, { findFirst: (o?: unknown) => Promise<unknown> }>, {
    get(_target, tableName: string) {
      return {
        findFirst: (_opts?: unknown) =>
          Promise.resolve(queryResults[tableName] ?? null),
      }
    },
  })

  return {
    select: () => chain,
    query: queryProxy,
  } as unknown as import('~/db/client').DB
}

// ---------------------------------------------------------------------------
// parseIsoWeek unit tests (pure, no DB)
// ---------------------------------------------------------------------------

describe('parseIsoWeek', () => {
  it('parses 2026-W17 as Apr 20 – Apr 26 UTC', () => {
    const { monday, sunday } = parseIsoWeek('2026-W17')
    expect(monday.toISOString()).toBe('2026-04-20T00:00:00.000Z')
    expect(sunday.toISOString()).toBe('2026-04-26T23:59:59.999Z')
  })

  it('monday is always a Monday', () => {
    const { monday } = parseIsoWeek('2026-W01')
    expect(monday.getUTCDay()).toBe(1)
  })

  it('throws on invalid input', () => {
    expect(() => parseIsoWeek('2026-17')).toThrow('Invalid ISO week')
  })
})

// ---------------------------------------------------------------------------
// digestFacts — query call order in buildDigestFacts:
//   1. weekPositions  (position, current week)
//   2. priorPositions (position, prior week)
//   3. findings       (finding, current week)
//   4. weekFindings   (finding, for rule violations)
//   5. rules          (digest_rule)
// ---------------------------------------------------------------------------

describe('digestFacts', () => {
  function makeDigestDb(overrides: { priorPositions?: unknown[]; findings?: unknown[] } = {}) {
    // Query order in buildDigestFacts:
    //   1. position (week)
    //   2. position (prior week)
    //   3. finding  (for topFinding, filtered by periodStart/periodEnd)
    //   4. digest_rule (active rules)
    //   5. finding  (weekFindings, for rule violation counting)
    return makeDb({
      selectSequence: [
        weekPositions,                                // 1. week positions
        overrides.priorPositions ?? [],               // 2. prior week positions
        overrides.findings ?? [weekFinding],          // 3. findings (topFinding)
        [digestRule1],                                // 4. active rules
        overrides.findings ?? [weekFinding],          // 5. weekFindings (rule violations)
      ],
      queryResults: {
        user: { id: USER_ID, email: 'test@example.com' },
      },
    })
  }

  it('identifies biggestWin and biggestLoss correctly', async () => {
    const db = makeDigestDb()
    const bundle = await buildDigestFacts(db, USER_ID, WEEK)

    expect(bundle.biggestWin?.positionId).toBe('pos_win_big')
    expect(bundle.biggestWin?.realizedPnl).toBe(150)
    expect(bundle.biggestLoss?.positionId).toBe('pos_loss')
    expect(bundle.biggestLoss?.realizedPnl).toBe(-80)
  })

  it('surfaces the topFinding', async () => {
    const db = makeDigestDb()
    const bundle = await buildDigestFacts(db, USER_ID, WEEK)

    expect(bundle.topFinding?.findingId).toBe('finding_001')
    expect(bundle.topFinding?.detectorId).toBe('revenge_trading')
    expect(bundle.topFinding?.severity).toBe('warning')
  })

  it('returns activeRules with violationsThisWeek count', async () => {
    const db = makeDigestDb()
    const bundle = await buildDigestFacts(db, USER_ID, WEEK)

    expect(bundle.activeRules).toHaveLength(1)
    expect(bundle.activeRules[0]!.ruleId).toBe('rule_001')
    expect(bundle.activeRules[0]!.detectorId).toBe('revenge_trading')
    // 'pos_loss' is in weekPositions and referenced by finding with detectorId 'revenge_trading'
    expect(bundle.activeRules[0]!.violationsThisWeek).toBe(1)
  })

  it('computes weekly summary with correct tradeCount and PnL', async () => {
    const db = makeDigestDb({ findings: [] })
    const bundle = await buildDigestFacts(db, USER_ID, WEEK)

    expect(bundle.summary.tradeCount).toBe(3)
    expect(bundle.summary.totalPnl).toBeCloseTo(120, 2)  // 150 + 50 - 80
    expect(bundle.summary.winRate).toBeCloseTo(2 / 3, 4)
  })

  it('sets priorSummary to null when no prior positions exist', async () => {
    const db = makeDigestDb({ priorPositions: [] })
    const bundle = await buildDigestFacts(db, USER_ID, WEEK)
    expect(bundle.priorSummary).toBeNull()
  })

  it('populates allowedPositionIds with referenced positions', async () => {
    const db = makeDigestDb()
    const bundle = await buildDigestFacts(db, USER_ID, WEEK)

    expect(bundle.allowedPositionIds).toContain('pos_win_big')
    expect(bundle.allowedPositionIds).toContain('pos_loss')
    expect(bundle.allowedFindingIds).toContain('finding_001')
  })

  it('throws when user is not found', async () => {
    const db = makeDb({
      selectSequence: [weekPositions, [], [], [digestRule1], []],
      queryResults: { user: null },
    })
    await expect(buildDigestFacts(db, USER_ID, WEEK)).rejects.toThrow('User not found')
  })

  it('period.start matches isoWeek Monday UTC', async () => {
    const db = makeDigestDb()
    const bundle = await buildDigestFacts(db, USER_ID, WEEK)
    expect(bundle.period.start).toBe('2026-04-20T00:00:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// coachFacts — query call order in buildCoachFacts:
//   1. positionFills  (position_fill)
//   2. fills          (fill, inArray)
//   3. posFindings    (finding, for this position)
//   4. recentFindings (finding, for pattern matches)
//   5. recentPositions (position, last 90d)
// ---------------------------------------------------------------------------

describe('coachFacts', () => {
  function makeCoachDb(overrides: {
    positionFound?: boolean
    findings?: unknown[]
  } = {}) {
    const { positionFound = true, findings = [coachFinding] } = overrides

    return makeDb({
      selectSequence: [
        positionFills,   // 1. position_fill
        fills,           // 2. fill
        findings,        // 3. posFindings (for this position)
        [],              // 4. recentFindings (pattern matches) — empty for simplicity
        weekPositions,   // 5. recentPositions (last 90d baselines)
      ],
      queryResults: {
        position: positionFound ? coachPosition : null,
      },
    })
  }

  it('returns all three fills in chronological order', async () => {
    const db = makeCoachDb()
    const bundle = await buildCoachFacts(db, USER_ID, POSITION_ID)

    expect(bundle.fills).toHaveLength(3)
    expect(bundle.fills[0]!.id).toBe('fill_1')
    expect(bundle.fills[1]!.id).toBe('fill_2')
    expect(bundle.fills[2]!.id).toBe('fill_3')
    expect(bundle.fills[0]!.executedAt < bundle.fills[1]!.executedAt).toBe(true)
  })

  it('computes durationMinutes correctly (150 min)', async () => {
    const db = makeCoachDb()
    const bundle = await buildCoachFacts(db, USER_ID, POSITION_ID)
    expect(bundle.position.durationMinutes).toBe(150)
  })

  it('surfaces thisPositionFindings with 1 entry', async () => {
    const db = makeCoachDb()
    const bundle = await buildCoachFacts(db, USER_ID, POSITION_ID)

    expect(bundle.thisPositionFindings).toHaveLength(1)
    expect(bundle.thisPositionFindings[0]!.findingId).toBe('finding_coach_001')
    expect(bundle.thisPositionFindings[0]!.detectorId).toBe('oversized_positions')
    expect(bundle.thisPositionFindings[0]!.severity).toBe('warning')
  })

  it('includes the position in allowedPositionIds', async () => {
    const db = makeCoachDb()
    const bundle = await buildCoachFacts(db, USER_ID, POSITION_ID)

    expect(bundle.allowedPositionIds).toContain(POSITION_ID)
    expect(bundle.allowedFindingIds).toContain('finding_coach_001')
  })

  it('maps fill sides correctly', async () => {
    const db = makeCoachDb()
    const bundle = await buildCoachFacts(db, USER_ID, POSITION_ID)

    const sides = bundle.fills.map(f => f.side)
    expect(sides).toEqual(['buy', 'buy', 'sell'])
  })

  it('throws when position is not found', async () => {
    const db = makeCoachDb({ positionFound: false })
    await expect(buildCoachFacts(db, USER_ID, 'nonexistent')).rejects.toThrow('Position not found')
  })

  it('computes userBaselines from recent positions', async () => {
    const db = makeCoachDb()
    const bundle = await buildCoachFacts(db, USER_ID, POSITION_ID)

    // weekPositions has 2 wins, 1 loss → winRate ≈ 0.667
    expect(bundle.userBaselines.winRate).toBeCloseTo(2 / 3, 2)
    expect(bundle.userBaselines.medianR).toBe(0)
    expect(bundle.userBaselines.avgDurationMinutes).toBeGreaterThan(0)
  })
})
