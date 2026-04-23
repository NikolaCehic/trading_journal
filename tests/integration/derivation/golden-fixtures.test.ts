import { describe, it, expect } from 'vitest'
import { loadHlFixture } from '~/../tests/_support/fixtures'
import { mergeFillsIntoPositions } from '~/derivation/merge'
import { computeDailyMetrics } from '~/derivation/metrics/daily'
import { computeAssetMetrics } from '~/derivation/metrics/asset'
import { computeSessionMetrics } from '~/derivation/metrics/session'
import { computeSummaryRollup } from '~/derivation/metrics/summary'
import { DETECTORS } from '~/derivation/detectors'
import type { DerivationContext } from '~/derivation/detectors/types'

type Case = { fixture: string; expect: string | null; now?: Date }

const CASES: Case[] = [
  { fixture: 'steady-discipline.csv',      expect: null },
  { fixture: 'revenge-trader.csv',         expect: 'revenge_trading' },
  { fixture: 'size-bloater.csv',           expect: 'oversized_positions' },
  { fixture: 'evening-tilt.csv',           expect: 'loss_of_discipline_windows' },
  { fixture: 'size-drift.csv',             expect: 'position_sizing_instability', now: new Date('2024-03-02T00:00Z') },
  { fixture: 'winner-cutter.csv',          expect: 'cut_winners_ride_losers' },
  { fixture: 'loss-chaser.csv',            expect: 'overtrading_after_losses' },
  { fixture: 'fee-bleed.csv',              expect: 'fee_drag' },
  { fixture: 'pyramid-losers.csv',         expect: 'scaling_into_losers' },
  { fixture: 'scalp-gambler.csv',          expect: 'short_hold_scalping' },
  { fixture: 'bad-ticker.csv',             expect: 'symbol_underperformance' },
  { fixture: 'leverage-creep.csv',         expect: 'leverage_creep',           now: new Date('2024-03-02T00:00Z') },
]

describe.each(CASES)('golden fixture: $fixture', ({ fixture, expect: expected, now }) => {
  it(`${expected ? `fires ${expected}` : 'fires nothing'}`, () => {
    const fills = loadHlFixture(fixture)
    const positions = mergeFillsIntoPositions('u1', fills, 1)
    const daily = computeDailyMetrics(positions)
    const asset = computeAssetMetrics(positions)
    const session = computeSessionMetrics(positions)
    const summary = computeSummaryRollup(positions, daily)
    const ctx: DerivationContext = {
      userId: 'u1', derivationVersion: 1,
      now: now ?? new Date('2024-02-01T00:00Z'),
      fills, positions, planMap: new Map(), daily, asset, session, summary,
    }
    const findings = DETECTORS.flatMap(d => d.run(ctx))
    const ids = findings.map(f => f.detectorId)
    if (expected === null) {
      expect(ids, `steady-discipline should fire nothing, got ${ids.join(', ')}`).toHaveLength(0)
    } else {
      expect(ids, `expected ${expected} in ${ids.join(', ') || '(none)'}`).toContain(expected)
    }
  })
})
