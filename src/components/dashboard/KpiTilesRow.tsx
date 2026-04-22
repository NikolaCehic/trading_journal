import type { DashboardBundle } from '~/domain/dashboard'
import { KpiTile } from './KpiTile'
import { usd, pct } from '~/lib/formatters'

export function KpiTilesRow({ bundle }: { bundle: DashboardBundle }) {
  const { kpis, sparkline } = bundle
  return (
    <div className="grid grid-cols-5 gap-4">
      <KpiTile label="Realized PnL"      kpi={kpis.realizedPnl} format={(v) => usd(v, { signed: true })} sparkline={sparkline} />
      <KpiTile label="Win rate"           kpi={kpis.winRate}     format={(v) => pct(v)} spark={false} />
      <KpiTile label="Expectancy / trade" kpi={kpis.expectancy}  format={(v) => usd(v, { signed: true })} spark={false} />
      <KpiTile label="Trade count"        kpi={kpis.tradeCount}  format={(v) => String(Math.round(v))} spark={false} />
      <KpiTile label="Max drawdown"       kpi={kpis.maxDrawdown} format={(v) => usd(-Math.abs(v))} spark={false} />
    </div>
  )
}
