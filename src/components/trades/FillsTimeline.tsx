import {
  CartesianGrid, ResponsiveContainer, ScatterChart, Scatter, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts'
import type { TradeDetailBundle } from '~/server/trades'
import { usd } from '~/lib/formatters'

const ROLE_COLOR: Record<string, string> = {
  open:   '#ea580c',
  add:    '#f59e0b',
  reduce: '#38bdf8',
  close:  '#a3a3a3',
}

export function FillsTimeline({ bundle }: { bundle: TradeDetailBundle }) {
  const data = bundle.fills.map(f => ({
    t: f.executedAt.getTime(),
    price: f.price,
    size: f.size,
    fee: f.fee,
    role: f.role,
  }))
  if (data.length === 0) return null

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <h3 className="text-sm font-medium mb-3">Fills</h3>
      <div className="h-56">
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 10, right: 16, bottom: 0, left: 16 }}>
            <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
            <XAxis
              type="number" dataKey="t" domain={['dataMin', 'dataMax']} stroke="#737373" fontSize={11} tickLine={false} axisLine={false}
              tickFormatter={(t) => new Date(t).toISOString().slice(11, 16)}
            />
            <YAxis type="number" dataKey="price" stroke="#737373" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => usd(v, { short: true })} />
            <ZAxis type="number" dataKey="size" range={[50, 350]} />
            <Tooltip
              contentStyle={{ background: '#171717', border: '1px solid #404040', borderRadius: 6, fontSize: 12 }}
              formatter={(_v: unknown, _n: unknown, ctx: { payload?: typeof data[number] }) => {
                const p = ctx.payload
                if (!p) return ['', '']
                return [`${p.role} · ${p.size} @ ${usd(p.price)}`, 'Fill']
              }}
              labelFormatter={(t) => new Date(Number(t)).toISOString().replace('T', ' ').slice(0, 19) + 'Z'}
            />
            {(['open', 'add', 'reduce', 'close'] as const).map(role => (
              <Scatter
                key={role}
                name={role}
                data={data.filter(d => d.role === role)}
                fill={ROLE_COLOR[role] ?? '#a3a3a3'}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-neutral-500 font-mono tabular-nums">
        {(['open', 'add', 'reduce', 'close'] as const).map(r => (
          <span key={r} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ROLE_COLOR[r] }} />
            {r}
          </span>
        ))}
      </div>
    </div>
  )
}
