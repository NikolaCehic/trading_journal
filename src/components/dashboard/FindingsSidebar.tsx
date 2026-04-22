import type { DashboardBundle } from '~/domain/dashboard'
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

export function FindingsSidebar({ bundle }: { bundle: DashboardBundle }) {
  const findings = bundle.topFindings
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <h3 className="text-sm font-medium mb-3">Active findings</h3>
      {findings.length === 0 ? (
        <p className="text-sm text-neutral-500">No active findings. Keep trading — patterns emerge over time.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {findings.map(f => (
            <li key={f.id} className="border-b border-neutral-800 last:border-b-0 pb-3 last:pb-0">
              <div className="flex items-start gap-2">
                <SeverityDot severity={f.severity} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-neutral-300">
                      {DETECTOR_LABELS[f.detectorId] ?? f.detectorId}
                    </span>
                    <Badge variant="outline" className="text-[10px]">{f.severity}</Badge>
                  </div>
                  <p className="text-xs text-neutral-400 mt-1 line-clamp-3">{f.bodyMarkdown}</p>
                  {f.referencedPositionIds.length > 0 && (
                    <a
                      href={`/trades/${f.referencedPositionIds[0]}`}
                      className="text-xs text-brand hover:underline mt-1 inline-block"
                    >
                      Open related trade →
                    </a>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SeverityDot({ severity }: { severity: string }) {
  const cls =
    severity === 'critical' ? 'bg-pnl-loss' :
    severity === 'warning' ? 'bg-brand' : 'bg-neutral-500'
  return <span className={`mt-1 h-2 w-2 rounded-full ${cls} shrink-0`} aria-label={severity} />
}
