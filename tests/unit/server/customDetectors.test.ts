import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DemoReadonlyError } from '~/auth/assertNotDemo'
import type { UserDetectorDefinition } from '~/domain/userDetector'

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

function makeRichDb(opts: {
  selectSequences: unknown[][]
  insertOk?: boolean
  updateOk?: boolean
  deleteOk?: boolean
}) {
  let seqIdx = 0
  const { selectSequences } = opts

  const consumeNext = () => selectSequences[seqIdx++] ?? []

  return {
    select: (_fields?: unknown) => {
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
      set: (_patch: unknown) => ({
        where: (_cond: unknown) => Promise.resolve(),
      }),
    }),
    delete: (_table: unknown) => ({
      where: (_cond: unknown) => Promise.resolve(),
    }),
  }
}

// Capturing variant that records the last insert values and update patch
function makeCapturingDb(selectSequences: unknown[][]) {
  let lastInsertValues: unknown = null
  let lastUpdatePatch: unknown = null
  let seqIdx = 0

  const consumeNext = () => selectSequences[seqIdx++] ?? []

  const db = {
    select: (_fields?: unknown) => {
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
      values: (vals: unknown) => {
        lastInsertValues = vals
        return Promise.resolve()
      },
    }),
    update: (_table: unknown) => ({
      set: (patch: unknown) => {
        lastUpdatePatch = patch
        return {
          where: (_cond: unknown) => Promise.resolve(),
        }
      },
    }),
    delete: (_table: unknown) => ({
      where: (_cond: unknown) => Promise.resolve(),
    }),
    getLastInsertValues: () => lastInsertValues,
    getLastUpdatePatch: () => lastUpdatePatch,
  }
  return db
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
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user_abc123'
const OTHER_USER_ID = 'user_other999'

function normalSession() {
  mockSession.mockResolvedValue({
    user: { id: USER_ID, isDemo: false, email: 'test@example.com' },
  })
}

function demoSession() {
  mockSession.mockResolvedValue({
    user: { id: USER_ID, isDemo: true, email: 'demo@example.com' },
  })
}

const sampleDetectorRow: UserDetectorDefinition & { id: string } = {
  id: 'det_abcdefghij',
  userId: USER_ID,
  name: 'big-loss',
  title: 'Large loss detected',
  severity: 'warning',
  predicate: { pnl: { lt: -500 } },
  enabled: true,
  createdAt: new Date('2026-04-20T00:00:00.000Z'),
  updatedAt: new Date('2026-04-20T00:00:00.000Z'),
}

// ---------------------------------------------------------------------------
// createCustomDetector
// ---------------------------------------------------------------------------

describe('createCustomDetector handler', () => {
  beforeEach(() => {
    dbRef = makeRichDb({ selectSequences: [] })
  })

  it('happy path: returns id prefixed with det_ and inserts correct values', async () => {
    normalSession()
    const capDb = makeCapturingDb([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dbRef = capDb as any

    const { createCustomDetector } = await import('~/server/customDetectors')
    const result = await (createCustomDetector as unknown as (d: unknown) => Promise<{ id: string }>)({
      name: 'big-loss',
      title: 'Large loss detected',
      severity: 'warning',
      predicate: { pnl: { lt: -500 } },
    })

    expect(result.id).toMatch(/^det_/)

    const inserted = capDb.getLastInsertValues() as Record<string, unknown>
    expect(inserted.id).toMatch(/^det_/)
    expect(inserted.userId).toBe(USER_ID)
    expect(inserted.name).toBe('big-loss')
    expect(inserted.severity).toBe('warning')
    expect(inserted.enabled).toBe(true)
    expect(inserted.predicate).toEqual({ pnl: { lt: -500 } })
  })

  it('throws DemoReadonlyError for demo users', async () => {
    demoSession()
    const { createCustomDetector } = await import('~/server/customDetectors')
    await expect(
      (createCustomDetector as unknown as (d: unknown) => Promise<unknown>)({
        name: 'big-loss',
        title: 'Large loss',
        severity: 'info',
        predicate: { pnl: { lt: -100 } },
      }),
    ).rejects.toThrow(DemoReadonlyError)
  })

  it('rejects malformed predicate (numComp with zero operators)', async () => {
    normalSession()
    const { createCustomDetector } = await import('~/server/customDetectors')
    // pnl is a numComp — empty object has zero operators, should fail the .refine()
    await expect(
      (createCustomDetector as unknown as (d: unknown) => Promise<unknown>)({
        name: 'bad-pred',
        title: 'Bad predicate',
        severity: 'info',
        predicate: { pnl: {} },
      }),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// listCustomDetectors
// ---------------------------------------------------------------------------

describe('listCustomDetectors handler', () => {
  it('returns mapped rows for the authenticated user', async () => {
    normalSession()
    dbRef = makeRichDb({ selectSequences: [[sampleDetectorRow]] })
    const { listCustomDetectors } = await import('~/server/customDetectors')
    const result = await (listCustomDetectors as unknown as (d: unknown) => Promise<UserDetectorDefinition[]>)(undefined)
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('big-loss')
    expect(result[0]!.userId).toBe(USER_ID)
  })

  it('excludes other users rows (mock returns only user-specific rows)', async () => {
    normalSession()
    // The handler filters by userId via eq(userDetector.userId, userId).
    // Our mock simulates the DB already applying that filter — return empty.
    const otherUserRow = { ...sampleDetectorRow, userId: OTHER_USER_ID, id: 'det_other' }
    // Simulate: DB applies WHERE user_id = USER_ID, so other user's row not returned
    dbRef = makeRichDb({ selectSequences: [[]] })
    void otherUserRow // acknowledged but not returned by mock
    const { listCustomDetectors } = await import('~/server/customDetectors')
    const result = await (listCustomDetectors as unknown as (d: unknown) => Promise<UserDetectorDefinition[]>)(undefined)
    expect(result).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// getCustomDetector
// ---------------------------------------------------------------------------

describe('getCustomDetector handler', () => {
  it('happy path: returns the mapped detector definition', async () => {
    normalSession()
    dbRef = makeRichDb({ selectSequences: [[sampleDetectorRow]] })
    const { getCustomDetector } = await import('~/server/customDetectors')
    const result = await (getCustomDetector as unknown as (d: unknown) => Promise<UserDetectorDefinition>)({
      id: 'det_abcdefghij',
    })
    expect(result.id).toBe('det_abcdefghij')
    expect(result.title).toBe('Large loss detected')
    expect(result.severity).toBe('warning')
  })

  it('throws Detector not found when id belongs to another user', async () => {
    normalSession()
    // DB returns empty — ownership check via WHERE userId = ... returns nothing
    dbRef = makeRichDb({ selectSequences: [[]] })
    const { getCustomDetector } = await import('~/server/customDetectors')
    await expect(
      (getCustomDetector as unknown as (d: unknown) => Promise<unknown>)({ id: 'det_other_user' }),
    ).rejects.toThrow('Detector not found')
  })
})

// ---------------------------------------------------------------------------
// updateCustomDetector
// ---------------------------------------------------------------------------

describe('updateCustomDetector handler', () => {
  it('patches only provided fields (title only → patch contains title + updatedAt)', async () => {
    normalSession()
    const capDb = makeCapturingDb([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dbRef = capDb as any

    const { updateCustomDetector } = await import('~/server/customDetectors')
    const result = await (updateCustomDetector as unknown as (d: unknown) => Promise<{ ok: boolean; noop?: boolean }>)({
      id: 'det_abcdefghij',
      title: 'Updated title',
    })

    expect(result.ok).toBe(true)
    expect(result.noop).toBeUndefined()

    const patch = capDb.getLastUpdatePatch() as Record<string, unknown>
    expect(patch['title']).toBe('Updated title')
    expect(patch['updatedAt']).toBeInstanceOf(Date)
    // name, severity, predicate should NOT be in patch
    expect(patch['name']).toBeUndefined()
    expect(patch['severity']).toBeUndefined()
    expect(patch['predicate']).toBeUndefined()
  })

  it('returns noop:true when no fields provided beyond id', async () => {
    normalSession()
    dbRef = makeRichDb({ selectSequences: [] })
    const { updateCustomDetector } = await import('~/server/customDetectors')
    const result = await (updateCustomDetector as unknown as (d: unknown) => Promise<{ ok: boolean; noop?: boolean }>)({
      id: 'det_abcdefghij',
    })
    expect(result.ok).toBe(true)
    expect(result.noop).toBe(true)
  })

  it('throws DemoReadonlyError for demo users', async () => {
    demoSession()
    dbRef = makeRichDb({ selectSequences: [] })
    const { updateCustomDetector } = await import('~/server/customDetectors')
    await expect(
      (updateCustomDetector as unknown as (d: unknown) => Promise<unknown>)({
        id: 'det_abcdefghij',
        title: 'Hacked',
      }),
    ).rejects.toThrow(DemoReadonlyError)
  })
})

// ---------------------------------------------------------------------------
// toggleCustomDetector
// ---------------------------------------------------------------------------

describe('toggleCustomDetector handler', () => {
  it('flips enabled to false', async () => {
    normalSession()
    const capDb = makeCapturingDb([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dbRef = capDb as any

    const { toggleCustomDetector } = await import('~/server/customDetectors')
    const result = await (toggleCustomDetector as unknown as (d: unknown) => Promise<{ ok: boolean; enabled: boolean }>)({
      id: 'det_abcdefghij',
      enabled: false,
    })
    expect(result.ok).toBe(true)
    expect(result.enabled).toBe(false)

    const patch = capDb.getLastUpdatePatch() as Record<string, unknown>
    expect(patch['enabled']).toBe(false)
    expect(patch['updatedAt']).toBeInstanceOf(Date)
  })

  it('flips enabled to true', async () => {
    normalSession()
    dbRef = makeRichDb({ selectSequences: [] })
    const { toggleCustomDetector } = await import('~/server/customDetectors')
    const result = await (toggleCustomDetector as unknown as (d: unknown) => Promise<{ ok: boolean; enabled: boolean }>)({
      id: 'det_abcdefghij',
      enabled: true,
    })
    expect(result.ok).toBe(true)
    expect(result.enabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// deleteCustomDetector
// ---------------------------------------------------------------------------

describe('deleteCustomDetector handler', () => {
  it('removes the detector and returns ok:true', async () => {
    normalSession()
    dbRef = makeRichDb({ selectSequences: [] })
    const { deleteCustomDetector } = await import('~/server/customDetectors')
    const result = await (deleteCustomDetector as unknown as (d: unknown) => Promise<{ ok: boolean }>)({
      id: 'det_abcdefghij',
    })
    expect(result.ok).toBe(true)
  })

  it('throws DemoReadonlyError for demo users', async () => {
    demoSession()
    dbRef = makeRichDb({ selectSequences: [] })
    const { deleteCustomDetector } = await import('~/server/customDetectors')
    await expect(
      (deleteCustomDetector as unknown as (d: unknown) => Promise<unknown>)({ id: 'det_abcdefghij' }),
    ).rejects.toThrow(DemoReadonlyError)
  })
})
