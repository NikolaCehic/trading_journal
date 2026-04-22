import { describe, it, expect } from 'vitest'
import { z } from 'zod'

describe('journal validator shapes', () => {
  it('applyPositionTag requires matching id for kind', () => {
    const input = z.object({
      positionIds: z.array(z.string().min(1)).min(1).max(200),
      kind: z.enum(['setup', 'mistake']),
      setupTagId: z.string().optional(),
      mistakeTagId: z.string().optional(),
    }).refine(
      d => (d.kind === 'setup' && !!d.setupTagId) || (d.kind === 'mistake' && !!d.mistakeTagId),
    )
    expect(() => input.parse({ positionIds: ['p1'], kind: 'setup' })).toThrow()
    expect(() => input.parse({ positionIds: ['p1'], kind: 'setup', setupTagId: 'st1' })).not.toThrow()
    expect(() => input.parse({ positionIds: ['p1'], kind: 'mistake', mistakeTagId: 'mt1' })).not.toThrow()
  })

  it('upsertTradeNote rejects bodyMarkdown over 20 000 chars', () => {
    const input = z.object({
      positionId: z.string().min(1),
      bodyMarkdown: z.string().max(20_000),
    })
    expect(() => input.parse({ positionId: 'p1', bodyMarkdown: 'a'.repeat(20_001) })).toThrow()
    expect(() => input.parse({ positionId: 'p1', bodyMarkdown: 'hello' })).not.toThrow()
  })

  it('createTag rejects invalid hex color', () => {
    const input = z.object({
      kind: z.enum(['setup', 'mistake']),
      label: z.string().min(1).max(60),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    })
    expect(() => input.parse({ kind: 'setup', label: 'Breakout', color: 'red' })).toThrow()
    expect(() => input.parse({ kind: 'setup', label: 'Breakout', color: '#ff0000' })).not.toThrow()
    expect(() => input.parse({ kind: 'setup', label: 'Breakout' })).not.toThrow()
  })

  it('upsertReflection confidence must be 1..5', () => {
    const input = z.object({
      positionId: z.string().min(1),
      confidence: z.number().int().min(1).max(5).nullable(),
      emotionalState: z.enum(['calm', 'fomo', 'revenge', 'bored', 'anxious', 'confident']).nullable(),
      reflectionMarkdown: z.string().max(5_000).nullable(),
    })
    expect(() => input.parse({ positionId: 'p1', confidence: 0, emotionalState: null, reflectionMarkdown: null })).toThrow()
    expect(() => input.parse({ positionId: 'p1', confidence: 6, emotionalState: null, reflectionMarkdown: null })).toThrow()
    expect(() => input.parse({ positionId: 'p1', confidence: 3, emotionalState: 'calm', reflectionMarkdown: null })).not.toThrow()
    expect(() => input.parse({ positionId: 'p1', confidence: null, emotionalState: null, reflectionMarkdown: null })).not.toThrow()
  })
})
