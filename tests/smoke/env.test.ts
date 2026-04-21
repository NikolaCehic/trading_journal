import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('env validation', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('throws when required vars are missing', async () => {
    const original = {
      DATABASE_URL: process.env['DATABASE_URL'],
      BETTER_AUTH_SECRET: process.env['BETTER_AUTH_SECRET'],
    }
    delete process.env['DATABASE_URL']
    delete process.env['BETTER_AUTH_SECRET']

    try {
      await expect(import('~/lib/env')).rejects.toThrow()
    } finally {
      if (original.DATABASE_URL) process.env['DATABASE_URL'] = original.DATABASE_URL
      if (original.BETTER_AUTH_SECRET) process.env['BETTER_AUTH_SECRET'] = original.BETTER_AUTH_SECRET
    }
  })
})
