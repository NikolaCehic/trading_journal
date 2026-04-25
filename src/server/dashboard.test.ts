import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for the latestDigestSummary field on getDashboardBundle.
// We only need to drive the digest_run query through the handler — every
// other DB query short-circuits with empty arrays because positionRows ends
// up empty (no `position` rows seeded), which skips the position-id-gated
// branches (top findings, fill counts).
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

vi.mock('~/auth/server', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'u1', email: 'x@example.com', isDemo: false },
      }),
    },
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => ({ headers: new Headers() }),
}))

// Expose the handler as a directly-callable function (no validator gymnastics).
vi.mock('@tanstack/react-start', () => ({
  createServerFn: (_opts: { method: string }) => ({
    inputValidator: (fn: (d: unknown) => unknown) => ({
      handler: (handlerFn: (ctx: { data: unknown }) => unknown) => {
        return async (raw: { data?: unknown }) => {
          const data = fn(raw?.data ?? {})
          return handlerFn({ data })
        }
      },
    }),
  }),
}))

let digestRows: Array<{ isoWeek: string; narrative: unknown; createdAt: Date }> = []

vi.mock('~/db/client', () => {
  // A thennable chain that resolves to whatever rowsFn returns.
  // Supports .from / .where / .orderBy / .limit / .offset and being awaited.
  function chain(rowsFn: () => Promise<unknown[]>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = {
      from: () => c,
      where: () => c,
      orderBy: () => c,
      limit: () => c,
      offset: () => c,
      then: (
        onF: (v: unknown[]) => unknown,
        onR?: (e: unknown) => unknown,
      ) => rowsFn().then(onF, onR),
      catch: (onR: (e: unknown) => unknown) => rowsFn().catch(onR),
      finally: (onF: () => void) => rowsFn().finally(onF),
    }
    return c
  }

  return {
    db: {
      // Distinguish the digest_run select shape ({ isoWeek, narrative, createdAt })
      // from every other call by inspecting the shape arg.
      select: (shape?: unknown) => {
        if (
          shape
          && typeof shape === 'object'
          && 'isoWeek' in (shape as Record<string, unknown>)
          && 'narrative' in (shape as Record<string, unknown>)
        ) {
          return chain(async () => digestRows)
        }
        return chain(async () => [])
      },
      $count: vi.fn(async () => 0),
    },
  }
})

beforeEach(() => {
  digestRows = []
  vi.resetModules()
})

describe('getDashboardBundle latestDigestSummary', () => {
  it('returns null when no composed digest exists', async () => {
    digestRows = []
    const { getDashboardBundle } = await import('./dashboard')
    const bundle = await (getDashboardBundle as unknown as (
      args: { data: unknown },
    ) => Promise<{ latestDigestSummary: unknown }>)({ data: {} })
    expect(bundle.latestDigestSummary).toBeNull()
  })

  it('returns the extracted summary when a composed digest exists', async () => {
    digestRows = [
      {
        isoWeek: '2026-W17',
        narrative: {
          greeting: 'Hi',
          biggestWin: null,
          biggestLoss: null,
          topFinding: { findingId: 'f1', prose: 'You revenge-traded three times.' },
          oneThingToTry: null,
          suggestedRule: null,
        },
        createdAt: new Date('2026-04-25T22:00:00Z'),
      },
    ]
    const { getDashboardBundle } = await import('./dashboard')
    const bundle = await (getDashboardBundle as unknown as (
      args: { data: unknown },
    ) => Promise<{
      latestDigestSummary: { isoWeek: string; summary: string; composedAt: Date } | null
    }>)({ data: {} })
    expect(bundle.latestDigestSummary).toEqual({
      isoWeek: '2026-W17',
      summary: 'You revenge-traded three times.',
      composedAt: new Date('2026-04-25T22:00:00Z'),
    })
  })
})
