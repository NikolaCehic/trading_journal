import { describe, it, expect, vi } from 'vitest'
import { ensureDefaultMistakeTags } from '~/server/seedJournal'
import { DEFAULT_MISTAKE_TAGS } from '~/domain/journal'

function mockDb() {
  const inserts: unknown[] = []
  return {
    inserts,
    insert: () => ({
      values: (rows: unknown) => ({
        onConflictDoNothing: async () => { inserts.push(rows); return { rowCount: 0 } },
      }),
    }),
  }
}

describe('ensureDefaultMistakeTags', () => {
  it('inserts the default mistake tag set with onConflictDoNothing', async () => {
    const db = mockDb()
    await ensureDefaultMistakeTags(db as never, 'u1')
    expect(db.inserts).toHaveLength(1)
    const rows = db.inserts[0] as Array<{ label: string; isDefault: boolean; userId: string }>
    expect(rows).toHaveLength(DEFAULT_MISTAKE_TAGS.length)
    expect(rows.every(r => r.userId === 'u1' && r.isDefault === true)).toBe(true)
    expect(rows[0]!.label).toBe(DEFAULT_MISTAKE_TAGS[0]!.label)
  })
})
