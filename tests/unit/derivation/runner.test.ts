import { describe, it, expect } from 'vitest'
import { loadHlFixture } from '~/../tests/_support/fixtures'
import { mergeFillsIntoPositions } from '~/derivation/merge'
import { computeDailyMetrics } from '~/derivation/metrics/daily'
import { computeAssetMetrics } from '~/derivation/metrics/asset'
import { computeSessionMetrics } from '~/derivation/metrics/session'
import { computeSummaryRollup } from '~/derivation/metrics/summary'
import { DETECTORS } from '~/derivation/detectors'
import type { DerivationContext } from '~/derivation/detectors/types'

describe('derivation runner (in-memory, no DB)', () => {
  it('steady-discipline fixture produces zero findings', () => {
    const fills = loadHlFixture('steady-discipline.csv')
    const positions = mergeFillsIntoPositions('u1', fills, 1)
    const daily = computeDailyMetrics(positions)
    const asset = computeAssetMetrics(positions)
    const session = computeSessionMetrics(positions)
    const summary = computeSummaryRollup(positions, daily)
    const ctx: DerivationContext = {
      userId: 'u1', derivationVersion: 1, now: new Date('2024-02-01'),
      fills, positions, daily, asset, session, summary,
    }
    const findings = DETECTORS.flatMap(d => d.run(ctx))
    expect(findings).toHaveLength(0)
  })
})
