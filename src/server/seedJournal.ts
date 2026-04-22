import { DEFAULT_MISTAKE_TAGS } from '~/domain/journal'
import { mistakeTag } from '~/db/schema/journal'
import type { DB } from '~/db/client'

export async function ensureDefaultMistakeTags(db: DB, userId: string): Promise<void> {
  const rows = DEFAULT_MISTAKE_TAGS.map(t => ({
    id: `mt_${userId.slice(0, 8)}_${t.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    userId,
    label: t.label,
    color: t.color,
    isDefault: true,
    isArchived: false,
  }))
  await db.insert(mistakeTag).values(rows).onConflictDoNothing()
}
