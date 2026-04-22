import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DashboardBundle } from '~/domain/dashboard'
import { usd } from '~/lib/formatters'
import { Link } from '@tanstack/react-router'

export function AssetBarsCard({ bundle }: { bundle: DashboardBundle }) {
  const sorted = [...bundle.assetBreakdown].sort((a, b) => b.realizedPnl - a.realizedPnl)
  const top = sorted.slice(0, 5)
  const bottom = sorted.slice(-5).reverse().filter(x => !top.includes(x))
  const data = [...top, ...bottom]

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <h3 className="text-sm font-medium mb-3">Top winners &amp; losers by symbol</h3>
      <div className="h-64">
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 48 }}>
            <CartesianGrid stroke="#262626" strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              stroke="#737373"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => usd(v, { short: true })}
            />
            <YAxis
              type="category"
              dataKey="symbol"
              stroke="#a3a3a3"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip
              contentStyle={{ background: '#171717', border: '1px solid #404040', borderRadius: 6, fontSize: 12 }}
              formatter={(v) => typeof v === 'number' ? usd(v, { signed: true }) : String(v ?? '')}
            />
            <Bar dataKey="realizedPnl" radius={[0, 4, 4, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.realizedPnl >= 0 ? '#16a34a' : '#dc2626'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 text-xs text-neutral-500">
        Click a bar label to filter trades.{' '}
        <Link to="/trades" className="text-brand hover:underline">Open trades list →</Link>
      </div>
    </div>
  )
}
