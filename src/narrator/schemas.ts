import { z } from 'zod'

// ---------------------------------------------------------------------------
// Digest narrative schema
// ---------------------------------------------------------------------------
// Note: position IDs in the DB are strings (not formally enforced as UUIDs).
// We use z.string().min(1) to avoid false rejections; the grounding validator
// enforces the real allowlist check against DigestFactBundle.allowedPositionIds.

export const DigestNarrativeSchema = z.object({
  greeting: z.string().max(240),
  biggestWin: z
    .object({
      positionId: z.string().min(1),
      prose: z.string().max(360),
    })
    .nullable(),
  biggestLoss: z
    .object({
      positionId: z.string().min(1),
      prose: z.string().max(360),
    })
    .nullable(),
  topFinding: z
    .object({
      findingId: z.string().min(1),
      prose: z.string().max(500),
    })
    .nullable(),
  oneThingToTry: z.string().max(280).nullable(),
  suggestedRule: z
    .object({
      detectorId: z.string().min(1),
      ruleText: z.string().max(180),
    })
    .nullable(),
})

export type DigestNarrative = z.infer<typeof DigestNarrativeSchema>

// ---------------------------------------------------------------------------
// Coach narrative schema
// ---------------------------------------------------------------------------

export const CoachNarrativeSchema = z.object({
  gradeLetter: z.enum(['A', 'B', 'C', 'D', 'F']),
  prose: z.string().max(1200),
  referencedPositionIds: z.array(z.string().min(1)).max(5),
  referencedFindingIds: z.array(z.string().min(1)).max(5),
})

export type CoachNarrative = z.infer<typeof CoachNarrativeSchema>
