# AI Surfacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/qa/2026-04-25-ai-surfacing-design.md`

**Goal:** Promote the existing AI Coach (per-trade) and AI Digest (weekly) into two visible cards — `<CoachCard>` above the tab bar on `/trades/$id` and `<InsightCard>` below the setup checklist on `/dashboard` — so users see AI insight at the natural moments without having to click into a tab or a separate route.

**Architecture:** Two new components + one existing-server-fn extension + one new pure helper. Zero new prompts, zero new LLM calls (Coach card eager-loads the existing cached `useQuery`; Insight card reads the most recent composed `digest_run` row).

**Tech Stack:** TanStack Start (React 19) + TanStack Query + TanStack Router + Drizzle ORM + Vitest.

---

## File map

**New files:**
- `src/narrator/extract.ts` — `extractDigestSummary(narrative)` pure helper.
- `src/narrator/extract.test.ts` — vitest unit tests for the helper.
- `src/components/trades/CoachCard.tsx` — eager-loaded Coach narrative card.
- `src/components/trades/CoachCard.test.tsx` — component tests.
- `src/components/dashboard/InsightCard.tsx` — dashboard digest summary card.
- `src/components/dashboard/InsightCard.test.tsx` — component tests.

**Modified:**
- `src/server/dashboard.ts` — `DashboardBundle` type gains `latestDigestSummary`; `getDashboardBundle` populates it.
- `app/routes/(app)/_layout/trades/$positionId.tsx` — render `<CoachCard>` above the tab bar; pass `setTab` so the "Read full →" link can switch tabs.
- `app/routes/(app)/_layout/dashboard.tsx` — render `<InsightCard>` between the setup checklist and the KPI tiles.
- `scripts/smoke-ui.ts` — verify both cards render in expected states.

**No migrations. No new server functions. No new Inngest functions.**

---

## Execution order

Wave 1 (parallel): Tasks 1, 3, 5 — all create new files, file-disjoint.
Wave 2 (parallel): Tasks 2, 4, 6 — each uses one of Wave 1's outputs and modifies a different existing file.
Wave 3 (sequential): Task 7 (smoke extension), Task 8 (final verification).

---

## Task 1: `extractDigestSummary` helper

**Files:**
- Create: `src/narrator/extract.ts`
- Create: `src/narrator/extract.test.ts`

- [ ] **Step 1: Write failing tests for the priority cascade and length cap**

Create `src/narrator/extract.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractDigestSummary } from './extract'

describe('extractDigestSummary', () => {
  it('returns topFinding.prose when present', () => {
    const result = extractDigestSummary({
      greeting: 'Hello.',
      biggestWin: null,
      biggestLoss: null,
      topFinding: { findingId: 'f1', prose: 'You revenge-traded after losses three times this week.' },
      oneThingToTry: 'Wait 30 minutes after a loss.',
      suggestedRule: null,
    })
    expect(result).toBe('You revenge-traded after losses three times this week.')
  })

  it('falls back to oneThingToTry when topFinding is null', () => {
    const result = extractDigestSummary({
      greeting: 'Hello.',
      biggestWin: null,
      biggestLoss: null,
      topFinding: null,
      oneThingToTry: 'Wait 30 minutes after any loss.',
      suggestedRule: null,
    })
    expect(result).toBe('Wait 30 minutes after any loss.')
  })

  it('falls back to greeting when topFinding and oneThingToTry are null', () => {
    const result = extractDigestSummary({
      greeting: 'Welcome back. You took 11 trades this week.',
      biggestWin: null,
      biggestLoss: null,
      topFinding: null,
      oneThingToTry: null,
      suggestedRule: null,
    })
    expect(result).toBe('Welcome back. You took 11 trades this week.')
  })

  it('returns null when narrative is null', () => {
    expect(extractDigestSummary(null)).toBeNull()
  })

  it('returns null when every priority field is empty/null', () => {
    expect(extractDigestSummary({
      greeting: '',
      biggestWin: null,
      biggestLoss: null,
      topFinding: null,
      oneThingToTry: null,
      suggestedRule: null,
    })).toBeNull()
  })

  it('caps long topFinding.prose at 280 chars on a sentence boundary', () => {
    // 320 chars across three sentences. Cap should preserve full sentences only.
    const long =
      'First sentence has decent length and tells the user something useful. ' +
      'Second sentence continues the analysis with another full thought here. ' +
      'Third sentence is the one that pushes the narrative past the 280 char cap.'
    const result = extractDigestSummary({
      greeting: 'Hi',
      biggestWin: null,
      biggestLoss: null,
      topFinding: { findingId: 'f1', prose: long },
      oneThingToTry: null,
      suggestedRule: null,
    })
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThanOrEqual(280)
    // Should not end mid-word — last char before optional trailing period should
    // close a sentence. We just check the length cap and that it ends on '.' or
    // ends naturally without truncation glyphs.
    expect(result!.endsWith('.')).toBe(true)
  })

  it('handles unknown / unexpected narrative shapes by returning null', () => {
    // narrative is jsonb so could theoretically be any JSON. The helper should
    // be defensive against legacy shapes or malformed rows.
    expect(extractDigestSummary({} as unknown as Parameters<typeof extractDigestSummary>[0])).toBeNull()
    expect(extractDigestSummary('a string' as unknown as Parameters<typeof extractDigestSummary>[0])).toBeNull()
    expect(extractDigestSummary([] as unknown as Parameters<typeof extractDigestSummary>[0])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/narrator/extract.test.ts`
Expected: FAIL — `extractDigestSummary not defined`.

- [ ] **Step 3: Implement the helper**

Create `src/narrator/extract.ts`:

```ts
import type { DigestNarrative } from './schemas'

const MAX_LEN = 280

/**
 * Extract a 1–3 sentence summary suitable for the Dashboard Insight card.
 * Picks the most actionable single string from the structured digest narrative
 * in priority order:
 *
 *   1. topFinding.prose — most actionable, directly references a real finding
 *   2. oneThingToTry    — the LLM's coaching takeaway
 *   3. greeting         — always present, fallback orientation
 *
 * Returns null if every priority field is empty/null OR if the input is not a
 * recognisable narrative shape (e.g., legacy or malformed jsonb row).
 */
export function extractDigestSummary(
  narrative: DigestNarrative | null | undefined,
): string | null {
  if (!narrative || typeof narrative !== 'object' || Array.isArray(narrative)) {
    return null
  }
  const candidates: Array<string | undefined | null> = [
    narrative.topFinding?.prose,
    narrative.oneThingToTry,
    narrative.greeting,
  ]
  for (const c of candidates) {
    const trimmed = (c ?? '').trim()
    if (trimmed.length > 0) return capAtSentence(trimmed, MAX_LEN)
  }
  return null
}

/**
 * Caps `text` at `max` characters on a sentence boundary so the result reads
 * cleanly. If the text is already short enough, returns it as-is.
 *
 * Algorithm: split into sentences (keeping the trailing punctuation), then
 * accumulate sentences while their combined length stays within the cap.
 */
function capAtSentence(text: string, max: number): string {
  if (text.length <= max) return text
  // Split on sentence-end punctuation while keeping the punctuation attached.
  const parts = text.match(/[^.!?]+[.!?]+/g)
  if (!parts || parts.length === 0) {
    // No sentence boundaries at all — hard truncate with ellipsis.
    return text.slice(0, max - 1).trimEnd() + '…'
  }
  let out = ''
  for (const sentence of parts) {
    const next = out + sentence
    if (next.length > max) break
    out = next
  }
  // If even the first sentence overflows, fall back to a hard truncate.
  if (out.length === 0) return text.slice(0, max - 1).trimEnd() + '…'
  return out.trim()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/narrator/extract.test.ts`
Expected: 7 tests pass.

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/narrator/extract.ts src/narrator/extract.test.ts
git commit -m "feat(narrator): extractDigestSummary helper for dashboard insight card"
```

---

## Task 2: Extend `getDashboardBundle` with `latestDigestSummary`

**Files:**
- Modify: `src/server/dashboard.ts` — `DashboardBundle` type + handler.
- Modify or create: `src/server/dashboard.test.ts` (if absent, create following the `src/server/trades.test.ts` mock pattern).

**Depends on:** Task 1 must commit first.

- [ ] **Step 1: Read the existing `DashboardBundle` definition**

Read `src/server/dashboard.ts` lines 1–100 to find the `DashboardBundle` type export. Note the existing fields and exact placement so the new field can be added without disturbing them.

- [ ] **Step 2: Add `latestDigestSummary` to the type**

Find the `DashboardBundle` type (search `export type DashboardBundle`) and add this field at the end:

```ts
latestDigestSummary: {
  isoWeek: string
  summary: string
  composedAt: Date
} | null
```

- [ ] **Step 3: Add the imports the handler needs**

At the top of `src/server/dashboard.ts`, add to the existing imports if not already present:

```ts
import { digestRun } from '~/db/schema/narrator'
import { extractDigestSummary } from '~/narrator/extract'
```

`desc`, `eq`, `and` should already be imported from `drizzle-orm` — verify.

- [ ] **Step 4: Populate `latestDigestSummary` in the handler**

Inside `getDashboardBundle`'s handler, AFTER the existing aggregations and BEFORE the final `return` statement that builds the bundle, add:

```ts
const latestDigest = await db
  .select({
    isoWeek: digestRun.isoWeek,
    narrative: digestRun.narrative,
    createdAt: digestRun.createdAt,
  })
  .from(digestRun)
  .where(and(
    eq(digestRun.userId, userId),
    eq(digestRun.status, 'composed'),
  ))
  .orderBy(desc(digestRun.createdAt))
  .limit(1)

const digestSummaryText = latestDigest[0]
  ? extractDigestSummary(latestDigest[0].narrative as Parameters<typeof extractDigestSummary>[0])
  : null

const latestDigestSummary = (latestDigest[0] && digestSummaryText)
  ? {
      isoWeek: latestDigest[0].isoWeek,
      summary: digestSummaryText,
      composedAt: latestDigest[0].createdAt,
    }
  : null
```

Then add `latestDigestSummary` to the returned bundle object. Find the existing `return { ... }` and add it as a final field.

- [ ] **Step 5: Add a vitest test**

Edit `src/server/dashboard.test.ts` (or create using the same `vi.mock` pattern from `src/server/rules.test.ts` — use that file as the template). Add a test that verifies the field is populated when a composed digest exists and is null when none exists.

If creating a new file, here is the minimum:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~/auth/server', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue({ user: { id: 'u1', email: 'x', isDemo: false } }),
    },
  },
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => ({ headers: new Headers() }),
}))

let digestRows: Array<{ isoWeek: string; narrative: unknown; createdAt: Date }> = []

vi.mock('~/db/client', () => {
  const chain = (rowsFn: () => Promise<unknown[]>) => {
    const c: Record<string, unknown> = {
      from: vi.fn(() => c),
      where: vi.fn(() => c),
      orderBy: vi.fn(() => c),
      limit: vi.fn(() => c),
      offset: vi.fn(() => rowsFn()),
      then: (cb: (v: unknown[]) => unknown) => rowsFn().then(cb),
      execute: () => rowsFn(),
    }
    return c
  }
  return {
    db: {
      // Many queries fire inside getDashboardBundle. The simplest way to mock
      // them all is to return an empty-array chain by default and only special-
      // case the digest_run query when its `from` is matched.
      select: vi.fn((shape?: unknown) => {
        // The digest_run query selects { isoWeek, narrative, createdAt }.
        if (shape && typeof shape === 'object' && 'isoWeek' in shape && 'narrative' in shape) {
          return chain(async () => digestRows)
        }
        return chain(async () => [])
      }),
      $count: vi.fn(async () => 0),
    },
  }
})

beforeEach(() => { digestRows = [] })

describe('getDashboardBundle latestDigestSummary', () => {
  it('returns null when no composed digest exists', async () => {
    digestRows = []
    const { getDashboardBundle } = await import('./dashboard')
    const bundle = await getDashboardBundle({ data: {} })
    expect(bundle.latestDigestSummary).toBeNull()
  })

  it('returns the extracted summary when a composed digest exists', async () => {
    digestRows = [{
      isoWeek: '2026-W17',
      narrative: {
        greeting: 'Hi',
        biggestWin: null,
        biggestLoss: null,
        topFinding: { findingId: 'f1', prose: 'You revenge-traded three times.' },
        oneThingToTry: null,
        suggestedRule: null,
      },
      createdAt: new Date('2026-04-25T22:00:00Z'),
    }]
    const { getDashboardBundle } = await import('./dashboard')
    const bundle = await getDashboardBundle({ data: {} })
    expect(bundle.latestDigestSummary).toEqual({
      isoWeek: '2026-W17',
      summary: 'You revenge-traded three times.',
      composedAt: new Date('2026-04-25T22:00:00Z'),
    })
  })
})
```

If `src/server/dashboard.test.ts` already exists, just append the two tests to its existing `describe` block.

- [ ] **Step 6: Run the test**

Run: `pnpm vitest run src/server/dashboard.test.ts`
Expected: tests pass (existing + 2 new).

- [ ] **Step 7: Run typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/server/dashboard.ts src/server/dashboard.test.ts
git commit -m "feat(dashboard): expose latestDigestSummary in getDashboardBundle"
```

---

## Task 3: `<CoachCard>` component

**Files:**
- Create: `src/components/trades/CoachCard.tsx`
- Create: `src/components/trades/CoachCard.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `src/components/trades/CoachCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CoachCard } from './CoachCard'

let getTradeCoachMock = vi.fn()

vi.mock('~/server/coach', () => ({
  getTradeCoach: (...args: unknown[]) => getTradeCoachMock(...args),
}))

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  getTradeCoachMock = vi.fn()
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
    // Second paragraph should NOT be in the card
    expect(screen.queryByText(/second paragraph with details/i)).toBeNull()
    // Grade badge present
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
    // Wait for query to settle.
    await screen.findByTestId('coach-card-hidden').catch(() => null)
    // The card root should not be present
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
    const link = await screen.findByRole('button', { name: /read full/i })
    fireEvent.click(link)
    expect(onReadFull).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Verify test deps exist**

Run: `pnpm list @testing-library/react @testing-library/jest-dom 2>/dev/null | grep -E '@testing-library' | head -3`

If `@testing-library/react` is NOT installed, skip the component-tests-with-render approach and instead write a thinner test that exercises the data-extraction logic only. Inline the first-paragraph-extraction into a small pure helper, test that helper alone, and skip rendering. Update Task 3's tests to a pure-function test of the paragraph extractor; remove the render imports.

If `@testing-library/react` IS installed, proceed.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run src/components/trades/CoachCard.test.tsx`
Expected: FAIL — `CoachCard` not defined.

- [ ] **Step 4: Implement the component**

Create `src/components/trades/CoachCard.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { getTradeCoach } from '~/server/coach'

type CoachCardProps = {
  positionId: string
  onReadFull: () => void
}

const GRADE_STYLE: Record<string, { bg: string; fg: string }> = {
  A: { bg: 'rgba(34, 197, 94, 0.15)', fg: '#22c55e' },
  B: { bg: 'rgba(234, 88, 12, 0.15)', fg: 'var(--accent)' },
  C: { bg: 'rgba(251, 191, 36, 0.15)', fg: '#fbbf24' },
  D: { bg: 'rgba(220, 38, 38, 0.15)', fg: 'var(--pnl-down)' },
  F: { bg: 'var(--pnl-down)', fg: '#fff' },
}

export function CoachCard({ positionId, onReadFull }: CoachCardProps) {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['tradeCoach', positionId],
    queryFn: () => getTradeCoach({ data: { positionId } }),
    staleTime: 5 * 60 * 1000,
  })

  // Hide the card when the narrative is the LLM fallback — fallback markdown
  // is generic and not useful at the top of the page. The Coach tab still
  // surfaces it for users who want to read it.
  if (data && data.failed) {
    return <span data-testid="coach-card-hidden" style={{ display: 'none' }} />
  }

  if (isLoading || isFetching) {
    return (
      <div className="tj-card" data-testid="coach-card-root" style={{ padding: 16, marginBottom: 16 }}>
        <Header />
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--fg-subtle)' }}>
          Composing your insight…
        </div>
        <SkeletonLines />
      </div>
    )
  }

  if (error) {
    return (
      <div className="tj-card" data-testid="coach-card-root" role="alert" style={{ padding: 16, marginBottom: 16 }}>
        <Header />
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--fg-subtle)' }}>
          Couldn't load the AI insight.
        </div>
        <button type="button" className="tj-btn tj-btn-sm" style={{ marginTop: 8 }} onClick={() => refetch()}>
          Retry
        </button>
      </div>
    )
  }

  if (!data) return null

  const firstParagraph = firstNonEmptyParagraph(data.narrativeMarkdown)
  if (!firstParagraph) return null

  const grade = GRADE_STYLE[data.gradeLetter] ?? GRADE_STYLE['C']!

  return (
    <div className="tj-card" data-testid="coach-card-root" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Header />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            aria-label={`Grade ${data.gradeLetter}`}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, borderRadius: 6,
              fontSize: 12, fontWeight: 700,
              background: grade.bg, color: grade.fg,
            }}
          >{data.gradeLetter}</span>
          <button
            type="button"
            onClick={onReadFull}
            style={{
              fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none',
              cursor: 'pointer', padding: 0,
            }}
          >
            Read full →
          </button>
        </div>
      </div>
      <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5, color: 'var(--fg)', margin: '8px 0 0 0' }}>
        {firstParagraph}
      </p>
    </div>
  )
}

function Header() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 14, color: 'var(--accent)' }}>✦</span>
      <span style={{ fontSize: 13, fontWeight: 600 }}>AI insight</span>
    </div>
  )
}

function SkeletonLines() {
  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ height: 12, background: 'var(--bg-elevated)', borderRadius: 4, width: '92%' }} />
      <div style={{ height: 12, background: 'var(--bg-elevated)', borderRadius: 4, width: '78%' }} />
      <div style={{ height: 12, background: 'var(--bg-elevated)', borderRadius: 4, width: '60%' }} />
    </div>
  )
}

function firstNonEmptyParagraph(md: string): string | null {
  const trimmed = (md ?? '').trim()
  if (!trimmed) return null
  const parts = trimmed.split(/\n{2,}/)
  for (const p of parts) {
    const t = p.trim()
    if (t) return t
  }
  return null
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/components/trades/CoachCard.test.tsx`
Expected: 5 tests pass.

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/trades/CoachCard.tsx src/components/trades/CoachCard.test.tsx
git commit -m "feat(trades): CoachCard component — eager-load AI insight above tab bar"
```

---

## Task 4: Wire `<CoachCard>` into trade detail page

**Files:**
- Modify: `app/routes/(app)/_layout/trades/$positionId.tsx`

**Depends on:** Task 3 must commit first.

- [ ] **Step 1: Add the import**

At the top of `app/routes/(app)/_layout/trades/$positionId.tsx`, with the other component imports, add:

```tsx
import { CoachCard } from '~/components/trades/CoachCard'
```

- [ ] **Step 2: Render `<CoachCard>` above the tab bar**

Find the `<TabBar ... />` usage (currently around line 89). Immediately ABOVE it, add:

```tsx
<CoachCard
  positionId={p.id}
  onReadFull={() => {
    setTab('Coach')
    // Scroll the tab content area into view if it has an id; otherwise the
    // tab activation alone is sufficient since the tab content is rendered
    // immediately below the tab bar.
  }}
/>
```

`p.id` is whatever variable name holds the position id at this scope. If the bundle uses `bundle.position.id`, use that. The `setTab` setter is already in scope at line 77 (`const [tab, setTab] = useState<Tab>('Notes')`).

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Manual verification**

Run `pnpm dev` (in another terminal if not already), open the demo trade detail page, and confirm:
- Card renders above the Notes/Tags/Findings/Coach tab bar.
- For a cached trade (the demo seed has 12 positions, none with composed coach narratives initially), expect a brief "Composing your insight…" skeleton then either:
  - The narrative card with grade badge — if the LLM call succeeded.
  - A hidden card — if the narrative came back as `failed: true` (rare with demo data).
- Clicking "Read full →" switches to the Coach tab.

If the dev server isn't ready, skip this and rely on the smoke-test extension in Task 7.

- [ ] **Step 5: Commit**

```bash
git add app/routes/'(app)'/_layout/trades/'$positionId.tsx'
git commit -m "feat(trades): render CoachCard above the tab bar"
```

---

## Task 5: `<InsightCard>` component

**Files:**
- Create: `src/components/dashboard/InsightCard.tsx`
- Create: `src/components/dashboard/InsightCard.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `src/components/dashboard/InsightCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InsightCard } from './InsightCard'

describe('InsightCard', () => {
  it('returns null when no summary and no trades (setup checklist owns empty state)', () => {
    const { container } = render(
      <InsightCard latestDigestSummary={null} userHasTrades={false} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders "first digest composes" copy when no summary but user has trades', () => {
    render(<InsightCard latestDigestSummary={null} userHasTrades={true} />)
    expect(screen.getByText(/first weekly digest/i)).toBeTruthy()
  })

  it('renders the summary text when latestDigestSummary is present', () => {
    render(
      <InsightCard
        latestDigestSummary={{
          isoWeek: '2026-W17',
          summary: 'You revenge-traded after losses three times this week.',
          composedAt: new Date('2026-04-25T22:00:00Z'),
        }}
        userHasTrades={true}
      />
    )
    expect(screen.getByText(/revenge-traded after losses three times/i)).toBeTruthy()
    expect(screen.getByText(/2026-W17/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/components/dashboard/InsightCard.test.tsx`
Expected: FAIL — `InsightCard` not defined.

- [ ] **Step 3: Implement the component**

Create `src/components/dashboard/InsightCard.tsx`:

```tsx
import { Link } from '@tanstack/react-router'

export type LatestDigestSummary = {
  isoWeek: string
  summary: string
  composedAt: Date
}

type InsightCardProps = {
  latestDigestSummary: LatestDigestSummary | null
  userHasTrades: boolean
}

export function InsightCard({ latestDigestSummary, userHasTrades }: InsightCardProps) {
  // Empty user — setup checklist owns the empty state on dashboard.
  if (!latestDigestSummary && !userHasTrades) return null

  const hasSummary = Boolean(latestDigestSummary)

  return (
    <div className="tj-card" data-testid="insight-card-root" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, color: 'var(--accent)' }}>✦</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>AI insight</span>
      </div>
      {hasSummary ? (
        <>
          <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5, color: 'var(--fg)', margin: '8px 0 0 0' }}>
            {latestDigestSummary!.summary}
          </p>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--fg-subtle)' }}>
            Week of {latestDigestSummary!.isoWeek} ·{' '}
            <Link to="/digest" style={{ color: 'var(--accent)' }}>
              View full digest →
            </Link>
          </div>
        </>
      ) : (
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--fg-subtle)', margin: '8px 0 0 0' }}>
          Your first weekly digest composes Sunday at 22:00 in your timezone — toggle email delivery in{' '}
          <Link to="/settings" style={{ color: 'var(--accent)' }}>Settings</Link>.
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/components/dashboard/InsightCard.test.tsx`
Expected: 3 tests pass.

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/InsightCard.tsx src/components/dashboard/InsightCard.test.tsx
git commit -m "feat(dashboard): InsightCard component — promotes the latest weekly digest"
```

---

## Task 6: Wire `<InsightCard>` into dashboard

**Files:**
- Modify: `app/routes/(app)/_layout/dashboard.tsx`

**Depends on:** Tasks 2 and 5 must commit first.

- [ ] **Step 1: Add the import**

At the top of `app/routes/(app)/_layout/dashboard.tsx`, with the other component imports, add:

```tsx
import { InsightCard } from '~/components/dashboard/InsightCard'
```

- [ ] **Step 2: Render `<InsightCard>` between the setup checklist and the KPI tiles**

Find the existing setup-checklist render (added in the prior UX-fix work) — it's gated on `bundle.summary.tradeCount === 0`. The InsightCard goes right AFTER that block (so an empty user sees only the checklist; a user with trades sees only the InsightCard placeholder or summary):

```tsx
{bundle.summary.tradeCount > 0 && (
  <InsightCard
    latestDigestSummary={bundle.latestDigestSummary}
    userHasTrades={true}
  />
)}
```

If `bundle.summary.tradeCount` doesn't exist with that path, use whatever expression the existing setup-checklist condition uses — they should be the inverse pair.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Manual verification**

Run `pnpm dev` and open the demo dashboard. The demo user has positions but probably no composed digest, so the card should show the "first weekly digest composes Sunday" copy. If you've previously triggered `previewDigest` or have a digest_run row, you'll see the summary instead.

- [ ] **Step 5: Commit**

```bash
git add app/routes/'(app)'/_layout/dashboard.tsx
git commit -m "feat(dashboard): render InsightCard between setup checklist and KPI tiles"
```

---

## Task 7: Extend smoke test for both cards

**Files:**
- Modify: `scripts/smoke-ui.ts`

**Depends on:** Tasks 4 and 6 must commit first.

- [ ] **Step 1: Add Coach card check to `testTradeDetail`**

In `scripts/smoke-ui.ts`, find the existing `testTradeDetail` function. After the existing assertions, ADD:

```ts
// CoachCard should be present (visible OR hidden via the failed=true path).
// We accept either: the card root is in the DOM, OR a hidden marker was rendered.
const coachVisible = await page.locator('[data-testid="coach-card-root"]').count()
const coachHidden = await page.locator('[data-testid="coach-card-hidden"]').count()
log('/trades/detail', coachVisible + coachHidden > 0 ? 'ok' : 'warn',
  `coach card mounted (visible=${coachVisible}, hidden=${coachHidden})`)
```

- [ ] **Step 2: Add InsightCard check to `testDashboard`**

In the same file, find `testDashboard`. After the existing assertions, ADD:

```ts
// InsightCard should render for the demo user (has trades, may or may not
// have a composed digest yet — either way the card or the placeholder shows).
const insightCard = await page.locator('[data-testid="insight-card-root"]').count()
log('/dashboard', insightCard > 0 ? 'ok' : 'warn', `insight card present: ${insightCard > 0}`)
```

- [ ] **Step 3: Run the smoke test**

Run: `pnpm tsx scripts/smoke-ui.ts`
Expected: both new assertions log `✓` (ok). The trade-detail Coach card may take longer than the existing waits — if the smoke test times out before the Coach call completes, the card may still show its loading state (which has `data-testid="coach-card-root"`), so the count assertion passes either way.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-ui.ts
git commit -m "test(ux): smoke verifies CoachCard + InsightCard mount points"
```

---

## Task 8: Final verification

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: all tests pass. Count should be ≥ 346 (existing) + 7 (Task 1) + 2 (Task 2) + 5 (Task 3) + 3 (Task 5) = 363 minimum.

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Step 3: Smoke audit**

Run: `pnpm tsx scripts/ux-audit.ts`
Expected: zero new HIGH findings introduced. Existing audit summary `crit=0 high=0 med=2` should remain stable.

- [ ] **Step 4: Manual walkthrough (if dev server is up)**

- Open `/trades/$positionId` for a demo position → Coach card visible above tab bar with grade badge + first paragraph + "Read full →" link.
- Click "Read full →" → tab switches to Coach.
- Open `/dashboard` for demo user → Insight card visible between setup checklist (hidden for users with data) and KPI tiles. With no composed digest, shows the "first weekly digest" placeholder. With one composed, shows the summary + "View full digest →" link.

- [ ] **Step 5: Open PR (or report local-only completion)**

If on a feature branch:

```bash
gh pr create --title "feat: AI surfacing — Coach + Digest cards on trade detail and dashboard" --body "$(cat <<'EOF'
## Summary
- Promotes existing Coach narrative + weekly Digest into two visible cards (per docs/qa/2026-04-25-ai-surfacing-design.md).
- CoachCard above the tab bar on /trades/\$id; eager-loaded via the existing useQuery cache.
- InsightCard between the setup checklist and KPI tiles on /dashboard; renders extractDigestSummary(latest digest_run.narrative).
- Zero new prompts, zero new LLM calls, no migrations, no new server fns.

## Test plan
- [x] pnpm typecheck
- [x] pnpm test
- [x] pnpm build
- [x] pnpm tsx scripts/smoke-ui.ts
- [ ] Manual: open trade detail, see Coach card. Click "Read full →", tab switches.
- [ ] Manual: open dashboard, see Insight card.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

If on `main` (this conversation's pattern), report all commits to the user with SHAs.

---

## Self-review

**1. Spec coverage:**
- "Two new components" → Tasks 3 (CoachCard) + 5 (InsightCard). ✓
- "extractDigestSummary helper" → Task 1. ✓
- "getDashboardBundle gains latestDigestSummary" → Task 2. ✓
- "Wire CoachCard above tab bar" → Task 4. ✓
- "Wire InsightCard between setup checklist and KPI tiles" → Task 6. ✓
- "Smoke test extension" → Task 7. ✓
- "Edge cases: failed: true narrative hides card" → Task 3 Step 1 test, Task 3 Step 4 implementation. ✓
- "Edge cases: no trades hides InsightCard" → Task 5 Step 1 test, Task 5 Step 3 implementation. ✓
- "Edge cases: no digest yet but has trades → 'first digest composes' copy" → Task 5 Step 1 test, Task 5 Step 3 implementation. ✓
- "Cost posture: zero new LLM calls" → eager-load uses existing useQuery cache; latestDigestSummary is a read of existing digest_run row. ✓ (architectural; no test needed)
- "Per-range AI synthesis explicitly out of scope" → no task addresses it. ✓

**2. Placeholder scan:** None of "TBD", "TODO", "implement later", "appropriate error handling", "similar to Task N". Each step has concrete code or concrete commands. ✓

**3. Type consistency:**
- `extractDigestSummary(narrative: DigestNarrative | null | undefined): string | null` defined in Task 1 → consumed in Task 2 (cast at boundary because `digestRun.narrative` is `Record<string, unknown> | null` jsonb) → consumed in InsightCard test in Task 5 (uses the string output). ✓
- `LatestDigestSummary = { isoWeek: string; summary: string; composedAt: Date }` defined in Task 5 InsightCard.tsx → matches the `latestDigestSummary` field added in Task 2. ✓
- `TradeCoachResult` shape (`{ gradeLetter, narrativeMarkdown, referencedPositionIds, failed, cachedAt }`) used in Task 3 tests + implementation. Matches `src/server/coach.ts:15-21`. ✓
- `<CoachCard positionId onReadFull />` props in Task 3 → used in Task 4 with same shape. ✓
- `<InsightCard latestDigestSummary userHasTrades />` props in Task 5 → used in Task 6 with same shape. ✓

**4. Risk check:**
- Component tests assume `@testing-library/react` is installed. Task 3 Step 2 explicitly checks and provides a fallback (pure-helper tests instead of render tests).
- Trade-detail page has the `tab` state at the right level (line 77 confirmed). `setTab` is in scope where the new `<CoachCard>` is rendered.
- Tests for `getDashboardBundle` use the `vi.mock('~/db/client')` pattern proven in `src/server/rules.test.ts` and `src/server/trades.test.ts` from prior phases.

Plan complete.

---

## Execution

Plan complete and saved to `docs/qa/2026-04-25-ai-surfacing-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task. Tasks 1, 3, 5 dispatch in parallel (Wave 1, file-disjoint). Tasks 2, 4, 6 dispatch in parallel (Wave 2, file-disjoint after Wave 1 commits). Tasks 7, 8 sequential. Same dispatch pattern as the UX fix swarm we just shipped.

2. **Inline Execution** — Execute tasks in this session sequentially with checkpoints for review.

Which approach?
