import { describe, it, expect, vi } from 'vitest'
import { applyMatchToPosition } from './planMatcher'
import type { DB } from '~/db/client'
import { isNull } from 'drizzle-orm'
import { position } from '~/db/schema/derivation'

/**
 * Data H-02: the auto-matcher must not clobber a manual plan link that
 * landed on the position between the fetch-phase SELECT and the apply-phase
 * UPDATE.
 *
 * The guard is `isNull(position.planId)` added to the UPDATE's WHERE clause.
 * These tests exercise `applyMatchToPosition` with a fake DB that:
 *   1. captures the WHERE condition so we can confirm an `isNull(planId)`
 *      predicate is present, and
 *   2. simulates PostgreSQL: if the seeded row already has a non-null
 *      `planId`, the guard filters it out so `.returning()` yields no rows.
 */

type SeededPosition = {
  id: string
  userId: string
  planId: string | null
}

type SeededPlan = {
  id: string
  entryPrice: string | null
  stopPrice: string | null
  targetPrice: string | null
  plannedSize: string | null
  rationale: string | null
}

function makeFakeDb(opts: {
  positions: SeededPosition[]
  plans: SeededPlan[]
}) {
  const store = {
    positions: opts.positions.map((p) => ({ ...p })),
    plans: opts.plans.map((p) => ({ ...p })),
  }

  const whereSpy = vi.fn<(condition: unknown) => unknown>()

  // SELECT chain — returns the plan row so applyMatchToPosition proceeds.
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => store.plans),
      })),
    })),
  }))

  // UPDATE chain — `.where()` captures the condition for inspection;
  // `.returning()` simulates PG by applying the `planId IS NULL` guard.
  const update = vi.fn(() => ({
    set: vi.fn((payload: Record<string, unknown>) => ({
      where: vi.fn((condition: unknown) => {
        whereSpy(condition)
        return {
          returning: vi.fn(async () => {
            // Apply the guard: only rows with planId === null get updated.
            const matched = store.positions.filter((p) => p.planId === null)
            for (const row of matched) {
              row.planId = payload['planId'] as string
            }
            return matched.map((r) => ({ id: r.id }))
          }),
        }
      }),
    })),
  }))

  const db = { select, update } as unknown as DB
  return { db, store, whereSpy }
}

describe('applyMatchToPosition — data H-02 guard', () => {
  it('does NOT overwrite a manual planId set between fetch and apply', async () => {
    // Seed: the position already has a manual link (`plan_manual`).
    const { db, store } = makeFakeDb({
      positions: [{ id: 'pos_1', userId: 'u_1', planId: 'plan_manual' }],
      plans: [{
        id: 'plan_auto',
        entryPrice: '100',
        stopPrice: '90',
        targetPrice: '120',
        plannedSize: '1',
        rationale: 'auto',
      }],
    })

    const result = await applyMatchToPosition(db, 'u_1', {
      positionId: 'pos_1',
      planId: 'plan_auto',
    })

    // The apply reports "not applied" — the guard filtered the row out.
    expect(result).toEqual({ applied: false })
    // The manual link survived untouched.
    expect(store.positions[0]?.planId).toBe('plan_manual')
  })

  it('applies the match when planId is still null (happy path)', async () => {
    const { db, store } = makeFakeDb({
      positions: [{ id: 'pos_1', userId: 'u_1', planId: null }],
      plans: [{
        id: 'plan_auto',
        entryPrice: '100',
        stopPrice: '90',
        targetPrice: '120',
        plannedSize: '1',
        rationale: 'auto',
      }],
    })

    const result = await applyMatchToPosition(db, 'u_1', {
      positionId: 'pos_1',
      planId: 'plan_auto',
    })

    expect(result).toEqual({ applied: true })
    expect(store.positions[0]?.planId).toBe('plan_auto')
  })

  it('passes an isNull(position.planId) predicate in the UPDATE WHERE clause', async () => {
    // Structural assertion: the captured `and(...)` condition must include a
    // chunk whose SQL text contains "is null" and references `position.plan_id`.
    // We walk the drizzle SQL tree without JSON-stringifying (the tree is
    // self-referential by design — tables reference columns reference tables).
    const { db, whereSpy } = makeFakeDb({
      positions: [{ id: 'pos_1', userId: 'u_1', planId: null }],
      plans: [{
        id: 'plan_auto',
        entryPrice: '100',
        stopPrice: '90',
        targetPrice: '120',
        plannedSize: '1',
        rationale: 'auto',
      }],
    })

    await applyMatchToPosition(db, 'u_1', {
      positionId: 'pos_1',
      planId: 'plan_auto',
    })

    expect(whereSpy).toHaveBeenCalledTimes(1)
    const captured = whereSpy.mock.calls[0]?.[0]
    expect(captured).toBeTruthy()

    // Walk the drizzle SQL chunk tree and collect every string literal
    // chunk. An `isNull(col)` emits a chunk containing the literal " is null".
    const seen = new WeakSet<object>()
    const literals: string[] = []
    const colRefs: string[] = []
    function walk(node: unknown): void {
      if (node === null || typeof node !== 'object') return
      if (seen.has(node as object)) return
      seen.add(node as object)
      // Drizzle `sql` chunks expose `queryChunks` arrays.
      const chunks = (node as { queryChunks?: unknown[] }).queryChunks
      if (Array.isArray(chunks)) {
        for (const c of chunks) walk(c)
      }
      // StringChunk wraps a `value` string array.
      const value = (node as { value?: unknown }).value
      if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
        literals.push(...(value as string[]))
      } else if (typeof value === 'string') {
        literals.push(value)
      }
      // Column reference — drizzle Column has a `name` property
      const name = (node as { name?: unknown }).name
      const tbl = (node as { table?: { [k: symbol]: unknown } }).table
      if (typeof name === 'string' && tbl && typeof tbl === 'object') {
        colRefs.push(name)
      }
    }
    walk(captured)

    // The "is null" SQL fragment must be present (from our isNull guard).
    expect(literals.some((l) => l.includes('is null'))).toBe(true)
    // And the guard must reference the `plan_id` column specifically.
    // (The captured tree also contains `id` and `user_id` from the other two
    // predicates; we just need `plan_id` to appear somewhere.)
    expect(colRefs).toContain(position.planId.name)
    // Reference `isNull` helper so the import isn't considered unused when
    // this test is read in isolation.
    expect(typeof isNull).toBe('function')
  })
})
