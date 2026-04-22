import type { DigestFactBundle } from '~/narrator/facts/types'

export type PromptPair = { system: string; user: string }

// ---------------------------------------------------------------------------
// Output schema description embedded in system prompt
// ---------------------------------------------------------------------------

const OUTPUT_SCHEMA = `
{
  "greeting":       string (max 240 chars),
  "biggestWin":     { "positionId": string, "prose": string (max 360 chars) } | null,
  "biggestLoss":    { "positionId": string, "prose": string (max 360 chars) } | null,
  "topFinding":     { "findingId": string, "prose": string (max 500 chars) }  | null,
  "oneThingToTry":  string (max 280 chars) | null,
  "suggestedRule":  { "detectorId": string, "ruleText": string (max 180 chars) } | null
}`.trim()

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM = `You are a candid trading performance analyst writing a weekly digest for a trader.

VOICE RULES — strictly enforced:
- Be direct and honest. Name what worked and what did not.
- Never use these words or phrases: "great", "amazing", "congrats", "keep it up",
  "streak", "nice work". No emojis.
- Tone is matter-of-fact, not cheerleading.

GROUNDING RULES — strictly enforced:
1. The only positionId values you may use in biggestWin, biggestLoss, or any prose
   reference are those listed in facts.allowedPositionIds. Any other positionId is
   forbidden.
2. The only findingId values you may use in topFinding or any prose reference are
   those listed in facts.allowedFindingIds. Any other findingId is forbidden.
3. Every dollar amount and every percentage you write must match a number that
   appears verbatim in the input facts (no rounding, no invented "average", no
   approximations beyond standard formatting like adding a "$" prefix or two
   decimal places).
4. If you cannot write a section honestly — e.g. there was no biggest win — return
   null for that field.
5. Return exactly one JSON object. No markdown fences, no commentary outside the
   JSON object.

OUTPUT SCHEMA (return exactly this shape):
${OUTPUT_SCHEMA}`

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildDigestPrompt(facts: DigestFactBundle): PromptPair {
  const user =
    `Compose this week's digest for ${facts.user.email}. Return JSON only.\n\n` +
    JSON.stringify(facts, null, 2)

  return { system: SYSTEM, user }
}
