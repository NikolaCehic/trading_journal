import { describe, it, expect, vi } from 'vitest'
import { log } from './log'

describe('log', () => {
  it('emits structured JSON with level, message, and context', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    log.info('hello', { userId: 'u_123' })

    expect(spy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(spy.mock.calls[0]![0] as string)
    expect(payload.level).toBe('info')
    expect(payload.msg).toBe('hello')
    expect(payload.userId).toBe('u_123')
    expect(typeof payload.ts).toBe('string')
    spy.mockRestore()
  })

  it('emits error via console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    log.error('bad', { err: 'boom' })
    expect(spy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(spy.mock.calls[0]![0] as string)
    expect(payload.level).toBe('error')
    expect(payload.err).toBe('boom')
    spy.mockRestore()
  })
})
