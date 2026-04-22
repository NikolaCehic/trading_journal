import type { DigestFactBundle, CoachFactBundle } from '~/narrator/facts/types'
import type { DigestNarrative, CoachNarrative } from './schemas'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUsd(n: number): string {
  if (n === 0) return '$0'
  const abs = Math.abs(n).toFixed(2)
  return n > 0 ? `+$${abs}` : `-$${abs}`
}

// ---------------------------------------------------------------------------
// digestFallback
// ---------------------------------------------------------------------------

export function digestFallback(facts: DigestFactBundle): DigestNarrative {
  const { period, summary, biggestWin, biggestLoss, topFinding } = facts

  const greeting =
    `Week of ${period.start}. Net P&L ${formatUsd(summary.totalPnl)}. ` +
    `${summary.tradeCount} trades, win rate ${summary.winRate}.`

  const biggestWinSection =
    biggestWin !== null
      ? {
          positionId: biggestWin.positionId,
          prose:
            `${biggestWin.symbol} ${biggestWin.side} closed ${formatUsd(biggestWin.realizedPnl)}.` +
            (biggestWin.rMultiple !== null ? ` R-multiple: ${biggestWin.rMultiple}.` : ''),
        }
      : null

  const biggestLossSection =
    biggestLoss !== null
      ? {
          positionId: biggestLoss.positionId,
          prose:
            `${biggestLoss.symbol} ${biggestLoss.side} closed ${formatUsd(biggestLoss.realizedPnl)}.` +
            (biggestLoss.rMultiple !== null ? ` R-multiple: ${biggestLoss.rMultiple}.` : ''),
        }
      : null

  const topFindingSection =
    topFinding !== null
      ? {
          findingId: topFinding.findingId,
          prose: `Detector ${topFinding.detectorId} fired (${topFinding.severity}).`,
        }
      : null

  return {
    greeting,
    biggestWin: biggestWinSection,
    biggestLoss: biggestLossSection,
    topFinding: topFindingSection,
    oneThingToTry: null,
    suggestedRule: null,
  }
}

// ---------------------------------------------------------------------------
// coachFallback
// ---------------------------------------------------------------------------

export function coachFallback(facts: CoachFactBundle): CoachNarrative {
  const { position, userBaselines } = facts

  const prose =
    `${position.symbol} ${position.side}: entry ${position.entryAvg}, exit ${position.exitAvg}, ` +
    `P&L ${formatUsd(position.realizedPnl)}, duration ${position.durationMinutes} min. ` +
    `Baseline win rate ${userBaselines.winRate}, median R ${userBaselines.medianR}.`

  // Grade based purely on whether P&L is positive vs negative
  const gradeLetter: CoachNarrative['gradeLetter'] =
    position.realizedPnl >= 0 ? 'C' : 'D'

  return {
    gradeLetter,
    prose,
    referencedPositionIds: [],
    referencedFindingIds: [],
  }
}
