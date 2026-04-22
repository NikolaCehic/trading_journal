export type TagKind = 'setup' | 'mistake'
export type EmotionalState = 'calm' | 'fomo' | 'revenge' | 'bored' | 'anxious' | 'confident'

export type SetupTag = { id: string; label: string; color: string | null; isArchived: boolean }
export type MistakeTag = { id: string; label: string; color: string | null; isDefault: boolean; isArchived: boolean }

export type TradeNote = {
  id: string
  userId: string
  positionId: string
  bodyMarkdown: string
  updatedAt: Date
}

export type PositionTagRef = {
  id: string
  kind: TagKind
  setupTagId: string | null
  mistakeTagId: string | null
}

export type PositionReflection = {
  id: string
  userId: string
  positionId: string
  confidence: number | null        // 1..5
  emotionalState: EmotionalState | null
  reflectionMarkdown: string | null
  updatedAt: Date
}

/** Starter set seeded on first sign-in. User can archive or add to. */
export const DEFAULT_MISTAKE_TAGS: Array<{ label: string; color: string }> = [
  { label: 'Overtrading',      color: '#dc2626' },
  { label: 'Revenge trade',    color: '#dc2626' },
  { label: 'Oversized',        color: '#ea580c' },
  { label: 'Chased entry',     color: '#ea580c' },
  { label: 'Moved stop',       color: '#f59e0b' },
  { label: 'Held too long',    color: '#f59e0b' },
  { label: 'Cut winner early', color: '#f59e0b' },
  { label: 'Traded news',      color: '#facc15' },
]
