import type { DigestFactBundle, CoachFactBundle } from '~/narrator/facts/types'
import type { DigestNarrative, CoachNarrative } from '~/narrator/schemas'
import { buildDigestPrompt } from '~/narrator/prompts/digest'
import { buildCoachPrompt } from '~/narrator/prompts/coach'
import { validateDigestNarrative, validateCoachNarrative } from '~/narrator/validate'
import { callLlm } from './client'
import { digestFallback, coachFallback } from './fallback'
import { env } from '~/lib/env'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ComposeResult<T> = {
  narrative: T
  tokensIn: number
  tokensOut: number
  retried: boolean
  failed: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// JSON extraction helper
// ---------------------------------------------------------------------------

function extractJson(content: string): unknown {
  // First try parsing directly
  try {
    return JSON.parse(content)
  } catch {
    // Try to extract first {...} block from prose-wrapped response
    const match = content.match(/\{[\s\S]*\}/)?.[0] ?? '{}'
    try {
      return JSON.parse(match)
    } catch {
      return {}
    }
  }
}

// ---------------------------------------------------------------------------
// composeDigest
// ---------------------------------------------------------------------------

export async function composeDigest(
  facts: DigestFactBundle,
): Promise<ComposeResult<DigestNarrative>> {
  if (env.AI_ENABLED === 'off') {
    return {
      narrative: digestFallback(facts),
      tokensIn: 0,
      tokensOut: 0,
      retried: false,
      failed: true,
      error: 'ai_disabled',
    }
  }

  const prompt = buildDigestPrompt(facts)
  let tokensIn = 0
  let tokensOut = 0

  // First attempt
  const first = await callLlm({ system: prompt.system, user: prompt.user })
  tokensIn += first.usage.tokensIn
  tokensOut += first.usage.tokensOut

  const firstParsed = extractJson(first.content)
  const firstResult = validateDigestNarrative(firstParsed, facts)

  if (firstResult.ok) {
    return {
      narrative: firstResult.value,
      tokensIn,
      tokensOut,
      retried: false,
      failed: false,
    }
  }

  // Retry with stricter prompt
  const previousError = firstResult.error
  const stricterUser =
    prompt.user +
    '\n\nReturn ONLY the JSON object. No prose. Match the schema exactly. Reason previous attempt failed: ' +
    previousError

  const second = await callLlm({
    system: prompt.system,
    user: stricterUser,
    temperature: 0.3,
  })
  tokensIn += second.usage.tokensIn
  tokensOut += second.usage.tokensOut

  const secondParsed = extractJson(second.content)
  const secondResult = validateDigestNarrative(secondParsed, facts)

  if (secondResult.ok) {
    return {
      narrative: secondResult.value,
      tokensIn,
      tokensOut,
      retried: true,
      failed: false,
    }
  }

  return {
    narrative: digestFallback(facts),
    tokensIn,
    tokensOut,
    retried: true,
    failed: true,
    error: secondResult.error,
  }
}

// ---------------------------------------------------------------------------
// composeCoach
// ---------------------------------------------------------------------------

export async function composeCoach(
  facts: CoachFactBundle,
): Promise<ComposeResult<CoachNarrative>> {
  if (env.AI_ENABLED === 'off') {
    return {
      narrative: coachFallback(facts),
      tokensIn: 0,
      tokensOut: 0,
      retried: false,
      failed: true,
      error: 'ai_disabled',
    }
  }

  const prompt = buildCoachPrompt(facts)
  let tokensIn = 0
  let tokensOut = 0

  // First attempt
  const first = await callLlm({ system: prompt.system, user: prompt.user })
  tokensIn += first.usage.tokensIn
  tokensOut += first.usage.tokensOut

  const firstParsed = extractJson(first.content)
  const firstResult = validateCoachNarrative(firstParsed, facts)

  if (firstResult.ok) {
    return {
      narrative: firstResult.value,
      tokensIn,
      tokensOut,
      retried: false,
      failed: false,
    }
  }

  // Retry with stricter prompt
  const previousError = firstResult.error
  const stricterUser =
    prompt.user +
    '\n\nReturn ONLY the JSON object. No prose. Match the schema exactly. Reason previous attempt failed: ' +
    previousError

  const second = await callLlm({
    system: prompt.system,
    user: stricterUser,
    temperature: 0.3,
  })
  tokensIn += second.usage.tokensIn
  tokensOut += second.usage.tokensOut

  const secondParsed = extractJson(second.content)
  const secondResult = validateCoachNarrative(secondParsed, facts)

  if (secondResult.ok) {
    return {
      narrative: secondResult.value,
      tokensIn,
      tokensOut,
      retried: true,
      failed: false,
    }
  }

  return {
    narrative: coachFallback(facts),
    tokensIn,
    tokensOut,
    retried: true,
    failed: true,
    error: secondResult.error,
  }
}
