import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '~/auth/server'
import { db } from '~/db/client'
import { position } from '~/db/schema/derivation'
import { tradeCoachNote } from '~/db/schema/narrator'
import { DERIVATION_VERSION } from '~/derivation/version'
import { buildCoachFacts } from '~/narrator/facts/coachFacts'
import { composeCoach } from '~/narrator/compose'

const coachInput = z.object({ positionId: z.string().min(1) })

export type TradeCoachResult = {
  gradeLetter: 'A' | 'B' | 'C' | 'D' | 'F'
  narrativeMarkdown: string
  referencedPositionIds: string[]
  failed: boolean
  cachedAt: string // ISO
}

export const getTradeCoach = createServerFn({ method: 'POST' })
  .inputValidator((v: unknown) => coachInput.parse(v))
  .handler(async ({ data }) => {
    const request = getRequest()
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user) throw new Error('unauthorized')
    const userId = session.user.id

    // Ownership check
    const [pos] = await db
      .select({ id: position.id, userId: position.userId })
      .from(position)
      .where(and(eq(position.id, data.positionId), eq(position.userId, userId)))
      .limit(1)
    if (!pos) throw new Error('not_found')

    // Cache hit?
    const [cached] = await db
      .select()
      .from(tradeCoachNote)
      .where(
        and(
          eq(tradeCoachNote.positionId, data.positionId),
          eq(tradeCoachNote.derivationVersion, DERIVATION_VERSION),
        ),
      )
      .limit(1)

    if (cached) {
      const grade = parseGrade(cached.narrativeMarkdown)
      return {
        gradeLetter: grade,
        narrativeMarkdown: stripGradeLine(cached.narrativeMarkdown),
        referencedPositionIds: cached.referencedPositionIds ?? [],
        failed: false,
        cachedAt: cached.createdAt.toISOString(),
      } satisfies TradeCoachResult
    }

    // Cache miss: compose
    const facts = await buildCoachFacts(db, userId, data.positionId)
    const result = await composeCoach(facts)

    const markdown = `## Grade: ${result.narrative.gradeLetter}\n\n${result.narrative.prose}`

    // Persist
    await db
      .insert(tradeCoachNote)
      .values({
        userId,
        positionId: data.positionId,
        derivationVersion: DERIVATION_VERSION,
        narrativeMarkdown: markdown,
        referencedPositionIds: result.narrative.referencedPositionIds,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      })
      .onConflictDoNothing({
        target: [tradeCoachNote.positionId, tradeCoachNote.derivationVersion],
      })

    return {
      gradeLetter: result.narrative.gradeLetter,
      narrativeMarkdown: result.narrative.prose,
      referencedPositionIds: result.narrative.referencedPositionIds,
      failed: result.failed,
      cachedAt: new Date().toISOString(),
    } satisfies TradeCoachResult
  })

function parseGrade(md: string): 'A' | 'B' | 'C' | 'D' | 'F' {
  const m = md.match(/^##\s*Grade:\s*([A-F])/i)
  return (m?.[1]?.toUpperCase() as 'A' | 'B' | 'C' | 'D' | 'F') ?? 'C'
}

function stripGradeLine(md: string): string {
  return md.replace(/^##\s*Grade:\s*[A-F]\s*\n\n?/i, '')
}
