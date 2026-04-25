import type { DigestNarrative } from './schemas'

const MAX_LEN = 280

/**
 * Extract a 1–3 sentence summary suitable for the Dashboard Insight card.
 * Picks the most actionable single string from the structured digest narrative
 * in priority order:
 *   1. topFinding.prose
 *   2. oneThingToTry
 *   3. greeting
 */
export function extractDigestSummary(
  narrative: DigestNarrative | null | undefined,
): string | null {
  if (!narrative || typeof narrative !== 'object' || Array.isArray(narrative)) {
    return null
  }
  const candidates: Array<string | undefined | null> = [
    narrative.topFinding?.prose,
    narrative.oneThingToTry,
    narrative.greeting,
  ]
  for (const c of candidates) {
    const trimmed = (c ?? '').trim()
    if (trimmed.length > 0) return capAtSentence(trimmed, MAX_LEN)
  }
  return null
}

function capAtSentence(text: string, max: number): string {
  if (text.length <= max) return text
  const parts = text.match(/[^.!?]+[.!?]+/g)
  if (!parts || parts.length === 0) {
    return text.slice(0, max - 1).trimEnd() + '…'
  }
  let out = ''
  for (const sentence of parts) {
    const next = out + sentence
    if (next.length > max) break
    out = next
  }
  if (out.length === 0) return text.slice(0, max - 1).trimEnd() + '…'
  return out.trim()
}
