import { and, eq, gte, lte, sum } from 'drizzle-orm'
import { db } from '~/db/client'
import { digestRun, tradeCoachNote } from '~/db/schema/narrator'

// Anthropic Sonnet 4.6 pricing (USD per 1M tokens, approximate — tune later)
const USD_PER_INPUT_TOKEN = 3 / 1_000_000   // $3 per 1M input
const USD_PER_OUTPUT_TOKEN = 15 / 1_000_000 // $15 per 1M output

export const NARRATOR_USD_PER_USER_WEEK = 0.10

export type BudgetStatus = {
  spentUsd: number
  capUsd: number
  remainingUsd: number
  overBudget: boolean
  digestTokens: { in: number; out: number }
  coachTokens: { in: number; out: number }
}

export async function getNarratorBudgetStatus(userId: string): Promise<BudgetStatus> {
  const { weekStart, weekEnd } = currentWeekRangeUtc()

  const [digestAgg] = await db
    .select({
      tokensIn: sum(digestRun.tokensIn).mapWith(Number),
      tokensOut: sum(digestRun.tokensOut).mapWith(Number),
    })
    .from(digestRun)
    .where(and(
      eq(digestRun.userId, userId),
      gte(digestRun.createdAt, weekStart),
      lte(digestRun.createdAt, weekEnd),
    ))

  const [coachAgg] = await db
    .select({
      tokensIn: sum(tradeCoachNote.tokensIn).mapWith(Number),
      tokensOut: sum(tradeCoachNote.tokensOut).mapWith(Number),
    })
    .from(tradeCoachNote)
    .where(and(
      eq(tradeCoachNote.userId, userId),
      gte(tradeCoachNote.createdAt, weekStart),
      lte(tradeCoachNote.createdAt, weekEnd),
    ))

  const digestTokens = { in: digestAgg?.tokensIn ?? 0, out: digestAgg?.tokensOut ?? 0 }
  const coachTokens = { in: coachAgg?.tokensIn ?? 0, out: coachAgg?.tokensOut ?? 0 }

  const totalIn = digestTokens.in + coachTokens.in
  const totalOut = digestTokens.out + coachTokens.out
  const spentUsd = totalIn * USD_PER_INPUT_TOKEN + totalOut * USD_PER_OUTPUT_TOKEN

  return {
    spentUsd,
    capUsd: NARRATOR_USD_PER_USER_WEEK,
    remainingUsd: Math.max(0, NARRATOR_USD_PER_USER_WEEK - spentUsd),
    overBudget: spentUsd >= NARRATOR_USD_PER_USER_WEEK,
    digestTokens,
    coachTokens,
  }
}

function currentWeekRangeUtc(): { weekStart: Date; weekEnd: Date } {
  const now = new Date()
  const day = now.getUTCDay() || 7
  const weekStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - day + 1,
    0, 0, 0, 0,
  ))
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1)
  return { weekStart, weekEnd }
}
