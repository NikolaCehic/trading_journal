import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine,
} from 'recharts'
import type { DashboardBundle } from '~/domain/dashboard'
import { usd } from '~/lib/formatters'

export function EquityCurveCard({ bundle }: { bundle: DashboardBundle }) {
  const data = bundle.equityCurve
  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-500">
        No closed trades in this window. <span className="text-neutral-400">Try extending the date range.</span>
      </div>
    )
  }
  const minY = Math.min(0, ...data.map(d => d.cumulativePnl))
  const maxY = Math.max(0, ...data.map(d => d.cumulativePnl))
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">Equity curve</h3>
        <span className="text-xs text-neutral-500">cumulative realized PnL</span>
      </div>
      <div className="h-64">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="equity-gain" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#ea580c" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#ea580c" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#262626" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" stroke="#737373" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke="#737373" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => usd(v, { short: true })} domain={[minY, maxY]} />
            <Tooltip
              contentStyle={{ background: '#171717', border: '1px solid #404040', borderRadius: 6, fontSize: 12 }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(v: any) => typeof v === 'number' ? usd(v, { signed: true }) : String(v ?? '')}
              labelStyle={{ color: '#a3a3a3' }}
            />
            <ReferenceLine y={0} stroke="#525252" />
            <Area type="monotone" dataKey="cumulativePnl" stroke="#ea580c" fill="url(#equity-gain)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
