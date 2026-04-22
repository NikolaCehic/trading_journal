import type { TradeDetailBundle } from '~/server/trades'
import { Badge } from '~/components/ui/badge'

const DETECTOR_LABELS: Record<string, string> = {
  revenge_trading: 'Revenge trading',
  oversized_positions: 'Oversized positions',
  loss_of_discipline_windows: 'Discipline windows',
  position_sizing_instability: 'Sizing instability',
  cut_winners_ride_losers: 'Cut winners, ride losers',
  overtrading_after_losses: 'Overtrading after losses',
  fee_drag: 'Fee drag',
  scaling_into_losers: 'Scaling into losers',
  short_hold_scalping: 'Short-hold scalping',
  symbol_underperformance: 'Symbol underperformance',
  leverage_creep: 'Leverage creep',
}

export function FindingsTab({ bundle }: { bundle: TradeDetailBundle }) {
  if (bundle.findings.length === 0) {
    return <p className="mt-4 text-sm text-neutral-500">No findings reference this trade.</p>
  }
  return (
    <div className="mt-2 flex flex-col gap-3">
      {bundle.findings.map(f => (
        <article key={f.id} className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{DETECTOR_LABELS[f.detectorId] ?? f.detectorId}</span>
              <Badge variant="outline" className="text-[10px]">{f.severity}</Badge>
            </div>
          </div>
          <h4 className="text-sm text-neutral-200 mb-1">{f.title}</h4>
          <p className="text-sm text-neutral-400 whitespace-pre-wrap">{f.bodyMarkdown}</p>
        </article>
      ))}
    </div>
  )
}
