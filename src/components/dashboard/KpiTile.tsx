import { Line, LineChart, ResponsiveContainer } from 'recharts'
import type { DashboardKpiDelta } from '~/domain/dashboard'
import { deltaPct } from '~/lib/formatters'
import { cn } from '~/lib/utils'

export function KpiTile({
  label, kpi, format, sparkline, spark = true,
}: {
  label: string
  kpi: DashboardKpiDelta
  format: (v: number) => string
  sparkline?: Array<{ date: string; cumulativePnl: number }>
  spark?: boolean
}) {
  const deltaColor =
    kpi.deltaPct === null ? 'text-neutral-400' :
    kpi.deltaPct > 0 ? 'text-pnl-win' :
    kpi.deltaPct < 0 ? 'text-pnl-loss' : 'text-neutral-400'

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 flex flex-col gap-2 min-h-28">
      <div className="text-xs text-neutral-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-mono tabular-nums text-neutral-100">{format(kpi.value)}</div>
      <div className="flex items-center justify-between">
        <span className={cn('text-xs font-mono tabular-nums', deltaColor)}>{deltaPct(kpi.deltaPct)}</span>
        {spark && sparkline && sparkline.length > 1 && (
          <div className="h-8 w-20">
            <ResponsiveContainer>
              <LineChart data={sparkline}>
                <Line type="monotone" dataKey="cumulativePnl" stroke="#ea580c" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}
