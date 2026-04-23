import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { and, eq, desc, count, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import crypto from 'node:crypto'
import { auth } from '~/auth/server'
import { db } from '~/db/client'
import { tradePlan } from '~/db/schema/journal'
import { position } from '~/db/schema/derivation'
import { assertNotDemo } from '~/auth/assertNotDemo'
import type { TradePlan } from '~/domain/plan'

// Suppress unused import warning — count is re-exported for consumers
void count

function generatePlanId(): string {
  return 'plan_' + crypto.randomBytes(10).toString('base64url')
}

async function requireUser(): Promise<string> {
  const s = await auth.api.getSession({ headers: getRequest().headers })
  if (!s?.user) throw new Error('Unauthorized')
  return s.user.id
}

async function requireUserMutation() {
  const s = await auth.api.getSession({ headers: getRequest().headers })
  if (!s?.user) throw new Error('Unauthorized')
  assertNotDemo(s.user)
  return s.user.id
}

// ---------------------------------------------------------------------------
// createPlan
// ---------------------------------------------------------------------------

const createInput = z.object({
  symbol: z.string().min(1).max(64),
  intendedSide: z.enum(['long', 'short']),
  entryPrice: z.number().positive().optional(),
  stopPrice: z.number().positive().optional(),
  targetPrice: z.number().positive().optional(),
  plannedSize: z.number().positive().optional(),
  rationale: z.string().max(4000).optional(),
})

export const createPlan = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => createInput.parse(d))
  .handler(async ({ data }): Promise<{ id: string }> => {
    const userId = await requireUserMutation()
    const id = generatePlanId()
    await db.insert(tradePlan).values({
      id,
      userId,
      symbol: data.symbol,
      intendedSide: data.intendedSide,
      entryPrice: data.entryPrice?.toString() ?? null,
      stopPrice: data.stopPrice?.toString() ?? null,
      targetPrice: data.targetPrice?.toString() ?? null,
      plannedSize: data.plannedSize?.toString() ?? null,
      rationale: data.rationale ?? null,
    })
    return { id }
  })

// ---------------------------------------------------------------------------
// listPlans
// ---------------------------------------------------------------------------

const listInput = z.object({
  includeArchived: z.boolean().optional(),
  symbol: z.string().optional(),
})

export const listPlans = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => listInput.parse(d))
  .handler(async ({ data }): Promise<TradePlan[]> => {
    const userId = await requireUser()
    const where = [eq(tradePlan.userId, userId)]
    if (!data.includeArchived) {
      where.push(isNull(tradePlan.archivedAt))
    }
    if (data.symbol) where.push(eq(tradePlan.symbol, data.symbol))
    const rows = await db
      .select()
      .from(tradePlan)
      .where(and(...where))
      .orderBy(desc(tradePlan.createdAt))
    const ids = rows.map((r) => r.id)
    const linked =
      ids.length > 0
        ? await db
            .select({ planId: position.planId })
            .from(position)
            .where(and(eq(position.userId, userId), inArray(position.planId, ids)))
        : []
    const countMap = new Map<string, number>()
    for (const l of linked) {
      if (l.planId) countMap.set(l.planId, (countMap.get(l.planId) ?? 0) + 1)
    }
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      symbol: r.symbol,
      intendedSide: r.intendedSide,
      entryPrice: r.entryPrice ? Number(r.entryPrice) : null,
      stopPrice: r.stopPrice ? Number(r.stopPrice) : null,
      targetPrice: r.targetPrice ? Number(r.targetPrice) : null,
      plannedSize: r.plannedSize ? Number(r.plannedSize) : null,
      rationale: r.rationale,
      createdAt: r.createdAt,
      archivedAt: r.archivedAt,
      linkedPositionCount: countMap.get(r.id) ?? 0,
    }))
  })

// ---------------------------------------------------------------------------
// getPlan
// ---------------------------------------------------------------------------

export const getPlan = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => z.object({ id: z.string().min(1) }).parse(d))
  .handler(
    async ({ data }): Promise<TradePlan & { linkedPositionIds: string[] }> => {
      const userId = await requireUser()
      const [row] = await db
        .select()
        .from(tradePlan)
        .where(and(eq(tradePlan.id, data.id), eq(tradePlan.userId, userId)))
        .limit(1)
      if (!row) throw new Error('Plan not found')
      const linked = await db
        .select({ id: position.id })
        .from(position)
        .where(and(eq(position.userId, userId), eq(position.planId, row.id)))
      return {
        id: row.id,
        userId: row.userId,
        symbol: row.symbol,
        intendedSide: row.intendedSide,
        entryPrice: row.entryPrice ? Number(row.entryPrice) : null,
        stopPrice: row.stopPrice ? Number(row.stopPrice) : null,
        targetPrice: row.targetPrice ? Number(row.targetPrice) : null,
        plannedSize: row.plannedSize ? Number(row.plannedSize) : null,
        rationale: row.rationale,
        createdAt: row.createdAt,
        archivedAt: row.archivedAt,
        linkedPositionCount: linked.length,
        linkedPositionIds: linked.map((l) => l.id),
      }
    },
  )

// ---------------------------------------------------------------------------
// updatePlan
// ---------------------------------------------------------------------------

const updateInput = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1).max(64).optional(),
  intendedSide: z.enum(['long', 'short']).optional(),
  entryPrice: z.number().positive().nullable().optional(),
  stopPrice: z.number().positive().nullable().optional(),
  targetPrice: z.number().positive().nullable().optional(),
  plannedSize: z.number().positive().nullable().optional(),
  rationale: z.string().max(4000).nullable().optional(),
})

export const updatePlan = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => updateInput.parse(d))
  .handler(async ({ data }) => {
    const userId = await requireUserMutation()
    const patch: Record<string, unknown> = {}
    if (data.symbol !== undefined) patch['symbol'] = data.symbol
    if (data.intendedSide !== undefined) patch['intendedSide'] = data.intendedSide
    if (data.entryPrice !== undefined) patch['entryPrice'] = data.entryPrice?.toString() ?? null
    if (data.stopPrice !== undefined) patch['stopPrice'] = data.stopPrice?.toString() ?? null
    if (data.targetPrice !== undefined) patch['targetPrice'] = data.targetPrice?.toString() ?? null
    if (data.plannedSize !== undefined) patch['plannedSize'] = data.plannedSize?.toString() ?? null
    if (data.rationale !== undefined) patch['rationale'] = data.rationale ?? null
    if (Object.keys(patch).length === 0) return { ok: true, noop: true }
    await db
      .update(tradePlan)
      .set(patch)
      .where(and(eq(tradePlan.id, data.id), eq(tradePlan.userId, userId)))
    return { ok: true }
  })

// ---------------------------------------------------------------------------
// archivePlan (toggles)
// ---------------------------------------------------------------------------

export const archivePlan = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().min(1), archived: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserMutation()
    await db
      .update(tradePlan)
      .set({ archivedAt: data.archived ? new Date() : null })
      .where(and(eq(tradePlan.id, data.id), eq(tradePlan.userId, userId)))
    return { ok: true, archived: data.archived }
  })

// ---------------------------------------------------------------------------
// linkPositionToPlan
// ---------------------------------------------------------------------------

export const linkPositionToPlan = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) =>
    z
      .object({ positionId: z.string().min(1), planId: z.string().min(1) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserMutation()
    // Verify both belong to user
    const [pos] = await db
      .select({ id: position.id })
      .from(position)
      .where(and(eq(position.id, data.positionId), eq(position.userId, userId)))
      .limit(1)
    if (!pos) throw new Error('Position not found')
    const [plan] = await db
      .select({ id: tradePlan.id })
      .from(tradePlan)
      .where(and(eq(tradePlan.id, data.planId), eq(tradePlan.userId, userId)))
      .limit(1)
    if (!plan) throw new Error('Plan not found')
    await db
      .update(position)
      .set({ planId: data.planId })
      .where(eq(position.id, data.positionId))
    return { ok: true }
  })

// ---------------------------------------------------------------------------
// unlinkPositionFromPlan
// ---------------------------------------------------------------------------

export const unlinkPositionFromPlan = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) =>
    z.object({ positionId: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserMutation()
    await db
      .update(position)
      .set({ planId: null })
      .where(and(eq(position.id, data.positionId), eq(position.userId, userId)))
    return { ok: true }
  })
