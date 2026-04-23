import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import crypto from 'node:crypto'
import { auth } from '~/auth/server'
import { db } from '~/db/client'
import { userDetector } from '~/db/schema/customDetectors'
import { assertNotDemo } from '~/auth/assertNotDemo'
import { PositionPredicateSchema, type UserDetectorDefinition } from '~/domain/userDetector'

function generateDetectorId(): string {
  return 'det_' + crypto.randomBytes(10).toString('base64url')
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

function rowToDefinition(r: typeof userDetector.$inferSelect): UserDetectorDefinition {
  return {
    id: r.id,
    userId: r.userId,
    name: r.name,
    title: r.title,
    severity: r.severity,
    predicate: r.predicate,
    enabled: r.enabled,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

const createInput = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/, 'slug-case only'),
  title: z.string().min(1).max(200),
  severity: z.enum(['info', 'warning', 'critical']),
  predicate: PositionPredicateSchema,
})

export const createCustomDetector = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => createInput.parse(d))
  .handler(async ({ data }): Promise<{ id: string }> => {
    const userId = await requireUserMutation()
    const id = generateDetectorId()
    await db.insert(userDetector).values({
      id,
      userId,
      name: data.name,
      title: data.title,
      severity: data.severity,
      predicate: data.predicate,
      enabled: true,
    })
    return { id }
  })

export const listCustomDetectors = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => d)
  .handler(async (): Promise<UserDetectorDefinition[]> => {
    const userId = await requireUser()
    const rows = await db.select().from(userDetector)
      .where(eq(userDetector.userId, userId))
      .orderBy(desc(userDetector.createdAt))
    return rows.map(rowToDefinition)
  })

export const getCustomDetector = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => z.object({ id: z.string().min(1) }).parse(d))
  .handler(async ({ data }): Promise<UserDetectorDefinition> => {
    const userId = await requireUser()
    const [row] = await db.select().from(userDetector)
      .where(and(eq(userDetector.id, data.id), eq(userDetector.userId, userId))).limit(1)
    if (!row) throw new Error('Detector not found')
    return rowToDefinition(row)
  })

const updateInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/).optional(),
  title: z.string().min(1).max(200).optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  predicate: PositionPredicateSchema.optional(),
})

export const updateCustomDetector = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => updateInput.parse(d))
  .handler(async ({ data }) => {
    const userId = await requireUserMutation()
    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (data.name !== undefined) patch['name'] = data.name
    if (data.title !== undefined) patch['title'] = data.title
    if (data.severity !== undefined) patch['severity'] = data.severity
    if (data.predicate !== undefined) patch['predicate'] = data.predicate
    if (Object.keys(patch).length === 1) return { ok: true, noop: true }
    await db.update(userDetector).set(patch)
      .where(and(eq(userDetector.id, data.id), eq(userDetector.userId, userId)))
    return { ok: true }
  })

export const toggleCustomDetector = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => z.object({ id: z.string().min(1), enabled: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const userId = await requireUserMutation()
    await db.update(userDetector).set({ enabled: data.enabled, updatedAt: new Date() })
      .where(and(eq(userDetector.id, data.id), eq(userDetector.userId, userId)))
    return { ok: true, enabled: data.enabled }
  })

export const deleteCustomDetector = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => z.object({ id: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const userId = await requireUserMutation()
    await db.delete(userDetector)
      .where(and(eq(userDetector.id, data.id), eq(userDetector.userId, userId)))
    return { ok: true }
  })

const importInput = z.object({
  detectors: z.array(z.object({
    name: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/, 'slug-case only'),
    title: z.string().min(1).max(200),
    severity: z.enum(['info', 'warning', 'critical']),
    predicate: PositionPredicateSchema,
    enabled: z.boolean().optional(),
  })).max(100),
})

export const importCustomDetectors = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => importInput.parse(d))
  .handler(async ({ data }): Promise<{
    imported: number
    skipped: number
    errors: Array<{ name: string; error: string }>
  }> => {
    const userId = await requireUserMutation()
    let imported = 0
    let skipped = 0
    const errors: Array<{ name: string; error: string }> = []

    for (const det of data.detectors) {
      try {
        const [existing] = await db.select({ id: userDetector.id })
          .from(userDetector)
          .where(and(eq(userDetector.userId, userId), eq(userDetector.name, det.name)))
          .limit(1)
        if (existing) {
          skipped++
          continue
        }
        const id = generateDetectorId()
        await db.insert(userDetector).values({
          id, userId,
          name: det.name,
          title: det.title,
          severity: det.severity,
          predicate: det.predicate,
          enabled: det.enabled ?? true,
        })
        imported++
      } catch (err) {
        errors.push({ name: det.name, error: String(err) })
      }
    }

    return { imported, skipped, errors }
  })
