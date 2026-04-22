import type { DashboardBundle } from '~/domain/dashboard'
import { usd } from '~/lib/formatters'

function cellColor(expectancy: number, maxAbs: number): string {
  if (maxAbs === 0) return 'rgb(38,38,38)'
  const ratio = Math.max(-1, Math.min(1, expectancy / maxAbs))
  if (ratio > 0) {
    const alpha = (0.15 + 0.65 * ratio).toFixed(2)
    return `rgba(22,163,74,${alpha})`
  }
  const alpha = (0.15 + 0.65 * Math.abs(ratio)).toFixed(2)
  return `rgba(220,38,38,${alpha})`
}

export function TimeOfDayHeatmapCard({ bundle }: { bundle: DashboardBundle }) {
  const rows = Array.from({ length: 24 }, (_, h) => {
    const s = bundle.sessionBreakdown.find(x => x.hourOfDayUtc === h)
    return { hour: h, tradeCount: s?.tradeCount ?? 0, expectancy: s?.expectancy ?? 0 }
  })
  const maxAbs = rows.reduce((m, r) => Math.max(m, Math.abs(r.expectancy)), 0)

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <h3 className="text-sm font-medium mb-3">Time of day (UTC)</h3>
      <div className="grid grid-cols-24 gap-1">
        {rows.map(r => (
          <div
            key={r.hour}
            title={`${r.hour.toString().padStart(2, '0')}:00 — ${r.tradeCount} trades · exp ${usd(r.expectancy, { signed: true })}`}
            className="aspect-square rounded flex items-center justify-center text-[10px] font-mono tabular-nums text-neutral-200"
            style={{ backgroundColor: cellColor(r.expectancy, maxAbs) }}
          >
            {r.tradeCount > 0 ? r.tradeCount : ''}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-neutral-500 font-mono tabular-nums">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
      </div>
    </div>
  )
}
