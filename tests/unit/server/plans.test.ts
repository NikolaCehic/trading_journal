import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { DemoReadonlyError } from '~/auth/assertNotDemo'

// ---------------------------------------------------------------------------
// Mock env so no real DB / auth is initialised
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
// Stub auth so we can control the session
// ---------------------------------------------------------------------------
const mockSession = vi.fn()
vi.mock('~/auth/server', () => ({
  auth: {
    api: {
      getSession: () => mockSession(),
    },
  },
}))

// ---------------------------------------------------------------------------
// Stub @tanstack/react-start/server (getRequest is a no-op in tests)
// ---------------------------------------------------------------------------
vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => ({ headers: new Headers() }),
}))

// ---------------------------------------------------------------------------
// Stub @tanstack/react-start createServerFn so handlers can be called directly
// ---------------------------------------------------------------------------
vi.mock('@tanstack/react-start', () => ({
  createServerFn: (_opts: { method: string }) => ({
    inputValidator: (fn: (d: unknown) => unknown) => ({
      handler: (handlerFn: (ctx: { data: unknown }) => unknown) => {
        // Return a callable that validates then runs the handler
        return async (rawData: unknown) => {
          const data = fn(rawData)
          return handlerFn({ data })
        }
      },
    }),
  }),
}))

// ---------------------------------------------------------------------------
// DB mock helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// A richer DB mock that supports the multi-query patterns in our handlers
// The key insight: each db.select() call consumes the next item from the sequence
// ---------------------------------------------------------------------------

function makeRichDb(opts: {
  selectSequences: unknown[][]
  insertOk?: boolean
  updateOk?: boolean
}) {
  let seqIdx = 0
  const { selectSequences } = opts

  const consumeNext = () => selectSequences[seqIdx++] ?? []

  return {
    select: (_fields?: unknown) => {
      // Capture result at select() time so each select() call gets the next slot
      const result = consumeNext()

      // Build a thenable chain. Every terminal call (where, orderBy, limit)
      // resolves with `result`. The chain itself is also a thenable so that
      // `await db.select().from(t).where(c)` works directly.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function makeChain(): Record<string, unknown> & Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = Promise.resolve(result as unknown[]) as any
        p.from = (_t: unknown) => makeChain()
        p.where = (_c?: unknown) => makeChain()
        p.orderBy = (_col: unknown) => Promise.resolve(result as unknown[])
        p.limit = (_n: number) => Promise.resolve(result as unknown[])
        return p
      }

      return makeChain()
    },
    insert: (_table: unknown) => ({
      values: (_vals: unknown) => Promise.resolve(),
    }),
    update: (_table: unknown) => ({
      set: (_patch: unknown) => ({
        where: (_cond: unknown) => Promise.resolve(),
      }),
    }),
  }
}

// ---------------------------------------------------------------------------
// Mock db/client with a replaceable reference
// ---------------------------------------------------------------------------

let dbRef: ReturnType<typeof makeRichDb>

vi.mock('~/db/client', () => ({
  get db() {
    return dbRef
  },
}))

// ---------------------------------------------------------------------------
// Import the fns under test (after mocks are in place)
// ---------------------------------------------------------------------------

const USER_ID = 'user_abc123'

// Helper: set up a normal (non-demo) session
function normalSession() {
  mockSession.mockResolvedValue({
    user: { id: USER_ID, isDemo: false, email: 'test@example.com' },
  })
}

// Helper: set up a demo session
function demoSession() {
  mockSession.mockResolvedValue({
    user: { id: USER_ID, isDemo: true, email: 'demo@example.com' },
  })
}

// Sample plan row returned by DB
const samplePlanRow = {
  id: 'plan_abc',
  userId: USER_ID,
  symbol: 'BTC',
  intendedSide: 'long' as const,
  entryPrice: '40000',
  stopPrice: '38000',
  targetPrice: '44000',
  plannedSize: '0.1',
  rationale: 'Test plan',
  createdAt: new Date('2026-04-20T00:00:00.000Z'),
  archivedAt: null,
}

// ---------------------------------------------------------------------------
// createPlan input validator — pure tests (no DB needed)
// ---------------------------------------------------------------------------

describe('createPlan input validator', () => {
  const schema = z.object({
    symbol: z.string().min(1).max(64),
    intendedSide: z.enum(['long', 'short']),
    entryPrice: z.number().positive().optional(),
    stopPrice: z.number().positive().optional(),
    targetPrice: z.number().positive().optional(),
    plannedSize: z.number().positive().optional(),
    rationale: z.string().max(4000).optional(),
  })

  it('accepts minimal valid input', () => {
    expect(() => schema.parse({ symbol: 'BTC', intendedSide: 'long' })).not.toThrow()
  })

  it('rejects empty symbol', () => {
    expect(() => schema.parse({ symbol: '', intendedSide: 'long' })).toThrow()
  })

  it('rejects invalid intendedSide', () => {
    expect(() => schema.parse({ symbol: 'BTC', intendedSide: 'neutral' })).toThrow()
  })

  it('rejects negative prices', () => {
    expect(() =>
      schema.parse({ symbol: 'BTC', intendedSide: 'long', entryPrice: -1 }),
    ).toThrow()
  })

  it('rejects rationale over 4000 chars', () => {
    expect(() =>
      schema.parse({ symbol: 'BTC', intendedSide: 'long', rationale: 'x'.repeat(4001) }),
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// updatePlan input validator
// ---------------------------------------------------------------------------

describe('updatePlan input validator', () => {
  const schema = z.object({
    id: z.string().min(1),
    symbol: z.string().min(1).max(64).optional(),
    intendedSide: z.enum(['long', 'short']).optional(),
    entryPrice: z.number().positive().nullable().optional(),
    stopPrice: z.number().positive().nullable().optional(),
    targetPrice: z.number().positive().nullable().optional(),
    plannedSize: z.number().positive().nullable().optional(),
    rationale: z.string().max(4000).nullable().optional(),
  })

  it('accepts id-only (noop) input', () => {
    expect(() => schema.parse({ id: 'plan_xyz' })).not.toThrow()
  })

  it('rejects missing id', () => {
    expect(() => schema.parse({ symbol: 'ETH', intendedSide: 'short' })).toThrow()
  })

  it('allows nullable prices for clearing', () => {
    expect(() =>
      schema.parse({ id: 'plan_xyz', entryPrice: null }),
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Handler-level tests using import() so mocks are applied first
// ---------------------------------------------------------------------------

describe('createPlan handler', () => {
  beforeEach(() => {
    dbRef = makeRichDb({ selectSequences: [] })
  })

  it('returns an id prefixed with plan_ on success', async () => {
    normalSession()
    const { createPlan } = await import('~/server/plans')
    const result = await (createPlan as unknown as (d: unknown) => Promise<{ id: string }>)({
      symbol: 'BTC',
      intendedSide: 'long',
      entryPrice: 40000,
    })
    expect(result.id).toMatch(/^plan_/)
  })

  it('throws DemoReadonlyError for demo users', async () => {
    demoSession()
    const { createPlan } = await import('~/server/plans')
    await expect(
      (createPlan as unknown as (d: unknown) => Promise<unknown>)({
        symbol: 'BTC',
        intendedSide: 'long',
      }),
    ).rejects.toThrow(DemoReadonlyError)
  })
})

describe('listPlans handler', () => {
  it('excludes archived plans by default', async () => {
    normalSession()
    // DB returns 0 rows (simulating all filtered out) with empty linked positions
    dbRef = makeRichDb({ selectSequences: [[], []] })
    const { listPlans } = await import('~/server/plans')
    const result = await (listPlans as unknown as (d: unknown) => Promise<unknown[]>)({})
    expect(result).toEqual([])
  })

  it('maps plan rows to TradePlan shape with linkedPositionCount', async () => {
    normalSession()
    // First call: plan rows; second call: linked positions
    dbRef = makeRichDb({
      selectSequences: [
        [samplePlanRow],
        [{ planId: 'plan_abc' }], // 1 linked position
      ],
    })
    const { listPlans } = await import('~/server/plans')
    const result = await (listPlans as unknown as (d: unknown) => Promise<{ linkedPositionCount: number; symbol: string }[]>)({})
    expect(result).toHaveLength(1)
    expect(result[0]!.symbol).toBe('BTC')
    expect(result[0]!.linkedPositionCount).toBe(1)
  })

  it('filters by symbol when provided', async () => {
    normalSession()
    dbRef = makeRichDb({ selectSequences: [[samplePlanRow], []] })
    const { listPlans } = await import('~/server/plans')
    const result = await (listPlans as unknown as (d: unknown) => Promise<{ symbol: string }[]>)({ symbol: 'BTC' })
    expect(result[0]!.symbol).toBe('BTC')
  })
})

describe('getPlan handler', () => {
  it('returns plan with linkedPositionIds array', async () => {
    normalSession()
    // First call: plan row; second call: linked position ids
    dbRef = makeRichDb({
      selectSequences: [
        [samplePlanRow],
        [{ id: 'pos_001' }, { id: 'pos_002' }],
      ],
    })
    const { getPlan } = await import('~/server/plans')
    const result = await (getPlan as unknown as (d: unknown) => Promise<{ linkedPositionIds: string[]; linkedPositionCount: number }>)({
      id: 'plan_abc',
    })
    expect(result.linkedPositionIds).toEqual(['pos_001', 'pos_002'])
    expect(result.linkedPositionCount).toBe(2)
  })

  it('throws if plan not found', async () => {
    normalSession()
    dbRef = makeRichDb({ selectSequences: [[]] })
    const { getPlan } = await import('~/server/plans')
    await expect(
      (getPlan as unknown as (d: unknown) => Promise<unknown>)({ id: 'plan_nonexistent' }),
    ).rejects.toThrow('Plan not found')
  })
})

describe('updatePlan handler', () => {
  it('returns noop:true when no fields provided', async () => {
    normalSession()
    dbRef = makeRichDb({ selectSequences: [] })
    const { updatePlan } = await import('~/server/plans')
    const result = await (updatePlan as unknown as (d: unknown) => Promise<{ ok: boolean; noop?: boolean }>)({
      id: 'plan_abc',
    })
    expect(result.ok).toBe(true)
    expect(result.noop).toBe(true)
  })

  it('returns ok:true when fields are patched', async () => {
    normalSession()
    dbRef = makeRichDb({ selectSequences: [] })
    const { updatePlan } = await import('~/server/plans')
    const result = await (updatePlan as unknown as (d: unknown) => Promise<{ ok: boolean; noop?: boolean }>)({
      id: 'plan_abc',
      symbol: 'ETH',
      entryPrice: 2000,
    })
    expect(result.ok).toBe(true)
    expect(result.noop).toBeUndefined()
  })

  it('throws DemoReadonlyError for demo users', async () => {
    demoSession()
    dbRef = makeRichDb({ selectSequences: [] })
    const { updatePlan } = await import('~/server/plans')
    await expect(
      (updatePlan as unknown as (d: unknown) => Promise<unknown>)({ id: 'plan_abc', symbol: 'SOL' }),
    ).rejects.toThrow(DemoReadonlyError)
  })
})

describe('archivePlan handler', () => {
  it('sets archived=true', async () => {
    normalSession()
    dbRef = makeRichDb({ selectSequences: [] })
    const { archivePlan } = await import('~/server/plans')
    const result = await (archivePlan as unknown as (d: unknown) => Promise<{ ok: boolean; archived: boolean }>)({
      id: 'plan_abc',
      archived: true,
    })
    expect(result.ok).toBe(true)
    expect(result.archived).toBe(true)
  })

  it('unarchives when archived=false', async () => {
    normalSession()
    dbRef = makeRichDb({ selectSequences: [] })
    const { archivePlan } = await import('~/server/plans')
    const result = await (archivePlan as unknown as (d: unknown) => Promise<{ ok: boolean; archived: boolean }>)({
      id: 'plan_abc',
      archived: false,
    })
    expect(result.ok).toBe(true)
    expect(result.archived).toBe(false)
  })
})

describe('linkPositionToPlan handler', () => {
  it('links a position to a plan successfully', async () => {
    normalSession()
    // selectSequences: [positions (ownership check), plans (ownership check)]
    dbRef = makeRichDb({
      selectSequences: [
        [{ id: 'pos_001' }],  // position ownership check
        [{ id: 'plan_abc' }], // plan ownership check
      ],
    })
    const { linkPositionToPlan } = await import('~/server/plans')
    const result = await (linkPositionToPlan as unknown as (d: unknown) => Promise<{ ok: boolean }>)({
      positionId: 'pos_001',
      planId: 'plan_abc',
    })
    expect(result.ok).toBe(true)
  })

  it('throws if position not found', async () => {
    normalSession()
    dbRef = makeRichDb({ selectSequences: [[]] }) // empty = not found
    const { linkPositionToPlan } = await import('~/server/plans')
    await expect(
      (linkPositionToPlan as unknown as (d: unknown) => Promise<unknown>)({
        positionId: 'pos_missing',
        planId: 'plan_abc',
      }),
    ).rejects.toThrow('Position not found')
  })
})

describe('unlinkPositionFromPlan handler', () => {
  it('unlinks a position successfully', async () => {
    normalSession()
    dbRef = makeRichDb({ selectSequences: [] })
    const { unlinkPositionFromPlan } = await import('~/server/plans')
    const result = await (unlinkPositionFromPlan as unknown as (d: unknown) => Promise<{ ok: boolean }>)({
      positionId: 'pos_001',
    })
    expect(result.ok).toBe(true)
  })

  it('throws DemoReadonlyError for demo users', async () => {
    demoSession()
    dbRef = makeRichDb({ selectSequences: [] })
    const { unlinkPositionFromPlan } = await import('~/server/plans')
    await expect(
      (unlinkPositionFromPlan as unknown as (d: unknown) => Promise<unknown>)({ positionId: 'pos_001' }),
    ).rejects.toThrow(DemoReadonlyError)
  })
})

// ---------------------------------------------------------------------------
// Snapshot tests (Phase 10 Task 1)
// ---------------------------------------------------------------------------

// A variant of makeRichDb that captures the last update().set() payload
function makeCapturingDb(selectSequences: unknown[][]) {
  let lastUpdatePatch: unknown = null
  let seqIdx = 0

  const consumeNext = () => selectSequences[seqIdx++] ?? []

  const db = {
    select: (_fields?: unknown) => {
      // Capture result at select() time — same pattern as makeRichDb
      const result = consumeNext()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function makeChain(): Record<string, unknown> & Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = Promise.resolve(result as unknown[]) as any
        p.from = (_t: unknown) => makeChain()
        p.where = (_c?: unknown) => makeChain()
        p.orderBy = (_col: unknown) => Promise.resolve(result as unknown[])
        p.limit = (_n: number) => Promise.resolve(result as unknown[])
        return p
      }

      return makeChain()
    },
    insert: (_table: unknown) => ({
      values: (_vals: unknown) => Promise.resolve(),
    }),
    update: (_table: unknown) => ({
      set: (patch: unknown) => {
        lastUpdatePatch = patch
        return {
          where: (_cond: unknown) => Promise.resolve(),
        }
      },
    }),
    getLastUpdatePatch: () => lastUpdatePatch,
  }
  return db
}

describe('linkPositionToPlan snapshot tests', () => {
  it('copies all plan fields into snapshot columns on link', async () => {
    normalSession()

    const capDb = makeCapturingDb([
      [{ id: 'pos_001' }], // position ownership check
      [samplePlanRow],     // full plan fetch (SELECT *)
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dbRef = capDb as any

    const { linkPositionToPlan } = await import('~/server/plans')
    const result = await (linkPositionToPlan as unknown as (d: unknown) => Promise<{ ok: boolean }>)({
      positionId: 'pos_001',
      planId: 'plan_abc',
    })

    expect(result.ok).toBe(true)

    const patch = capDb.getLastUpdatePatch() as Record<string, unknown>
    expect(patch.planId).toBe('plan_abc')
    expect(patch.planSnapshotEntryPrice).toBe('40000')
    expect(patch.planSnapshotStopPrice).toBe('38000')
    expect(patch.planSnapshotTargetPrice).toBe('44000')
    expect(patch.planSnapshotSize).toBe('0.1')
    expect(patch.planSnapshotRationale).toBe('Test plan')
  })

  it('clears planId AND all snapshot columns on unlink', async () => {
    normalSession()

    const capDb = makeCapturingDb([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dbRef = capDb as any

    const { unlinkPositionFromPlan } = await import('~/server/plans')
    const result = await (unlinkPositionFromPlan as unknown as (d: unknown) => Promise<{ ok: boolean }>)({
      positionId: 'pos_001',
    })

    expect(result.ok).toBe(true)

    const patch = capDb.getLastUpdatePatch() as Record<string, unknown>
    expect(patch.planId).toBeNull()
    expect(patch.planSnapshotEntryPrice).toBeNull()
    expect(patch.planSnapshotStopPrice).toBeNull()
    expect(patch.planSnapshotTargetPrice).toBeNull()
    expect(patch.planSnapshotSize).toBeNull()
    expect(patch.planSnapshotRationale).toBeNull()
  })
})
