import { describe, it, expect } from 'vitest'

describe('Phase 0 smoke', () => {
  it('env module loads', async () => {
    const mod = await import('~/lib/env')
    expect(mod.env).toBeDefined()
  })

  it('db client module loads', async () => {
    const mod = await import('~/db/client')
    expect(mod.db).toBeDefined()
  })

  it('auth server module loads', async () => {
    const mod = await import('~/auth/server')
    expect(mod.auth).toBeDefined()
  })

  it('inngest client module loads', async () => {
    const mod = await import('~/jobs/client')
    expect(mod.inngest).toBeDefined()
  })

  it('log module loads and emits', async () => {
    const { log } = await import('~/lib/log')
    expect(typeof log.info).toBe('function')
  })
})
