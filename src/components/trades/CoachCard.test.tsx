// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CoachCard } from './CoachCard'
import type { ReactElement } from 'react'

let getTradeCoachMock = vi.fn()

vi.mock('~/server/coach', () => ({
  getTradeCoach: (...args: unknown[]) => getTradeCoachMock(...args),
}))

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  getTradeCoachMock = vi.fn()
})

afterEach(() => {
  cleanup()
})

describe('CoachCard', () => {
  it('renders skeleton while loading', () => {
    getTradeCoachMock.mockImplementation(() => new Promise(() => { /* never */ }))
    renderWithClient(<CoachCard positionId="p1" onReadFull={() => {}} />)
    expect(screen.getByText(/composing your insight/i)).toBeTruthy()
  })

  it('renders the first paragraph of narrativeMarkdown on success', async () => {
    getTradeCoachMock.mockResolvedValue({
      gradeLetter: 'B',
      narrativeMarkdown: 'First paragraph about the trade.\n\nSecond paragraph with details.',
      referencedPositionIds: [],
      failed: false,
      cachedAt: '2026-04-25T00:00:00Z',
    })
    renderWithClient(<CoachCard positionId="p1" onReadFull={() => {}} />)
    expect(await screen.findByText(/first paragraph about the trade/i)).toBeTruthy()
    expect(screen.queryByText(/second paragraph with details/i)).toBeNull()
    expect(screen.getByText('B')).toBeTruthy()
  })

  it('hides itself when narrative is the LLM fallback (failed=true)', async () => {
    getTradeCoachMock.mockResolvedValue({
      gradeLetter: 'C',
      narrativeMarkdown: 'fallback text',
      referencedPositionIds: [],
      failed: true,
      cachedAt: '2026-04-25T00:00:00Z',
    })
    const { container } = renderWithClient(<CoachCard positionId="p1" onReadFull={() => {}} />)
    await screen.findByTestId('coach-card-hidden').catch(() => null)
    expect(container.querySelector('[data-testid="coach-card-root"]')).toBeNull()
  })

  it('renders error state with retry on query failure', async () => {
    getTradeCoachMock.mockRejectedValue(new Error('network'))
    renderWithClient(<CoachCard positionId="p1" onReadFull={() => {}} />)
    expect(await screen.findByText(/couldn.?t load/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })

  it('calls onReadFull when "Read full" is clicked', async () => {
    getTradeCoachMock.mockResolvedValue({
      gradeLetter: 'A',
      narrativeMarkdown: 'Solid trade.\n\nMore detail.',
      referencedPositionIds: [],
      failed: false,
      cachedAt: '2026-04-25T00:00:00Z',
    })
    const onReadFull = vi.fn()
    renderWithClient(<CoachCard positionId="p1" onReadFull={onReadFull} />)
    const btn = await screen.findByRole('button', { name: /read full/i })
    fireEvent.click(btn)
    expect(onReadFull).toHaveBeenCalledTimes(1)
  })
})
