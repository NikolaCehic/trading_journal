import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRateLimiter } from '~/market/binance-klines'

// ---------------------------------------------------------------------------
// All tests use a small limiter: 5 req per 1000ms
// ---------------------------------------------------------------------------

describe('createRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows the first N requests immediately (no waiting)', async () => {
    const throttle = createRateLimiter(5, 1_000)
    const resolved: number[] = []

    // Fire 5 requests sequentially — each should resolve without advancing the clock
    for (let i = 0; i < 5; i++) {
      await throttle()
      resolved.push(i)
    }

    expect(resolved).toEqual([0, 1, 2, 3, 4])
  })

  it('the (N+1)th request waits until the oldest entry exits the window', async () => {
    const throttle = createRateLimiter(5, 1_000)

    // Fill the window at t=0
    for (let i = 0; i < 5; i++) {
      await throttle()
    }

    let resolved = false
    const p = throttle().then(() => { resolved = true })

    // Advance a tiny bit — still within the window, should not resolve
    await vi.advanceTimersByTimeAsync(500)
    expect(resolved).toBe(false)

    // Advance past the full window (1000ms + 10ms safety margin)
    await vi.advanceTimersByTimeAsync(520)  // total ~1030ms

    await p
    expect(resolved).toBe(true)
  })

  it('resets after the window expires — another N requests go through immediately', async () => {
    const throttle = createRateLimiter(5, 1_000)

    // Fill the window
    for (let i = 0; i < 5; i++) {
      await throttle()
    }

    // Advance 1010ms — window fully expired
    await vi.advanceTimersByTimeAsync(1_010)

    // Next 5 should all resolve immediately (no timer needed)
    const resolved: number[] = []
    for (let i = 0; i < 5; i++) {
      await throttle()
      resolved.push(i)
    }
    expect(resolved).toEqual([0, 1, 2, 3, 4])
  })

  it('concurrent callers when window is full serialize correctly — all eventually resolve', async () => {
    const throttle = createRateLimiter(5, 1_000)

    // Fill the window
    for (let i = 0; i < 5; i++) {
      await throttle()
    }

    // Launch 10 concurrent callers
    const results: number[] = []
    const promises = Array.from({ length: 10 }, (_, i) =>
      throttle().then(() => { results.push(i) })
    )

    // Advance enough time for all to drain (2 more windows = 2 * 1010ms)
    await vi.advanceTimersByTimeAsync(3_000)
    await Promise.all(promises)

    // All 10 must have resolved
    expect(results).toHaveLength(10)
    // Each index appears exactly once
    expect(results.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('isolated instances do not share state', async () => {
    const limiterA = createRateLimiter(2, 1_000)
    const limiterB = createRateLimiter(2, 1_000)

    // Fill limiterA
    await limiterA()
    await limiterA()

    // limiterB should still allow requests independently (window not full)
    let resolvedB = false
    const p = limiterB().then(() => { resolvedB = true })
    // limiterB hasn't been touched, first call resolves immediately
    await vi.advanceTimersByTimeAsync(0)
    await p
    expect(resolvedB).toBe(true)
  })
})
