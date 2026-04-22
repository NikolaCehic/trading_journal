// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KpiTile } from '~/components/dashboard/KpiTile'
import { usd } from '~/lib/formatters'

describe('<KpiTile />', () => {
  it('renders positive delta in win color', () => {
    const { container } = render(
      <KpiTile label="PnL" kpi={{ value: 123, deltaPct: 4.2 }} format={v => usd(v)} spark={false} />,
    )
    expect(screen.getByText('PnL')).toBeInTheDocument()
    expect(container.querySelector('.text-pnl-win')).not.toBeNull()
  })

  it('shows em-dash when delta is null', () => {
    render(<KpiTile label="PnL" kpi={{ value: 0, deltaPct: null }} format={v => usd(v)} spark={false} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
