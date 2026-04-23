import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '~/auth/server'
import { assertNotDemo } from '~/auth/assertNotDemo'
import { db } from '~/db/client'
import {
  tradeNote, setupTag, mistakeTag, positionTag, positionReflection,
} from '~/db/schema/journal'
import { position } from '~/db/schema/derivation'

async function requireOwnership(positionId: string, userId: string) {
  const row = await db.query.position.findFirst({
    where: and(eq(position.id, positionId), eq(position.userId, userId)),
  })
  if (!row) throw new Error('Position not found')
  return row
}

// --- Notes ---
const upsertNoteInput = z.object({
  positionId: z.string().min(1),
  bodyMarkdown: z.string().max(20_000),
})

export const upsertTradeNote = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => upsertNoteInput.parse(d))
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: getRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    assertNotDemo(session.user)
    const userId = session.user.id
    await requireOwnership(data.positionId, userId)
    const id = `note_${userId.slice(0, 8)}_${data.positionId.slice(-12)}`
    await db.insert(tradeNote).values({
      id, userId, positionId: data.positionId, bodyMarkdown: data.bodyMarkdown,
    }).onConflictDoUpdate({
      target: [tradeNote.userId, tradeNote.positionId],
      set: { bodyMarkdown: data.bodyMarkdown, updatedAt: new Date() },
    })
    return { ok: true }
  })

// --- Tags (apply/remove) ---
const applyTagInput = z.object({
  positionIds: z.array(z.string().min(1)).min(1).max(200),
  kind: z.enum(['setup', 'mistake']),
  setupTagId: z.string().optional(),
  mistakeTagId: z.string().optional(),
}).refine(
  d => (d.kind === 'setup' && !!d.setupTagId) || (d.kind === 'mistake' && !!d.mistakeTagId),
  { message: 'setupTagId required for setup / mistakeTagId required for mistake' },
)

export const applyPositionTag = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => applyTagInput.parse(d))
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: getRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    assertNotDemo(session.user)
    const userId = session.user.id
    // Batch-verify ownership: only fetch the requested positions that belong to this user
    const owned = await db.select({ id: position.id }).from(position)
      .where(and(inArray(position.id, data.positionIds), eq(position.userId, userId)))
    const ownedSet = new Set(owned.map(p => p.id))
    const rows = data.positionIds.filter(pid => ownedSet.has(pid)).map(pid => ({
      id: `pt_${pid}_${data.kind}_${data.setupTagId ?? data.mistakeTagId}`,
      userId, positionId: pid, kind: data.kind,
      setupTagId: data.setupTagId ?? null,
      mistakeTagId: data.mistakeTagId ?? null,
    }))
    if (!rows.length) return { applied: 0 }
    await db.insert(positionTag).values(rows).onConflictDoNothing()
    return { applied: rows.length }
  })

const removeTagInput = z.object({
  positionId: z.string().min(1),
  kind: z.enum(['setup', 'mistake']),
  setupTagId: z.string().optional(),
  mistakeTagId: z.string().optional(),
})

export const removePositionTag = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => removeTagInput.parse(d))
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: getRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    assertNotDemo(session.user)
    const userId = session.user.id
    const conds = [
      eq(positionTag.userId, userId),
      eq(positionTag.positionId, data.positionId),
      eq(positionTag.kind, data.kind),
    ]
    if (data.setupTagId)   conds.push(eq(positionTag.setupTagId, data.setupTagId))
    if (data.mistakeTagId) conds.push(eq(positionTag.mistakeTagId, data.mistakeTagId))
    await db.delete(positionTag).where(and(...conds))
    return { ok: true }
  })

// --- Tag catalogue (create custom setup / mistake tags) ---
const createTagInput = z.object({
  kind: z.enum(['setup', 'mistake']),
  label: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})

export const createTag = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => createTagInput.parse(d))
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: getRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    assertNotDemo(session.user)
    const userId = session.user.id
    const slug = data.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)
    if (data.kind === 'setup') {
      const id = `st_${userId.slice(0, 8)}_${slug}`
      await db.insert(setupTag).values({ id, userId, label: data.label, color: data.color ?? null })
        .onConflictDoNothing()
      return { id, kind: 'setup' as const, label: data.label, color: data.color ?? null }
    }
    const id = `mt_${userId.slice(0, 8)}_${slug}`
    await db.insert(mistakeTag).values({ id, userId, label: data.label, color: data.color ?? null, isDefault: false })
      .onConflictDoNothing()
    return { id, kind: 'mistake' as const, label: data.label, color: data.color ?? null }
  })

// --- Reflections ---
const upsertReflectionInput = z.object({
  positionId: z.string().min(1),
  confidence: z.number().int().min(1).max(5).nullable(),
  emotionalState: z.enum(['calm', 'fomo', 'revenge', 'bored', 'anxious', 'confident']).nullable(),
  reflectionMarkdown: z.string().max(5_000).nullable(),
})

export const upsertReflection = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => upsertReflectionInput.parse(d))
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: getRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    assertNotDemo(session.user)
    const userId = session.user.id
    await requireOwnership(data.positionId, userId)
    const id = `pr_${userId.slice(0, 8)}_${data.positionId.slice(-12)}`
    await db.insert(positionReflection).values({
      id, userId, positionId: data.positionId,
      confidence: data.confidence, emotionalState: data.emotionalState,
      reflectionMarkdown: data.reflectionMarkdown,
    }).onConflictDoUpdate({
      target: [positionReflection.userId, positionReflection.positionId],
      set: {
        confidence: data.confidence,
        emotionalState: data.emotionalState,
        reflectionMarkdown: data.reflectionMarkdown,
        updatedAt: new Date(),
      },
    })
    return { ok: true }
  })

// --- Tag list (used by tag picker in Task 15) ---
export const listTags = createServerFn({ method: 'GET' })
  .handler(async () => {
    const session = await auth.api.getSession({ headers: getRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    const userId = session.user.id
    const setup = await db.select().from(setupTag).where(and(eq(setupTag.userId, userId), eq(setupTag.isArchived, false)))
    const mistake = await db.select().from(mistakeTag).where(and(eq(mistakeTag.userId, userId), eq(mistakeTag.isArchived, false)))
    return {
      setup: setup.map(s => ({ id: s.id, label: s.label, color: s.color })),
      mistake: mistake.map(m => ({ id: m.id, label: m.label, color: m.color })),
    }
  })
