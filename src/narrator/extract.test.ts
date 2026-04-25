import { describe, it, expect } from 'vitest'
import { extractDigestSummary } from './extract'

describe('extractDigestSummary', () => {
  it('returns topFinding.prose when present', () => {
    const result = extractDigestSummary({
      greeting: 'Hello.',
      biggestWin: null,
      biggestLoss: null,
      topFinding: { findingId: 'f1', prose: 'You revenge-traded after losses three times this week.' },
      oneThingToTry: 'Wait 30 minutes after a loss.',
      suggestedRule: null,
    })
    expect(result).toBe('You revenge-traded after losses three times this week.')
  })

  it('falls back to oneThingToTry when topFinding is null', () => {
    const result = extractDigestSummary({
      greeting: 'Hello.',
      biggestWin: null,
      biggestLoss: null,
      topFinding: null,
      oneThingToTry: 'Wait 30 minutes after any loss.',
      suggestedRule: null,
    })
    expect(result).toBe('Wait 30 minutes after any loss.')
  })

  it('falls back to greeting when topFinding and oneThingToTry are null', () => {
    const result = extractDigestSummary({
      greeting: 'Welcome back. You took 11 trades this week.',
      biggestWin: null,
      biggestLoss: null,
      topFinding: null,
      oneThingToTry: null,
      suggestedRule: null,
    })
    expect(result).toBe('Welcome back. You took 11 trades this week.')
  })

  it('returns null when narrative is null', () => {
    expect(extractDigestSummary(null)).toBeNull()
  })

  it('returns null when every priority field is empty/null', () => {
    expect(extractDigestSummary({
      greeting: '',
      biggestWin: null,
      biggestLoss: null,
      topFinding: null,
      oneThingToTry: null,
      suggestedRule: null,
    })).toBeNull()
  })

  it('caps long topFinding.prose at 280 chars on a sentence boundary', () => {
    const long =
      'First sentence has decent length and tells the user something useful. ' +
      'Second sentence continues the analysis with another full thought here. ' +
      'Third sentence is the one that pushes the narrative past the 280 char cap.'
    const result = extractDigestSummary({
      greeting: 'Hi',
      biggestWin: null,
      biggestLoss: null,
      topFinding: { findingId: 'f1', prose: long },
      oneThingToTry: null,
      suggestedRule: null,
    })
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThanOrEqual(280)
    expect(result!.endsWith('.')).toBe(true)
  })

  it('handles unknown / unexpected narrative shapes by returning null', () => {
    expect(extractDigestSummary({} as unknown as Parameters<typeof extractDigestSummary>[0])).toBeNull()
    expect(extractDigestSummary('a string' as unknown as Parameters<typeof extractDigestSummary>[0])).toBeNull()
    expect(extractDigestSummary([] as unknown as Parameters<typeof extractDigestSummary>[0])).toBeNull()
  })
})
