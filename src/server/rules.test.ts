import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// H-04 regression: getRuleViolationsThisWeek must only count findings at the
// current DERIVATION_VERSION. Stale findings at prior versions must be filtered
// out so counts don't double after a version bump.
//
// Strategy: stub out env / auth / tanstack-start, and stub drizzle-orm's `eq`
// and `and` helpers so our DB mock can introspect the WHERE clause and apply
// the derivationVersion filter against seeded rows.
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

// Pin DERIVATION_VERSION to a known value for the test
const CURRENT_VERSION = 4
vi.mock('~/derivation/version', () => ({ DERIVATION_VERSION: CURRENT_VERSION }))

// Auth stubs
const mockSession = vi.fn()
vi.mock('~/auth/server', () => ({
  auth: { api: { getSession: () => mockSession() } },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => ({ headers: new Headers() }),
}))

// createServerFn stub — expose the handler as a directly-callable function
vi.mock('@tanstack/react-start', () => ({
  createServerFn: (_opts: { method: string }) => ({
    inputValidator: (fn: (d: unknown) => unknown) => ({
      handler: (handlerFn: (ctx: { data: unknown }) => unknown) => {
        return async (rawData: unknown) => {
          const data = fn(rawData)
          return handlerFn({ data })
        }
      },
    }),
  }),
}))

// ---------------------------------------------------------------------------
// Stub drizzle-orm's eq / and so we can introspect the WHERE clause.
// Each `eq(col, val)` becomes a tagged predicate we can match against a row.
// ---------------------------------------------------------------------------

type Pred = { kind: 'eq'; col: unknown; val: unknown } | { kind: 'and'; preds: Pred[] }

vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')
  return {
    ...actual,
    eq: (col: unknown, val: unknown): Pred => ({ kind: 'eq', col, val }),
    and: (...preds: Pred[]): Pred => ({ kind: 'and', preds }),
  }
})

// Evaluate a stubbed predicate against a row, using the passed column->key map
// to resolve which row property a given Drizzle column reference corresponds to.
function evalPred(p: Pred, row: Record<string, unknown>, colMap: Map<unknown, string>): boolean {
  if (p.kind === 'and') return p.preds.every(sub => evalPred(sub, row, colMap))
  // kind === 'eq'
  const key = colMap.get(p.col)
  if (!key) return true // unknown column — ignore
  return row[key] === p.val
}

// ---------------------------------------------------------------------------
// DB mock: routes select().from(table).where(pred) through our predicate eval
// when `table` matches the `finding` schema import. Other tables (e.g.
// `digestRule`) are served from a fixed rule-lookup sequence.
// ---------------------------------------------------------------------------

type DbMockOpts = {
  findingRows: Array<Record<string, unknown>>
  ruleRow: Record<string, unknown> | null
  findingTable: unknown
  findingColMap: Map<unknown, string>
}

function makeDbMock(opts: DbMockOpts) {
  return {
    select: (fields?: Record<string, unknown>) => {
      // We decide which result set to return once `.from(table)` is called.
      let currentTable: unknown = null
      let currentWhere: Pred | null = null

      function project(rows: Array<Record<string, unknown>>): unknown[] {
        if (!fields || typeof fields !== 'object') return rows
        // Map each row: for each key in `fields`, look up the column in colMap
        // and read the corresponding property from the row.
        return rows.map(r => {
          const out: Record<string, unknown> = {}
          for (const [alias, colRef] of Object.entries(fields)) {
            const srcKey = opts.findingColMap.get(colRef)
            if (srcKey) out[alias] = r[srcKey]
          }
          return out
        })
      }

      function resolve(): unknown[] {
        if (currentTable === opts.findingTable) {
          const filtered = currentWhere
            ? opts.findingRows.filter(r => evalPred(currentWhere!, r, opts.findingColMap))
            : opts.findingRows
          return project(filtered)
        }
        // Anything else (digestRule ownership lookup) returns the rule row.
        return opts.ruleRow ? [opts.ruleRow] : []
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function makeChain(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p: any = new Promise((res) => res(resolve()))
        p.from = (t: unknown) => { currentTable = t; return makeChain() }
        p.where = (c: Pred) => { currentWhere = c; return makeChain() }
        p.limit = (_n: number) => new Promise((res) => res(resolve()))
        p.orderBy = (_col: unknown) => new Promise((res) => res(resolve()))
        return p
      }

      return makeChain()
    },
    insert: (_t: unknown) => ({ values: (_v: unknown) => Promise.resolve() }),
    update: (_t: unknown) => ({
      set: (_p: unknown) => ({ where: (_c: unknown) => Promise.resolve() }),
    }),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbRef: any

vi.mock('~/db/client', () => ({
  get db() { return dbRef },
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const USER_ID = 'user_h04'
const DETECTOR_ID = 'det_overleverage'
const RULE_ID = 'rule_abc'

function normalSession() {
  mockSession.mockResolvedValue({
    user: { id: USER_ID, isDemo: false, email: 'test@example.com' },
  })
}

describe('getRuleViolationsThisWeek — H-04 DERIVATION_VERSION filter', () => {
  beforeEach(() => { vi.resetModules() })

  it('only counts findings at the current DERIVATION_VERSION', async () => {
    normalSession()

    // Import the real `finding` schema so our mock db can match column references
    // produced by rules.ts when it calls `eq(finding.<col>, ...)`.
    const { finding } = await import('~/db/schema/derivation')

    const findingColMap = new Map<unknown, string>([
      [finding.userId, 'userId'],
      [finding.detectorId, 'detectorId'],
      [finding.derivationVersion, 'derivationVersion'],
      [finding.referencedPositionIds, 'referencedPositionIds'],
      [finding.periodStart, 'periodStart'],
    ])

    // `periodStart` is mid-current-ISO-week, so both findings land in the range.
    // Pick a date near "now" at UTC midday so day arithmetic in currentWeekRange
    // has margin on either side.
    const now = new Date()
    const dayOfWeek = now.getUTCDay() || 7 // Mon=1..Sun=7
    const weekStart = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOfWeek + 1,
      12, 0, 0, 0,
    ))

    const findingRows = [
      {
        id: 'f_stale',
        userId: USER_ID,
        detectorId: DETECTOR_ID,
        referencedPositionIds: ['pos_stale'],
        periodStart: weekStart,
        derivationVersion: CURRENT_VERSION - 1,
      },
      {
        id: 'f_current',
        userId: USER_ID,
        detectorId: DETECTOR_ID,
        referencedPositionIds: ['pos_current'],
        periodStart: weekStart,
        derivationVersion: CURRENT_VERSION,
      },
    ]

    const ruleRow = {
      id: RULE_ID,
      userId: USER_ID,
      detectorId: DETECTOR_ID,
      ruleText: 'size <= 5%',
      createdAt: new Date(),
      archivedAt: null,
    }

    dbRef = makeDbMock({
      findingRows,
      ruleRow,
      findingTable: finding,
      findingColMap,
    })

    const { getRuleViolationsThisWeek } = await import('~/server/rules')
    const result = await (getRuleViolationsThisWeek as unknown as (
      d: unknown,
    ) => Promise<{ violations: number; ruleId: string }>)({ ruleId: RULE_ID })

    expect(result.ruleId).toBe(RULE_ID)
    // Only the current-version finding should contribute — the stale v3 row
    // must be filtered out by the new WHERE clause.
    expect(result.violations).toBe(1)
  })
})
