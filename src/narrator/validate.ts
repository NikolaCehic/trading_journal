import {
  DigestNarrativeSchema,
  CoachNarrativeSchema,
  type DigestNarrative,
  type CoachNarrative,
} from './schemas'
import type { DigestFactBundle, CoachFactBundle } from './facts/types'

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; offendingText?: string }

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const BANNED_PHRASES = [
  'great',
  'amazing',
  'congrats',
  'keep it up',
  'streak',
  'nice work',
]

/** Regex that matches numeric-looking tokens (with optional $, %, sign, commas). */
const NUMBER_RE = /(?<![.\w])[-−]?\$?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?/g

/**
 * Build the set of "allowed" number strings from a facts bundle.
 *
 * Strategy:
 * 1. Stringify the entire facts object and extract every NUMBER_RE match.
 * 2. For every raw JS number found in the facts JSON, also add
 *    Math.round(n), n.toFixed(0), n.toFixed(2) variants to tolerate normal
 *    presentation formatting.
 */
function buildAllowedNumbers(facts: unknown): Set<string> {
  const raw = JSON.stringify(facts)
  const allowed = new Set<string>()

  // All literal numeric substrings as they appear in the JSON
  for (const m of raw.matchAll(NUMBER_RE)) {
    allowed.add(m[0]!)
  }

  // Walk the JSON to find all JS numbers and add formatted variants
  function visitNumbers(node: unknown): void {
    if (typeof node === 'number') {
      allowed.add(String(node))
      allowed.add(String(Math.round(node)))
      allowed.add(node.toFixed(0))
      allowed.add(node.toFixed(2))
    } else if (Array.isArray(node)) {
      node.forEach(visitNumbers)
    } else if (node !== null && typeof node === 'object') {
      Object.values(node as Record<string, unknown>).forEach(visitNumbers)
    }
  }
  visitNumbers(facts)

  // Always allow trivial counts
  allowed.add('0')
  allowed.add('1')

  return allowed
}

/**
 * Check every number extracted from a prose string against the allowed set.
 * Returns the first offending number or null if all pass.
 */
function findUngroundedNumber(prose: string, allowed: Set<string>): string | null {
  for (const m of prose.matchAll(NUMBER_RE)) {
    const token = m[0]!
    // Strip trailing % and leading $ for a bare-number lookup as well
    const stripped = token.replace(/^\$/, '').replace(/%$/, '')
    if (!allowed.has(token) && !allowed.has(stripped)) {
      return token
    }
  }
  return null
}

/**
 * Scan prose for banned voice phrases (case-insensitive).
 * Returns the matched phrase or null.
 */
function findBannedPhrase(prose: string): string | null {
  const lower = prose.toLowerCase()
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) return phrase
  }
  return null
}

// ---------------------------------------------------------------------------
// Collect all prose strings from a digest narrative
// ---------------------------------------------------------------------------

function digestProseStrings(n: DigestNarrative): string[] {
  return [
    n.greeting,
    n.biggestWin?.prose,
    n.biggestLoss?.prose,
    n.topFinding?.prose,
    n.oneThingToTry,
    n.suggestedRule?.ruleText,
  ].filter((s): s is string => typeof s === 'string')
}

// ---------------------------------------------------------------------------
// validateDigestNarrative
// ---------------------------------------------------------------------------

export function validateDigestNarrative(
  raw: unknown,
  facts: DigestFactBundle,
): ValidationResult<DigestNarrative> {
  // 1. Schema validation
  const parsed = DigestNarrativeSchema.safeParse(raw)
  if (!parsed.success) {
    const summary = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    return { ok: false, error: `schema: ${summary}` }
  }

  const narrative = parsed.data

  // 2. ID grounding
  const allowedPos = new Set(facts.allowedPositionIds)
  const allowedFinding = new Set(facts.allowedFindingIds)

  const posIdsToCheck: string[] = [
    narrative.biggestWin?.positionId,
    narrative.biggestLoss?.positionId,
  ].filter((id): id is string => typeof id === 'string')

  for (const id of posIdsToCheck) {
    if (!allowedPos.has(id)) {
      return { ok: false, error: 'ungrounded_id', offendingText: id }
    }
  }

  if (narrative.topFinding !== null) {
    const fid = narrative.topFinding.findingId
    if (!allowedFinding.has(fid)) {
      return { ok: false, error: 'ungrounded_id', offendingText: fid }
    }
  }

  // Note: suggestedRule.detectorId is a DetectorId string (not an ID from the
  // allowlists), so we do not check it against allowedPositionIds /
  // allowedFindingIds — the schema already enforces min(1).

  // 3. Number grounding
  const allowedNumbers = buildAllowedNumbers(facts)
  for (const prose of digestProseStrings(narrative)) {
    const offending = findUngroundedNumber(prose, allowedNumbers)
    if (offending !== null) {
      return { ok: false, error: 'ungrounded_number', offendingText: offending }
    }
  }

  // 4. Banned voice
  for (const prose of digestProseStrings(narrative)) {
    const phrase = findBannedPhrase(prose)
    if (phrase !== null) {
      return { ok: false, error: 'banned_voice', offendingText: phrase }
    }
  }

  return { ok: true, value: narrative }
}

// ---------------------------------------------------------------------------
// Collect all prose strings from a coach narrative
// ---------------------------------------------------------------------------

function coachProseStrings(n: CoachNarrative): string[] {
  return [n.prose]
}

// ---------------------------------------------------------------------------
// validateCoachNarrative
// ---------------------------------------------------------------------------

export function validateCoachNarrative(
  raw: unknown,
  facts: CoachFactBundle,
): ValidationResult<CoachNarrative> {
  // 1. Schema validation
  const parsed = CoachNarrativeSchema.safeParse(raw)
  if (!parsed.success) {
    const summary = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    return { ok: false, error: `schema: ${summary}` }
  }

  const narrative = parsed.data

  // 2. ID grounding
  const allowedPos = new Set(facts.allowedPositionIds)
  const allowedFinding = new Set(facts.allowedFindingIds)

  for (const id of narrative.referencedPositionIds) {
    if (!allowedPos.has(id)) {
      return { ok: false, error: 'ungrounded_id', offendingText: id }
    }
  }

  for (const id of narrative.referencedFindingIds) {
    if (!allowedFinding.has(id)) {
      return { ok: false, error: 'ungrounded_id', offendingText: id }
    }
  }

  // 3. Number grounding
  const allowedNumbers = buildAllowedNumbers(facts)
  for (const prose of coachProseStrings(narrative)) {
    const offending = findUngroundedNumber(prose, allowedNumbers)
    if (offending !== null) {
      return { ok: false, error: 'ungrounded_number', offendingText: offending }
    }
  }

  // 4. Banned voice
  for (const prose of coachProseStrings(narrative)) {
    const phrase = findBannedPhrase(prose)
    if (phrase !== null) {
      return { ok: false, error: 'banned_voice', offendingText: phrase }
    }
  }

  return { ok: true, value: narrative }
}
