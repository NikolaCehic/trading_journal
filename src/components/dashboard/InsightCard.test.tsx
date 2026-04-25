// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'

// Stub TanStack Router's <Link> with a plain <a> so we can render <InsightCard>
// without standing up an in-memory route tree (router APIs vary by version, and
// this test only cares about the visible-text branches of the card).
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

import { render, screen } from '@testing-library/react'
import { InsightCard } from './InsightCard'

// Text helpers — the card mixes text nodes with embedded <a> children, so
// getByText's default whole-element match misses partial substrings. Walk the
// rendered DOM and look at textContent instead.
function hasText(container: HTMLElement, pattern: RegExp): boolean {
  return pattern.test(container.textContent ?? '')
}

describe('InsightCard', () => {
  it('returns null when no summary and no trades', () => {
    const { container } = render(
      <InsightCard latestDigestSummary={null} userHasTrades={false} />
    )
    expect(container.querySelector('[data-testid="insight-card-root"]')).toBeNull()
    // Component should render absolutely nothing — no card, no chrome.
    expect(container.firstChild).toBeNull()
  })

  it('renders the "first digest composes" placeholder when no summary but user has trades', () => {
    const { container } = render(
      <InsightCard latestDigestSummary={null} userHasTrades={true} />
    )
    const root = container.querySelector('[data-testid="insight-card-root"]') as HTMLElement | null
    expect(root).not.toBeNull()
    expect(hasText(root!, /first weekly digest/i)).toBe(true)
    // Sanity: we surface the Settings link from the placeholder branch.
    expect(screen.getByRole('link', { name: /settings/i })).toBeTruthy()
  })

  it('renders the summary text + isoWeek when latestDigestSummary is present', () => {
    const { container } = render(
      <InsightCard
        latestDigestSummary={{
          isoWeek: '2026-W17',
          summary: 'You revenge-traded after losses three times this week.',
          composedAt: new Date('2026-04-25T22:00:00Z'),
        }}
        userHasTrades={true}
      />
    )
    const root = container.querySelector('[data-testid="insight-card-root"]') as HTMLElement | null
    expect(root).not.toBeNull()
    expect(hasText(root!, /revenge-traded after losses three times/i)).toBe(true)
    expect(hasText(root!, /2026-W17/)).toBe(true)
    // The "View full digest" link points at /digest in the summary branch.
    const link = screen.getByRole('link', { name: /view full digest/i })
    expect(link).toBeTruthy()
    expect(link.getAttribute('href')).toBe('/digest')
  })
})
