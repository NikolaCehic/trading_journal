import { z } from 'zod'

const numCompSchema = z
  .object({
    eq: z.number().optional(),
    ne: z.number().optional(),
    lt: z.number().optional(),
    lte: z.number().optional(),
    gt: z.number().optional(),
    gte: z.number().optional(),
  })
  .refine(v => Object.keys(v).length > 0, { message: 'at least one num operator' })

const strCompSchema = z
  .object({
    eq: z.string().optional(),
    in: z.array(z.string()).optional(),
  })
  .refine(v => v.eq !== undefined || v.in !== undefined, { message: 'at least one str operator' })

export type NumComp = z.infer<typeof numCompSchema>
export type StrComp = z.infer<typeof strCompSchema>

const leafPredicateFields = {
  symbol: strCompSchema.optional(),
  instrumentType: z.enum(['spot', 'perp']).optional(),
  side: z.enum(['long', 'short']).optional(),
  dayOfWeekUtc: numCompSchema.optional(),
  hourOfDayUtc: numCompSchema.optional(),
  pnl: numCompSchema.optional(),
  pnlPct: numCompSchema.optional(),
  holdDurationMins: numCompSchema.optional(),
  hasTag: z.string().optional(),
  minLossStreak: z.number().int().positive().optional(),
}

// Explicit TypeScript type (not inferred from zod) to avoid recursive inference issues
export type PositionPredicate = {
  symbol?: StrComp
  instrumentType?: 'spot' | 'perp'
  side?: 'long' | 'short'
  dayOfWeekUtc?: NumComp
  hourOfDayUtc?: NumComp
  pnl?: NumComp
  pnlPct?: NumComp
  holdDurationMins?: NumComp
  hasTag?: string
  minLossStreak?: number
  all?: PositionPredicate[]
  any?: PositionPredicate[]
  not?: PositionPredicate
}

export const PositionPredicateSchema: z.ZodType<PositionPredicate> = z.lazy(() =>
  z.object({
    ...leafPredicateFields,
    all: z.array(PositionPredicateSchema).optional(),
    any: z.array(PositionPredicateSchema).optional(),
    not: PositionPredicateSchema.optional(),
  }),
)

export type UserDetectorDefinition = {
  id: string
  userId: string
  name: string
  title: string
  severity: 'info' | 'warning' | 'critical'
  predicate: PositionPredicate
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}
