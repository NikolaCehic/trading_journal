import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DemoReadonlyError } from '~/auth/assertNotDemo'
import { toastError } from './toastError'

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
  },
}))

// Import the mocked toast after vi.mock so we can assert on it.
import { toast } from 'sonner'

describe('toastError', () => {
  beforeEach(() => {
    vi.mocked(toast.info).mockClear()
    vi.mocked(toast.error).mockClear()
  })

  it('routes DemoReadonlyError to toast.info with the friendly string', () => {
    toastError(new DemoReadonlyError())
    expect(toast.info).toHaveBeenCalledTimes(1)
    expect(toast.info).toHaveBeenCalledWith("Sign in to save changes — you're in demo mode.")
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('treats any object with code === "demo_mode_readonly" as demo (duck-typed)', () => {
    // Not an instance of DemoReadonlyError, but matches by code.
    const err = { code: 'demo_mode_readonly', message: 'whatever' }
    toastError(err)
    expect(toast.info).toHaveBeenCalledTimes(1)
    expect(toast.info).toHaveBeenCalledWith("Sign in to save changes — you're in demo mode.")
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('calls toast.error with err.message for a generic Error', () => {
    toastError(new Error('boom'))
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('boom')
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('prepends opts.prefix for generic Error', () => {
    toastError(new Error('boom'), { prefix: 'Save plan' })
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Save plan: boom')
  })

  it('falls back to "Something went wrong" for non-Error throwables', () => {
    toastError('string error')
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Something went wrong')
  })

  it('applies the prefix to the fallback message too', () => {
    toastError('string error', { prefix: 'Save plan' })
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Save plan: Something went wrong')
  })
})
