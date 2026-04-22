# Phase 3 — Dashboard & Trade Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the derivation engine visible. Ship `/app/dashboard` (KPIs, equity curve, heatmap, asset breakdown, findings sidebar, URL-shareable filters), `/app/trades` (filterable table with keyboard nav + bulk-tag), and `/app/trades/:positionId` (header + fills timeline + metric chips + Notes / Tags / Findings tabs with Coach tab stubbed for Phase 4). Add the journal layer (notes, setup tags, mistake tags, reflections) so traders can annotate their trades. End of this phase is the first screenshot-worthy milestone.

**Architecture:** Presentation reads only derived rows — it never recomputes. Server functions select from `summary_rollup`, `daily_metric`, `asset_metric`, `session_metric`, `finding`, `position`, `position_fill`, `fill`, plus the new journal tables. TanStack Router owns dashboard filter state via typed search params (URL-shareable). TanStack Query caches reads with per-route `staleTime`. Mutations for notes/tags/reflections use `createServerFn` with optimistic updates. Charts use Recharts (declarative, SSR-friendly). Markdown rendered through `react-markdown` + `rehype-sanitize`.

**Tech Stack:** TanStack Start · TanStack Router · TanStack Query · Drizzle · Recharts · react-markdown · rehype-sanitize · shadcn/ui · Tailwind CSS · Vitest

**Plan 04 of ~6.** Previous: Phase 0 Foundation, Phase 1 Ingestion, Phase 2 Derivation. Subsequent: Phase 4 AI (digest + post-mortem), Phase 5 Demo, Phase 6 Polish.

---

## Pre-flight: what you need before starting

- Phase 2 shipped — `pnpm vitest run` reports the derivation + 12 golden-fixture tests green
- Migrations `drizzle/0001_*.sql` + `drizzle/0002_*.sql` have been **applied** to the Neon DB (the dashboard reads from those tables — if they don't exist, every query errors)
- `DATABASE_URL` resolves against a Neon branch that has at least one real or seeded user with derived data. If not, run `pnpm rederive --user=<id>` after a CSV import to populate.
- shadcn CLI installed at `^4.4.0` — we'll add components via `pnpm dlx shadcn@latest add <component>`
- `.env.local` has `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (even placeholders) so the auth layer boots cleanly under vitest

---

## File structure after Phase 3

```
NEW:
src/
  domain/
    journal.ts                TradeNote, SetupTag, MistakeTag, PositionTag, PositionReflection types
    dashboard.ts              DashboardBundle, TimeRange, Filters types
  db/
    schema/
      journal.ts              trade_note, setup_tag, mistake_tag, position_tag, position_reflection tables
      seeds/
        mistake-tags.ts       starter set of ~8 mistake tags
  server/
    dashboard.ts              getDashboardBundle, getRecentFindings
    trades.ts                 getTradeList, getTradeDetail
    journal.ts                upsertTradeNote, applyPositionTag, removePositionTag, upsertReflection,
                              createSetupTag, createMistakeTag, listTags
    seedJournal.ts            ensureDefaultMistakeTags(userId)
  lib/
    filters.ts                parseFilters / serializeFilters for URL search params
    formatters.ts             usd, pct, duration, datetime helpers (tabular digits)
  components/
    dashboard/
      ControlsRow.tsx
      KpiTile.tsx
      KpiTilesRow.tsx
      EquityCurveCard.tsx
      TimeOfDayHeatmapCard.tsx
      AssetBarsCard.tsx
      FindingsSidebar.tsx
    trades/
      TradesTable.tsx
      TradesFilterBar.tsx
      BulkTagDialog.tsx
      PositionHeader.tsx
      FillsTimeline.tsx
      MetricChipsRow.tsx
      NotesTab.tsx
      TagsTab.tsx
      FindingsTab.tsx
      CoachTabStub.tsx
    shell/
      TopBar.tsx
      VersionBadge.tsx
    ui/                        (added via shadcn CLI in Task 0)
      sheet.tsx
      popover.tsx
      command.tsx
      dropdown-menu.tsx
      select.tsx
      input.tsx
      textarea.tsx
      checkbox.tsx
      toggle-group.tsx
      dialog.tsx
      separator.tsx
      tooltip.tsx
      sonner.tsx
  hooks/
    useDashboardFilters.ts     typed reader/writer around search params
    useAutosave.ts             debounced autosave used by Notes tab

app/routes/(app)/
  dashboard.tsx                replace the stub with the full dashboard
  trades/
    index.tsx                  trade list
    $positionId.tsx            trade detail with Notes/Tags/Findings/Coach tabs

tests/unit/
  lib/filters.test.ts
  server/dashboard.test.ts     unit tests on the filter-to-SQL path (mocked db)
  server/journal.test.ts       mutation handler shape tests
  components/
    KpiTile.test.tsx
    FillsTimeline.test.tsx
    TradesTable.test.tsx

drizzle/
  (new migration for journal tables)

MODIFIED:
src/db/schema/index.ts        re-export journal schema
src/auth/server.ts            wire mistake-tag seed on first sign-in
app/routes/(app)/_layout.tsx  swap out stub top bar for <TopBar/>
package.json                  deps: recharts, react-markdown, rehype-sanitize, @uiw/react-md-editor (optional), sonner
```

---

## Task 0 — Install UI dependencies + shadcn components

**Why:** The dashboard, trade table, and trade detail need components that aren't on the shelf yet, plus Recharts for charts and markdown rendering for Notes. Do this first so every later task has its imports ready.

**Files:**
- Modify: `package.json` / `pnpm-lock.yaml` (via `pnpm add`)
- Create: ~12 new files under `src/components/ui/` (generated by the shadcn CLI)

- [ ] **Step 1: Install runtime deps**

```bash
pnpm add recharts react-markdown rehype-sanitize remark-gfm sonner
```

Verify `package.json` now lists them under `dependencies`. Do NOT install `@uiw/react-md-editor` (listed optional in the file-structure notes) — a plain `<textarea>` is enough for the Notes tab in this phase. Polish comes in Phase 6.

- [ ] **Step 2: Add shadcn components via CLI**

```bash
pnpm dlx shadcn@latest add sheet popover command dropdown-menu select input textarea checkbox toggle-group dialog separator tooltip sonner
```

If the CLI prompts interactively, accept defaults. Verify each generated file lives at `src/components/ui/<name>.tsx`.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/components/ui/
git commit -m "chore(ui): add recharts + markdown + shadcn components for phase 3

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 1 — Journal DB schema + migration

**Files:**
- Create: `src/db/schema/journal.ts`
- Modify: `src/db/schema/index.ts`
- Generate migration (do NOT push)

- [ ] **Step 1: Create `src/db/schema/journal.ts`**

```ts
import {
  pgTable, text, timestamp, integer, boolean, jsonb,
  unique, index, pgEnum,
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import { position } from './derivation'

export const tagKindEnum = pgEnum('tag_kind', ['setup', 'mistake'])
export const emotionalStateEnum = pgEnum('emotional_state', [
  'calm', 'fomo', 'revenge', 'bored', 'anxious', 'confident',
])

export const tradeNote = pgTable('trade_note', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  positionId: text('position_id').notNull().references(() => position.id, { onDelete: 'cascade' }),
  bodyMarkdown: text('body_markdown').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('trade_note_unique_position').on(t.userId, t.positionId),
])

export const setupTag = pgTable('setup_tag', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  color: text('color'),                // hex, optional
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('setup_tag_unique_label').on(t.userId, t.label),
  index('setup_tag_user_idx').on(t.userId),
])

export const mistakeTag = pgTable('mistake_tag', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  color: text('color'),
  isDefault: boolean('is_default').notNull().default(false),   // true for seeded starters
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('mistake_tag_unique_label').on(t.userId, t.label),
  index('mistake_tag_user_idx').on(t.userId),
])

export const positionTag = pgTable('position_tag', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  positionId: text('position_id').notNull().references(() => position.id, { onDelete: 'cascade' }),
  kind: tagKindEnum('kind').notNull(),
  setupTagId: text('setup_tag_id').references(() => setupTag.id, { onDelete: 'cascade' }),
  mistakeTagId: text('mistake_tag_id').references(() => mistakeTag.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('position_tag_unique').on(t.positionId, t.kind, t.setupTagId, t.mistakeTagId),
  index('position_tag_position_idx').on(t.positionId),
])

export const positionReflection = pgTable('position_reflection', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  positionId: text('position_id').notNull().references(() => position.id, { onDelete: 'cascade' }),
  confidence: integer('confidence'),                  // 1..5 nullable
  emotionalState: emotionalStateEnum('emotional_state'),
  reflectionMarkdown: text('reflection_markdown'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('position_reflection_unique').on(t.userId, t.positionId),
])
```

- [ ] **Step 2: Re-export from `src/db/schema/index.ts`**

Append: `export * from './journal'`

- [ ] **Step 3: Generate migration**

Run: `pnpm drizzle-kit generate`
Expected: a new `drizzle/0003_*.sql` file. Do NOT run `push`.

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm typecheck
git add src/db/schema/journal.ts src/db/schema/index.ts drizzle/
git commit -m "feat(db): journal schema — trade_note, setup/mistake tags, reflections

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2 — Journal + dashboard domain types

**Files:**
- Create: `src/domain/journal.ts`
- Create: `src/domain/dashboard.ts`

- [ ] **Step 1: `src/domain/journal.ts`**

```ts
export type TagKind = 'setup' | 'mistake'
export type EmotionalState = 'calm' | 'fomo' | 'revenge' | 'bored' | 'anxious' | 'confident'

export type SetupTag = { id: string; label: string; color: string | null; isArchived: boolean }
export type MistakeTag = { id: string; label: string; color: string | null; isDefault: boolean; isArchived: boolean }

export type TradeNote = {
  id: string
  userId: string
  positionId: string
  bodyMarkdown: string
  updatedAt: Date
}

export type PositionTagRef = {
  id: string
  kind: TagKind
  setupTagId: string | null
  mistakeTagId: string | null
}

export type PositionReflection = {
  id: string
  userId: string
  positionId: string
  confidence: number | null        // 1..5
  emotionalState: EmotionalState | null
  reflectionMarkdown: string | null
  updatedAt: Date
}

/** Starter set seeded on first sign-in. User can archive or add to. */
export const DEFAULT_MISTAKE_TAGS: Array<{ label: string; color: string }> = [
  { label: 'Overtrading',      color: '#dc2626' },
  { label: 'Revenge trade',    color: '#dc2626' },
  { label: 'Oversized',        color: '#ea580c' },
  { label: 'Chased entry',     color: '#ea580c' },
  { label: 'Moved stop',       color: '#f59e0b' },
  { label: 'Held too long',    color: '#f59e0b' },
  { label: 'Cut winner early', color: '#f59e0b' },
  { label: 'Traded news',      color: '#facc15' },
]
```

- [ ] **Step 2: `src/domain/dashboard.ts`**

```ts
import type { DailyMetricValue, AssetMetricValue, SessionMetricValue, SummaryRollupValue } from './metrics'
import type { Finding } from './finding'

export type TimeRange = '7d' | '30d' | '90d' | 'ytd' | 'all' | 'custom'
export type InstrumentFilter = 'all' | 'spot' | 'perp'

export type DashboardFilters = {
  timeRange: TimeRange
  customFrom: string | null   // ISO date string yyyy-mm-dd
  customTo: string | null
  symbols: string[]            // empty = all
  instrument: InstrumentFilter
  setupTagIds: string[]        // empty = all
}

export type DashboardKpiDelta = {
  value: number
  deltaPct: number | null     // null when prior period has no data
}

export type DashboardBundle = {
  filters: DashboardFilters
  summary: SummaryRollupValue
  kpis: {
    realizedPnl: DashboardKpiDelta
    winRate: DashboardKpiDelta
    expectancy: DashboardKpiDelta
    tradeCount: DashboardKpiDelta
    maxDrawdown: DashboardKpiDelta
  }
  sparkline: Array<{ date: string; pnl: number; cumulativePnl: number }>
  equityCurve: Array<{ date: string; cumulativePnl: number }>
  heatmap: Array<{ hourOfDayUtc: number; dayOfWeekUtc: number; tradeCount: number; expectancy: number }>
  assetBreakdown: AssetMetricValue[]          // sorted by realizedPnl desc
  sessionBreakdown: SessionMetricValue[]
  topFindings: Finding[]                      // top 5 by severity
  meta: {
    totalFillCount: number
    totalPositionCount: number
    lastDerivationAt: Date | null
    derivationVersion: number
  }
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm typecheck
git add src/domain/journal.ts src/domain/dashboard.ts
git commit -m "feat(domain): journal + dashboard bundle types

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3 — Mistake-tag seeder on first sign-in

**Why:** Spec §5.5: "MistakeTag — Seeded with ~8 starters on signup." Hook this into the Better Auth flow so any sign-in triggers an idempotent seed.

**Files:**
- Create: `src/server/seedJournal.ts`
- Modify: `src/auth/server.ts` (add post-sign-in callback)
- Create: `tests/unit/server/seedJournal.test.ts`

- [ ] **Step 1: TDD — failing test**

```ts
// tests/unit/server/seedJournal.test.ts
import { describe, it, expect, vi } from 'vitest'
import { ensureDefaultMistakeTags } from '~/server/seedJournal'
import { DEFAULT_MISTAKE_TAGS } from '~/domain/journal'

function mockDb() {
  const inserts: unknown[] = []
  return {
    inserts,
    insert: () => ({
      values: (rows: unknown) => ({
        onConflictDoNothing: async () => { inserts.push(rows); return { rowCount: 0 } },
      }),
    }),
  }
}

describe('ensureDefaultMistakeTags', () => {
  it('inserts the default mistake tag set with onConflictDoNothing', async () => {
    const db = mockDb()
    await ensureDefaultMistakeTags(db as never, 'u1')
    expect(db.inserts).toHaveLength(1)
    const rows = db.inserts[0] as Array<{ label: string; isDefault: boolean; userId: string }>
    expect(rows).toHaveLength(DEFAULT_MISTAKE_TAGS.length)
    expect(rows.every(r => r.userId === 'u1' && r.isDefault === true)).toBe(true)
    expect(rows[0]!.label).toBe(DEFAULT_MISTAKE_TAGS[0]!.label)
  })
})
```

Run: `pnpm vitest run tests/unit/server/seedJournal.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement `src/server/seedJournal.ts`**

```ts
import { DEFAULT_MISTAKE_TAGS } from '~/domain/journal'
import { mistakeTag } from '~/db/schema/journal'
import type { DB } from '~/db/client'

export async function ensureDefaultMistakeTags(db: DB, userId: string): Promise<void> {
  const rows = DEFAULT_MISTAKE_TAGS.map(t => ({
    id: `mt_${userId.slice(0, 8)}_${t.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    userId,
    label: t.label,
    color: t.color,
    isDefault: true,
    isArchived: false,
  }))
  await db.insert(mistakeTag).values(rows).onConflictDoNothing()
}
```

Run the test; expect PASS.

- [ ] **Step 3: Wire into Better Auth post-sign-in**

In `src/auth/server.ts`, find where Better Auth is configured (`betterAuth({ ... })`) and add a `databaseHooks` entry (Better Auth supports `user.create` hook) OR, if that's not available, seed inside the existing `GET /api/auth/session` flow after confirming a user exists. The simplest portable approach:

Create a helper in `src/auth/server.ts`:

```ts
import { ensureDefaultMistakeTags } from '~/server/seedJournal'
import { db } from '~/db/client'

// after betterAuth({ ... }) definition:
export async function onSignedIn(userId: string) {
  try { await ensureDefaultMistakeTags(db, userId) }
  catch (err) { console.warn('seed mistake tags failed', { userId, err: String(err) }) }
}
```

Then call `onSignedIn(session.user.id)` at the top of each server function that has a session, OR (preferred) hook `after` callback in the Better Auth config if available. If it's not obvious how to hook Better Auth, stop and ask — do not invent APIs.

**Escalate:** if Better Auth v1.x config doesn't expose a `user.created` hook, report BLOCKED. The fallback is to call `ensureDefaultMistakeTags` lazily from `getTagsForTagPicker` in Task 6. That's acceptable but should be explicitly chosen by the controller.

- [ ] **Step 4: Commit**

```bash
git add src/server/seedJournal.ts src/auth/server.ts tests/unit/server/seedJournal.test.ts
git commit -m "feat(journal): seed default mistake tags on first sign-in

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4 — Dashboard read server function

**Why:** One server function that returns the full `DashboardBundle` for a (user, filter) combination. Dashboard route calls this once; each tile/chart selects from the returned bundle.

**Files:**
- Create: `src/lib/filters.ts` (parse / serialize URL search params → `DashboardFilters`)
- Create: `src/server/dashboard.ts`
- Create: `tests/unit/lib/filters.test.ts`

- [ ] **Step 1: `src/lib/filters.ts` — TDD**

Test first (`tests/unit/lib/filters.test.ts`):

```ts
import { describe, it, expect } from 'vitest'
import { parseFilters, serializeFilters, computeRange } from '~/lib/filters'
import type { DashboardFilters } from '~/domain/dashboard'

describe('parseFilters / serializeFilters', () => {
  it('round-trips every filter field', () => {
    const f: DashboardFilters = {
      timeRange: 'custom',
      customFrom: '2024-01-01',
      customTo: '2024-03-31',
      symbols: ['BTC', 'ETH'],
      instrument: 'perp',
      setupTagIds: ['st_1', 'st_2'],
    }
    const params = serializeFilters(f)
    expect(parseFilters(params)).toEqual(f)
  })

  it('uses sensible defaults when params are empty', () => {
    const f = parseFilters({})
    expect(f.timeRange).toBe('30d')
    expect(f.symbols).toEqual([])
    expect(f.instrument).toBe('all')
  })
})

describe('computeRange', () => {
  const now = new Date('2024-03-15T12:00:00Z')
  it('7d yields a 7-day window ending at now', () => {
    const r = computeRange({ timeRange: '7d', customFrom: null, customTo: null, symbols: [], instrument: 'all', setupTagIds: [] }, now)
    expect(r.to.getTime() - r.from.getTime()).toBe(7 * 86_400_000)
  })
  it('custom returns the provided bounds', () => {
    const r = computeRange({ timeRange: 'custom', customFrom: '2024-02-01', customTo: '2024-02-15', symbols: [], instrument: 'all', setupTagIds: [] }, now)
    expect(r.from.toISOString().slice(0, 10)).toBe('2024-02-01')
    expect(r.to.toISOString().slice(0, 10)).toBe('2024-02-15')
  })
})
```

Now implement `src/lib/filters.ts`:

```ts
import type { DashboardFilters, TimeRange, InstrumentFilter } from '~/domain/dashboard'

const VALID_RANGES: TimeRange[] = ['7d', '30d', '90d', 'ytd', 'all', 'custom']
const VALID_INSTRUMENTS: InstrumentFilter[] = ['all', 'spot', 'perp']

export function parseFilters(q: Record<string, string | string[] | undefined>): DashboardFilters {
  const range = (Array.isArray(q.range) ? q.range[0] : q.range) as TimeRange | undefined
  const symbols = q.sym
    ? (Array.isArray(q.sym) ? q.sym : q.sym.split(',')).filter(Boolean)
    : []
  const setupTagIds = q.tag
    ? (Array.isArray(q.tag) ? q.tag : q.tag.split(',')).filter(Boolean)
    : []
  const instrument = (Array.isArray(q.inst) ? q.inst[0] : q.inst) as InstrumentFilter | undefined
  return {
    timeRange: VALID_RANGES.includes(range!) ? range! : '30d',
    customFrom: typeof q.from === 'string' ? q.from : null,
    customTo: typeof q.to === 'string' ? q.to : null,
    symbols,
    instrument: VALID_INSTRUMENTS.includes(instrument!) ? instrument! : 'all',
    setupTagIds,
  }
}

export function serializeFilters(f: DashboardFilters): Record<string, string> {
  const p: Record<string, string> = {}
  if (f.timeRange !== '30d') p.range = f.timeRange
  if (f.timeRange === 'custom') {
    if (f.customFrom) p.from = f.customFrom
    if (f.customTo) p.to = f.customTo
  }
  if (f.symbols.length) p.sym = f.symbols.join(',')
  if (f.instrument !== 'all') p.inst = f.instrument
  if (f.setupTagIds.length) p.tag = f.setupTagIds.join(',')
  return p
}

export function computeRange(f: DashboardFilters, now: Date): { from: Date; to: Date } {
  const DAY = 86_400_000
  if (f.timeRange === 'custom' && f.customFrom && f.customTo) {
    return {
      from: new Date(f.customFrom + 'T00:00:00Z'),
      to: new Date(f.customTo + 'T23:59:59Z'),
    }
  }
  if (f.timeRange === 'ytd') {
    return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), to: now }
  }
  if (f.timeRange === 'all') {
    return { from: new Date(0), to: now }
  }
  const daysBack = f.timeRange === '7d' ? 7 : f.timeRange === '90d' ? 90 : 30
  return { from: new Date(now.getTime() - daysBack * DAY), to: now }
}
```

Run: `pnpm vitest run tests/unit/lib/filters.test.ts` → expect 3 passing.

- [ ] **Step 2: `src/server/dashboard.ts`**

```ts
import { createServerFn } from '@tanstack/start-client-core'
import { getWebRequest } from 'vinxi/http'
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '~/auth/server'
import { db } from '~/db/client'
import {
  summaryRollup, dailyMetric, assetMetric, sessionMetric, finding, position,
} from '~/db/schema/derivation'
import { fill } from '~/db/schema/canonical'
import { DERIVATION_VERSION } from '~/derivation/version'
import { parseFilters, computeRange } from '~/lib/filters'
import type { DashboardBundle, DashboardKpiDelta } from '~/domain/dashboard'

const input = z.object({
  range: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  sym: z.string().optional(),
  inst: z.string().optional(),
  tag: z.string().optional(),
})

function kpi(value: number, prior: number | null): DashboardKpiDelta {
  if (prior === null || prior === 0) return { value, deltaPct: null }
  return { value, deltaPct: ((value - prior) / Math.abs(prior)) * 100 }
}

export const getDashboardBundle = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data }): Promise<DashboardBundle> => {
    const session = await auth.api.getSession({ headers: getWebRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    const userId = session.user.id
    const now = new Date()
    const filters = parseFilters(data as Record<string, string>)
    const { from, to } = computeRange(filters, now)
    const version = DERIVATION_VERSION

    // Summary rollup for this user/version
    const summaryRow = await db.query.summaryRollup.findFirst({
      where: and(eq(summaryRollup.userId, userId), eq(summaryRollup.derivationVersion, version)),
    })

    // Daily rows in range
    const dailyRows = await db.select().from(dailyMetric).where(
      and(
        eq(dailyMetric.userId, userId),
        eq(dailyMetric.derivationVersion, version),
        gte(dailyMetric.date, from.toISOString().slice(0, 10)),
        lte(dailyMetric.date, to.toISOString().slice(0, 10)),
      ),
    ).orderBy(dailyMetric.date)

    // Prior-period daily rows for deltas (same length window ending at from)
    const priorFromMs = from.getTime() - (to.getTime() - from.getTime())
    const priorFrom = new Date(priorFromMs)
    const priorDailyRows = await db.select().from(dailyMetric).where(
      and(
        eq(dailyMetric.userId, userId),
        eq(dailyMetric.derivationVersion, version),
        gte(dailyMetric.date, priorFrom.toISOString().slice(0, 10)),
        lte(dailyMetric.date, from.toISOString().slice(0, 10)),
      ),
    )

    const assetRows = await db.select().from(assetMetric).where(
      and(eq(assetMetric.userId, userId), eq(assetMetric.derivationVersion, version)),
    ).orderBy(desc(assetMetric.realizedPnl))

    const sessionRows = await db.select().from(sessionMetric).where(
      and(eq(sessionMetric.userId, userId), eq(sessionMetric.derivationVersion, version)),
    ).orderBy(sessionMetric.hourOfDayUtc)

    const topFindings = await db.select().from(finding).where(
      and(eq(finding.userId, userId), eq(finding.derivationVersion, version)),
    ).orderBy(desc(finding.createdAt)).limit(5)

    const totalFillCount = await db.$count(fill, eq(fill.userId, userId))
    const totalPositionCount = await db.$count(position, and(eq(position.userId, userId), eq(position.derivationVersion, version)))

    // Heatmap: reuse sessionBreakdown for hour axis. Day-of-week axis requires a second pass
    // grouped by day-of-week. For v1, include hour only (dayOfWeek set to 0 as placeholder); a
    // later task can enrich this via a new derived table. Chart renders a 1-row strip for now.
    const heatmap = sessionRows.map(s => ({
      hourOfDayUtc: s.hourOfDayUtc,
      dayOfWeekUtc: 0,
      tradeCount: s.tradeCount,
      expectancy: Number(s.expectancy),
    }))

    // Build KPI deltas
    const sumPnl = (rows: typeof dailyRows) => rows.reduce((a, b) => a + Number(b.realizedPnl), 0)
    const sumCount = (rows: typeof dailyRows) => rows.reduce((a, b) => a + b.tradeCount, 0)
    const winRate = (rows: typeof dailyRows) => {
      const w = rows.reduce((a, b) => a + b.winCount, 0)
      const total = rows.reduce((a, b) => a + b.winCount + b.lossCount, 0)
      return total === 0 ? 0 : w / total
    }
    const expectancy = (rows: typeof dailyRows) => {
      const pnl = sumPnl(rows)
      const count = sumCount(rows)
      return count === 0 ? 0 : pnl / count
    }

    const curPnl = sumPnl(dailyRows)
    const priorPnl = sumPnl(priorDailyRows)
    const curCount = sumCount(dailyRows)
    const priorCount = sumCount(priorDailyRows)

    // Equity curve = cumulative sum of daily realizedPnl within range
    let cum = 0
    const equityCurve = dailyRows.map(r => {
      cum += Number(r.realizedPnl)
      return { date: r.date, cumulativePnl: cum }
    })

    // Sparkline = last 30 days regardless of filter range (for KPI tiles)
    const last30Start = new Date(now.getTime() - 30 * 86_400_000)
    const sparkRows = await db.select().from(dailyMetric).where(
      and(
        eq(dailyMetric.userId, userId),
        eq(dailyMetric.derivationVersion, version),
        gte(dailyMetric.date, last30Start.toISOString().slice(0, 10)),
      ),
    ).orderBy(dailyMetric.date)
    let sparkCum = 0
    const sparkline = sparkRows.map(r => {
      sparkCum += Number(r.realizedPnl)
      return { date: r.date, pnl: Number(r.realizedPnl), cumulativePnl: sparkCum }
    })

    return {
      filters,
      summary: summaryRow
        ? {
            totalPnl: Number(summaryRow.totalPnl),
            grossProfit: Number(summaryRow.grossProfit),
            grossLoss: Number(summaryRow.grossLoss),
            totalFees: Number(summaryRow.totalFees),
            winRate: Number(summaryRow.winRate),
            expectancy: Number(summaryRow.expectancy),
            avgWin: Number(summaryRow.avgWin),
            avgLoss: Number(summaryRow.avgLoss),
            profitFactor: summaryRow.profitFactor != null ? Number(summaryRow.profitFactor) : null,
            maxDrawdown: Number(summaryRow.maxDrawdown),
            tradeCount: summaryRow.tradeCount,
            medianPositionSizeUsd: Number(summaryRow.medianPositionSizeUsd),
          }
        : emptySummary(),
      kpis: {
        realizedPnl: kpi(curPnl, priorDailyRows.length ? priorPnl : null),
        winRate:     kpi(winRate(dailyRows), priorDailyRows.length ? winRate(priorDailyRows) : null),
        expectancy:  kpi(expectancy(dailyRows), priorDailyRows.length ? expectancy(priorDailyRows) : null),
        tradeCount:  kpi(curCount, priorDailyRows.length ? priorCount : null),
        maxDrawdown: kpi(Number(summaryRow?.maxDrawdown ?? 0), null),
      },
      sparkline,
      equityCurve,
      heatmap,
      assetBreakdown: assetRows.map(r => ({
        symbol: r.symbol,
        tradeCount: r.tradeCount,
        realizedPnl: Number(r.realizedPnl),
        winRate: Number(r.winRate),
        avgWin: Number(r.avgWin),
        avgLoss: Number(r.avgLoss),
        expectancy: Number(r.expectancy),
      })),
      sessionBreakdown: sessionRows.map(r => ({
        hourOfDayUtc: r.hourOfDayUtc,
        tradeCount: r.tradeCount,
        realizedPnl: Number(r.realizedPnl),
        winRate: Number(r.winRate),
        expectancy: Number(r.expectancy),
      })),
      topFindings: topFindings.map(f => ({
        id: f.id,
        userId: f.userId,
        detectorId: f.detectorId as never,
        severity: f.severity,
        title: f.title,
        bodyMarkdown: f.bodyMarkdown,
        evidence: f.evidence,
        referencedPositionIds: f.referencedPositionIds,
        periodStart: f.periodStart,
        periodEnd: f.periodEnd,
        derivationVersion: f.derivationVersion,
      })),
      meta: {
        totalFillCount,
        totalPositionCount,
        lastDerivationAt: summaryRow?.updatedAt ?? null,
        derivationVersion: version,
      },
    }
  })

function emptySummary() {
  return {
    totalPnl: 0, grossProfit: 0, grossLoss: 0, totalFees: 0,
    winRate: 0, expectancy: 0, avgWin: 0, avgLoss: 0,
    profitFactor: null, maxDrawdown: 0, tradeCount: 0, medianPositionSizeUsd: 0,
  }
}
```

Notes:
- `symbol` / `instrument` / `setupTag` filters are **not yet wired into the metric queries** — they require either a) joining through `position` and recomputing aggregates per filter, or b) precomputing per-filter rollups. For Phase 3 we accept the limitation and show unfiltered metrics with the filter UI present but not functional for the per-symbol/instrument case. Add a TODO comment in the handler. The `timeRange` filter IS honoured (via the `date` range on `dailyMetric`).

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm typecheck
git add src/lib/filters.ts src/server/dashboard.ts tests/unit/lib/filters.test.ts
git commit -m "feat(server): dashboard bundle server fn + URL filter helpers

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5 — Trade list server function

**Why:** The `/app/trades` page needs a paginated, filterable list with a shape tailored to the dense table (exchange icon, symbol + instrument, side, prices, size, duration, PnL, fees, tag chips, note indicator).

**Files:**
- Modify: `src/server/trades.ts` (create new file)
- Create: `tests/unit/server/trades.test.ts` (input-validator shape tests only — full DB integration is out of scope)

- [ ] **Step 1: Create `src/server/trades.ts`**

```ts
import { createServerFn } from '@tanstack/start-client-core'
import { getWebRequest } from 'vinxi/http'
import { and, desc, eq, gte, inArray, lte, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '~/auth/server'
import { db } from '~/db/client'
import { position } from '~/db/schema/derivation'
import { positionTag, tradeNote } from '~/db/schema/journal'
import { DERIVATION_VERSION } from '~/derivation/version'

const listInput = z.object({
  symbols: z.array(z.string()).optional(),
  instrument: z.enum(['all', 'spot', 'perp']).optional(),
  side: z.enum(['all', 'long', 'short']).optional(),
  pnl: z.enum(['all', 'winners', 'losers']).optional(),
  from: z.string().optional(),   // yyyy-mm-dd
  to: z.string().optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
})

export type TradeListRow = {
  id: string
  exchange: string
  symbol: string
  instrumentType: 'spot' | 'perp'
  side: 'long' | 'short'
  entryAvgPrice: number
  exitAvgPrice: number | null
  notionalUsd: number
  holdSeconds: number | null
  realizedPnl: number
  realizedPnlPct: number | null
  totalFees: number
  openedAt: Date
  closedAt: Date | null
  tagCount: number
  hasNote: boolean
  wasLiquidated: boolean
}

export const getTradeList = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => listInput.parse(d))
  .handler(async ({ data }): Promise<{ rows: TradeListRow[]; total: number }> => {
    const session = await auth.api.getSession({ headers: getWebRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    const userId = session.user.id

    const where = [eq(position.userId, userId), eq(position.derivationVersion, DERIVATION_VERSION)]
    if (data.symbols?.length) where.push(inArray(position.symbol, data.symbols))
    if (data.instrument && data.instrument !== 'all') where.push(eq(position.instrumentType, data.instrument))
    if (data.side && data.side !== 'all') where.push(eq(position.side, data.side))
    if (data.from) where.push(gte(position.openedAt, new Date(data.from + 'T00:00:00Z')))
    if (data.to) where.push(lte(position.openedAt, new Date(data.to + 'T23:59:59Z')))
    if (data.pnl === 'winners') where.push(sql`CAST(${position.realizedPnl} AS numeric) > 0`)
    if (data.pnl === 'losers')  where.push(sql`CAST(${position.realizedPnl} AS numeric) < 0`)
    if (data.search) where.push(ilike(position.symbol, `%${data.search}%`))

    const rows = await db.select().from(position)
      .where(and(...where))
      .orderBy(desc(position.openedAt))
      .limit(data.limit)
      .offset(data.offset)

    const total = await db.$count(position, and(...where))

    const ids = rows.map(r => r.id)
    const tags = ids.length ? await db.select({ positionId: positionTag.positionId }).from(positionTag).where(inArray(positionTag.positionId, ids)) : []
    const notes = ids.length ? await db.select({ positionId: tradeNote.positionId }).from(tradeNote).where(inArray(tradeNote.positionId, ids)) : []
    const tagMap = new Map<string, number>()
    for (const t of tags) tagMap.set(t.positionId, (tagMap.get(t.positionId) ?? 0) + 1)
    const noteSet = new Set(notes.map(n => n.positionId))

    return {
      total,
      rows: rows.map(r => {
        const realizedPnl = Number(r.realizedPnl)
        const notionalUsd = Number(r.notionalUsd)
        const holdSeconds = r.closedAt ? Math.round((r.closedAt.getTime() - r.openedAt.getTime()) / 1000) : null
        return {
          id: r.id, exchange: r.exchange, symbol: r.symbol, instrumentType: r.instrumentType, side: r.side,
          entryAvgPrice: Number(r.entryAvgPrice),
          exitAvgPrice: r.exitAvgPrice ? Number(r.exitAvgPrice) : null,
          notionalUsd, holdSeconds, realizedPnl,
          realizedPnlPct: notionalUsd === 0 ? null : (realizedPnl / notionalUsd) * 100,
          totalFees: Number(r.totalFees),
          openedAt: r.openedAt, closedAt: r.closedAt,
          tagCount: tagMap.get(r.id) ?? 0,
          hasNote: noteSet.has(r.id),
          wasLiquidated: r.wasLiquidated,
        }
      }),
    }
  })
```

- [ ] **Step 2: Validator shape test**

```ts
// tests/unit/server/trades.test.ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

// Import schema indirectly by re-exporting from server/trades.ts is awkward.
// Instead, assert the shape of the input validator via a lightweight replica here that tests the
// canonical enums. If you change enums, update both places. This is a smoke test for drift.
const input = z.object({
  symbols: z.array(z.string()).optional(),
  instrument: z.enum(['all', 'spot', 'perp']).optional(),
  side: z.enum(['all', 'long', 'short']).optional(),
  pnl: z.enum(['all', 'winners', 'losers']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
})

describe('getTradeList input', () => {
  it('accepts minimal payload', () => {
    expect(() => input.parse({})).not.toThrow()
  })
  it('rejects bad instrument', () => {
    expect(() => input.parse({ instrument: 'bogus' })).toThrow()
  })
  it('clamps limit', () => {
    expect(() => input.parse({ limit: 1000 })).toThrow()
  })
})
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm typecheck
git add src/server/trades.ts tests/unit/server/trades.test.ts
git commit -m "feat(server): getTradeList with filter + pagination

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6 — Trade detail server function

**Files:**
- Modify: `src/server/trades.ts` (append `getTradeDetail`)

- [ ] **Step 1: Append to `src/server/trades.ts`**

```ts
import { positionFill } from '~/db/schema/derivation'
import { fill as fillTable } from '~/db/schema/canonical'
import { finding } from '~/db/schema/derivation'
import { tradeNote, positionTag, positionReflection, setupTag, mistakeTag } from '~/db/schema/journal'

const detailInput = z.object({ positionId: z.string().min(1) })

export type TradeDetailBundle = {
  position: {
    id: string; exchange: string; symbol: string
    instrumentType: 'spot' | 'perp'; side: 'long' | 'short'
    entryAvgPrice: number; exitAvgPrice: number | null
    size: number; notionalUsd: number; maxNotionalUsd: number
    realizedPnl: number; totalFees: number; fundingPnl: number
    wasLiquidated: boolean; needsReview: boolean
    openedAt: Date; closedAt: Date | null
    derivationVersion: number
  }
  fills: Array<{
    id: string; role: 'open' | 'add' | 'reduce' | 'close'
    price: number; size: number; fee: number
    executedAt: Date; normalizerHint: Record<string, unknown> | null
  }>
  findings: Array<{
    id: string; detectorId: string; severity: string; title: string; bodyMarkdown: string
    evidence: unknown
  }>
  note: { bodyMarkdown: string; updatedAt: Date } | null
  reflection: {
    confidence: number | null
    emotionalState: string | null
    reflectionMarkdown: string | null
  } | null
  tags: { setupTagIds: string[]; mistakeTagIds: string[] }
  availableTags: {
    setup: Array<{ id: string; label: string; color: string | null }>
    mistake: Array<{ id: string; label: string; color: string | null }>
  }
}

export const getTradeDetail = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => detailInput.parse(d))
  .handler(async ({ data }): Promise<TradeDetailBundle> => {
    const session = await auth.api.getSession({ headers: getWebRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    const userId = session.user.id

    const pos = await db.query.position.findFirst({
      where: and(eq(position.id, data.positionId), eq(position.userId, userId)),
    })
    if (!pos) throw new Error('Not found')

    const pfs = await db.select().from(positionFill).where(eq(positionFill.positionId, pos.id))
    const fillIds = pfs.map(pf => pf.fillId)
    const fills = fillIds.length
      ? await db.select().from(fillTable).where(inArray(fillTable.id, fillIds))
      : []
    const fillMap = new Map(fills.map(f => [f.id, f]))

    const findings = await db.select().from(finding).where(
      and(eq(finding.userId, userId), sql`${pos.id} = ANY(${finding.referencedPositionIds})`),
    )

    const noteRow = await db.query.tradeNote.findFirst({
      where: and(eq(tradeNote.userId, userId), eq(tradeNote.positionId, pos.id)),
    })
    const reflRow = await db.query.positionReflection.findFirst({
      where: and(eq(positionReflection.userId, userId), eq(positionReflection.positionId, pos.id)),
    })
    const tagRows = await db.select().from(positionTag).where(
      and(eq(positionTag.userId, userId), eq(positionTag.positionId, pos.id)),
    )
    const setups = await db.select().from(setupTag).where(eq(setupTag.userId, userId))
    const mistakes = await db.select().from(mistakeTag).where(eq(mistakeTag.userId, userId))

    return {
      position: {
        id: pos.id, exchange: pos.exchange, symbol: pos.symbol,
        instrumentType: pos.instrumentType, side: pos.side,
        entryAvgPrice: Number(pos.entryAvgPrice),
        exitAvgPrice: pos.exitAvgPrice ? Number(pos.exitAvgPrice) : null,
        size: Number(pos.size), notionalUsd: Number(pos.notionalUsd),
        maxNotionalUsd: Number(pos.maxNotionalUsd),
        realizedPnl: Number(pos.realizedPnl),
        totalFees: Number(pos.totalFees),
        fundingPnl: Number(pos.fundingPnl),
        wasLiquidated: pos.wasLiquidated, needsReview: pos.needsReview,
        openedAt: pos.openedAt, closedAt: pos.closedAt,
        derivationVersion: pos.derivationVersion,
      },
      fills: pfs.map(pf => {
        const f = fillMap.get(pf.fillId)!
        return {
          id: f.id, role: pf.role,
          price: Number(f.price), size: Number(f.size), fee: Number(f.fee),
          executedAt: f.executedAt,
          normalizerHint: (f.normalizerHint as Record<string, unknown> | null) ?? null,
        }
      }).sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime()),
      findings: findings.map(f => ({
        id: f.id, detectorId: f.detectorId, severity: f.severity,
        title: f.title, bodyMarkdown: f.bodyMarkdown, evidence: f.evidence,
      })),
      note: noteRow ? { bodyMarkdown: noteRow.bodyMarkdown, updatedAt: noteRow.updatedAt } : null,
      reflection: reflRow
        ? {
            confidence: reflRow.confidence,
            emotionalState: reflRow.emotionalState,
            reflectionMarkdown: reflRow.reflectionMarkdown,
          }
        : null,
      tags: {
        setupTagIds:   tagRows.filter(t => t.kind === 'setup').map(t => t.setupTagId!).filter(Boolean),
        mistakeTagIds: tagRows.filter(t => t.kind === 'mistake').map(t => t.mistakeTagId!).filter(Boolean),
      },
      availableTags: {
        setup:   setups.filter(s => !s.isArchived).map(s => ({ id: s.id, label: s.label, color: s.color })),
        mistake: mistakes.filter(m => !m.isArchived).map(m => ({ id: m.id, label: m.label, color: m.color })),
      },
    }
  })
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm typecheck
git add src/server/trades.ts
git commit -m "feat(server): getTradeDetail bundle (position + fills + findings + journal)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7 — Journal mutation server functions

**Files:**
- Create: `src/server/journal.ts`
- Create: `tests/unit/server/journal.test.ts` (validator shape tests)

- [ ] **Step 1: `src/server/journal.ts`**

```ts
import { createServerFn } from '@tanstack/start-client-core'
import { getWebRequest } from 'vinxi/http'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '~/auth/server'
import { db } from '~/db/client'
import {
  tradeNote, setupTag, mistakeTag, positionTag, positionReflection,
} from '~/db/schema/journal'
import { position } from '~/db/schema/derivation'

async function requireOwnership(positionId: string, userId: string) {
  const row = await db.query.position.findFirst({
    where: and(eq(position.id, positionId), eq(position.userId, userId)),
  })
  if (!row) throw new Error('Position not found')
  return row
}

// --- Notes ---
const upsertNoteInput = z.object({
  positionId: z.string().min(1),
  bodyMarkdown: z.string().max(20_000),
})

export const upsertTradeNote = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => upsertNoteInput.parse(d))
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: getWebRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    const userId = session.user.id
    await requireOwnership(data.positionId, userId)
    const id = `note_${userId.slice(0, 8)}_${data.positionId.slice(-12)}`
    await db.insert(tradeNote).values({
      id, userId, positionId: data.positionId, bodyMarkdown: data.bodyMarkdown,
    }).onConflictDoUpdate({
      target: [tradeNote.userId, tradeNote.positionId],
      set: { bodyMarkdown: data.bodyMarkdown, updatedAt: new Date() },
    })
    return { ok: true }
  })

// --- Tags (apply/remove) ---
const applyTagInput = z.object({
  positionIds: z.array(z.string().min(1)).min(1).max(200),
  kind: z.enum(['setup', 'mistake']),
  setupTagId: z.string().optional(),
  mistakeTagId: z.string().optional(),
}).refine(
  d => (d.kind === 'setup' && !!d.setupTagId) || (d.kind === 'mistake' && !!d.mistakeTagId),
  { message: 'setupTagId required for setup / mistakeTagId required for mistake' },
)

export const applyPositionTag = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => applyTagInput.parse(d))
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: getWebRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    const userId = session.user.id
    // Batch-verify ownership
    const owned = await db.select({ id: position.id }).from(position)
      .where(and(eq(position.userId, userId)))
    const ownedSet = new Set(owned.map(p => p.id))
    const rows = data.positionIds.filter(pid => ownedSet.has(pid)).map(pid => ({
      id: `pt_${pid}_${data.kind}_${data.setupTagId ?? data.mistakeTagId}`,
      userId, positionId: pid, kind: data.kind,
      setupTagId: data.setupTagId ?? null,
      mistakeTagId: data.mistakeTagId ?? null,
    }))
    if (!rows.length) return { applied: 0 }
    await db.insert(positionTag).values(rows).onConflictDoNothing()
    return { applied: rows.length }
  })

const removeTagInput = z.object({
  positionId: z.string().min(1),
  kind: z.enum(['setup', 'mistake']),
  setupTagId: z.string().optional(),
  mistakeTagId: z.string().optional(),
})

export const removePositionTag = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => removeTagInput.parse(d))
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: getWebRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    const userId = session.user.id
    const conds = [
      eq(positionTag.userId, userId),
      eq(positionTag.positionId, data.positionId),
      eq(positionTag.kind, data.kind),
    ]
    if (data.setupTagId)   conds.push(eq(positionTag.setupTagId, data.setupTagId))
    if (data.mistakeTagId) conds.push(eq(positionTag.mistakeTagId, data.mistakeTagId))
    await db.delete(positionTag).where(and(...conds))
    return { ok: true }
  })

// --- Tag catalogue (create custom setup / mistake tags) ---
const createTagInput = z.object({
  kind: z.enum(['setup', 'mistake']),
  label: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})

export const createTag = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => createTagInput.parse(d))
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: getWebRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    const userId = session.user.id
    const slug = data.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)
    if (data.kind === 'setup') {
      const id = `st_${userId.slice(0, 8)}_${slug}`
      await db.insert(setupTag).values({ id, userId, label: data.label, color: data.color ?? null })
        .onConflictDoNothing()
      return { id, kind: 'setup' as const, label: data.label, color: data.color ?? null }
    }
    const id = `mt_${userId.slice(0, 8)}_${slug}`
    await db.insert(mistakeTag).values({ id, userId, label: data.label, color: data.color ?? null, isDefault: false })
      .onConflictDoNothing()
    return { id, kind: 'mistake' as const, label: data.label, color: data.color ?? null }
  })

// --- Reflections ---
const upsertReflectionInput = z.object({
  positionId: z.string().min(1),
  confidence: z.number().int().min(1).max(5).nullable(),
  emotionalState: z.enum(['calm','fomo','revenge','bored','anxious','confident']).nullable(),
  reflectionMarkdown: z.string().max(5_000).nullable(),
})

export const upsertReflection = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => upsertReflectionInput.parse(d))
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: getWebRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    const userId = session.user.id
    await requireOwnership(data.positionId, userId)
    const id = `pr_${userId.slice(0, 8)}_${data.positionId.slice(-12)}`
    await db.insert(positionReflection).values({
      id, userId, positionId: data.positionId,
      confidence: data.confidence, emotionalState: data.emotionalState,
      reflectionMarkdown: data.reflectionMarkdown,
    }).onConflictDoUpdate({
      target: [positionReflection.userId, positionReflection.positionId],
      set: {
        confidence: data.confidence,
        emotionalState: data.emotionalState,
        reflectionMarkdown: data.reflectionMarkdown,
        updatedAt: new Date(),
      },
    })
    return { ok: true }
  })
```

- [ ] **Step 2: Shape test (`tests/unit/server/journal.test.ts`)**

```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

describe('journal validator shapes', () => {
  it('applyPositionTag requires matching id for kind', () => {
    const input = z.object({
      positionIds: z.array(z.string().min(1)).min(1).max(200),
      kind: z.enum(['setup', 'mistake']),
      setupTagId: z.string().optional(),
      mistakeTagId: z.string().optional(),
    }).refine(
      d => (d.kind === 'setup' && !!d.setupTagId) || (d.kind === 'mistake' && !!d.mistakeTagId),
    )
    expect(() => input.parse({ positionIds: ['p1'], kind: 'setup' })).toThrow()
    expect(() => input.parse({ positionIds: ['p1'], kind: 'setup', setupTagId: 'st1' })).not.toThrow()
    expect(() => input.parse({ positionIds: ['p1'], kind: 'mistake', mistakeTagId: 'mt1' })).not.toThrow()
  })
})
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm typecheck
pnpm vitest run tests/unit/server/journal.test.ts
git add src/server/journal.ts tests/unit/server/journal.test.ts
git commit -m "feat(server): journal mutations — notes, tags, reflections, custom tag creation

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8 — Global shell polish (TopBar + VersionBadge)

**Files:**
- Create: `src/components/shell/TopBar.tsx`
- Create: `src/components/shell/VersionBadge.tsx`
- Modify: `app/routes/(app)/_layout.tsx`

- [ ] **Step 1: `VersionBadge.tsx`**

```tsx
import { DERIVATION_VERSION } from '~/derivation/version'

export function VersionBadge() {
  return (
    <span
      title="Analysis engine version — bumps when detector logic changes"
      className="inline-flex items-center rounded-md border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-xs text-neutral-400 font-mono tabular-nums"
    >
      v{DERIVATION_VERSION}
    </span>
  )
}
```

- [ ] **Step 2: `TopBar.tsx`**

```tsx
import { Link } from '@tanstack/react-router'
import { VersionBadge } from './VersionBadge'

const NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/trades',    label: 'Trades' },
  { to: '/digest',    label: 'Digest' },
  { to: '/import',    label: 'Import' },
] as const

export function TopBar({ userEmail }: { userEmail: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link to="/dashboard" className="text-sm font-semibold tracking-tight">
            <span className="text-brand">Post</span>
            <span className="text-neutral-300"> · Trade Journal</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm text-neutral-400">
            {NAV.map(n => (
              <Link key={n.to} to={n.to} className="hover:text-white transition-colors [&.active]:text-white [&.active]:font-medium">
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <VersionBadge />
          <div className="text-xs text-neutral-500">{userEmail}</div>
        </div>
      </div>
    </header>
  )
}
```

- [ ] **Step 3: Wire into `_layout.tsx`**

Replace the current inline `<header>` with `<TopBar userEmail={user.email} />`. Keep `<Outlet />` below it. Tighten the main column to `max-w-[1280px] px-6 py-6`.

- [ ] **Step 4: Confirm brand color exists in `tailwind.config.ts`**

Look for `brand: '#ea580c'` in the theme extend. If it's missing, add:

```ts
extend: {
  colors: {
    brand: '#ea580c',
    'pnl-win':  '#16a34a',
    'pnl-loss': '#dc2626',
  },
}
```

- [ ] **Step 5: Commit**

```bash
pnpm typecheck
git add src/components/shell app/routes/\(app\)/_layout.tsx tailwind.config.ts
git commit -m "feat(shell): top bar with brand, nav, version badge

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 9 — Dashboard controls row + URL-persisted filters

**Files:**
- Create: `src/hooks/useDashboardFilters.ts`
- Create: `src/components/dashboard/ControlsRow.tsx`
- Replace: `app/routes/(app)/dashboard.tsx` (scaffold only — KPIs/charts added in next tasks)

- [ ] **Step 1: `src/hooks/useDashboardFilters.ts`**

```ts
import { useSearch, useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'
import { parseFilters, serializeFilters } from '~/lib/filters'
import type { DashboardFilters } from '~/domain/dashboard'

export function useDashboardFilters(): [DashboardFilters, (next: DashboardFilters) => void] {
  const search = useSearch({ strict: false }) as Record<string, string>
  const nav = useNavigate()
  const filters = parseFilters(search)
  const setFilters = useCallback((next: DashboardFilters) => {
    const serialized = serializeFilters(next)
    nav({ to: '.', search: () => serialized as never, replace: true })
  }, [nav])
  return [filters, setFilters]
}
```

- [ ] **Step 2: `src/components/dashboard/ControlsRow.tsx`**

```tsx
import type { DashboardFilters, TimeRange } from '~/domain/dashboard'
import { Button } from '~/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'

const RANGES: Array<{ id: TimeRange; label: string }> = [
  { id: '7d',   label: '7D'  },
  { id: '30d',  label: '30D' },
  { id: '90d',  label: '90D' },
  { id: 'ytd',  label: 'YTD' },
  { id: 'all',  label: 'All' },
]

export function ControlsRow({
  filters, onChange, availableSymbols,
}: {
  filters: DashboardFilters
  onChange: (next: DashboardFilters) => void
  availableSymbols: string[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ToggleGroup
        type="single"
        value={filters.timeRange}
        onValueChange={(v) => v && onChange({ ...filters, timeRange: v as TimeRange })}
      >
        {RANGES.map(r => (
          <ToggleGroupItem key={r.id} value={r.id} aria-label={`Range ${r.label}`} className="font-mono tabular-nums text-xs">
            {r.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="flex-1" />

      <ToggleGroup
        type="single"
        value={filters.instrument}
        onValueChange={(v) => v && onChange({ ...filters, instrument: v as DashboardFilters['instrument'] })}
      >
        <ToggleGroupItem value="all"  className="text-xs">All</ToggleGroupItem>
        <ToggleGroupItem value="spot" className="text-xs">Spot</ToggleGroupItem>
        <ToggleGroupItem value="perp" className="text-xs">Perp</ToggleGroupItem>
      </ToggleGroup>

      <Button variant="outline" size="sm" disabled title="Symbol filter — coming soon">
        {filters.symbols.length ? `${filters.symbols.length} symbols` : 'All symbols'}
      </Button>

      <Button variant="outline" size="sm" disabled title="Export — coming in Phase 6">
        Export
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: Dashboard page scaffold**

```tsx
// app/routes/(app)/dashboard.tsx
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { getDashboardBundle } from '~/server/dashboard'
import { useDashboardFilters } from '~/hooks/useDashboardFilters'
import { ControlsRow } from '~/components/dashboard/ControlsRow'
import { serializeFilters } from '~/lib/filters'

export const Route = createFileRoute('/(app)/dashboard')({
  component: DashboardPage,
  validateSearch: (s: Record<string, unknown>) => s as Record<string, string>,
})

function DashboardPage() {
  const [filters, setFilters] = useDashboardFilters()
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', filters],
    queryFn: () => getDashboardBundle({ data: serializeFilters(filters) }),
    staleTime: 30_000,
  })

  if (error) return <ErrorState error={error} />

  return (
    <div className="flex flex-col gap-6">
      <ControlsRow
        filters={filters}
        onChange={setFilters}
        availableSymbols={data?.assetBreakdown.map(a => a.symbol) ?? []}
      />
      {isLoading || !data
        ? <DashboardSkeleton />
        : <DashboardContent bundle={data} />
      }
      {data && (
        <div className="border-t border-neutral-800 pt-4 text-xs text-neutral-500 font-mono tabular-nums">
          Analyzing {data.meta.totalFillCount.toLocaleString()} fills across {data.meta.totalPositionCount.toLocaleString()} positions · derivation v{data.meta.derivationVersion}
          {data.meta.lastDerivationAt && ` · last updated ${relativeTime(data.meta.lastDerivationAt)}`}
        </div>
      )}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-28 rounded-lg border border-neutral-800 bg-neutral-900/50 animate-pulse" />
        ))}
      </div>
      <div className="h-64 rounded-lg border border-neutral-800 bg-neutral-900/50 animate-pulse" />
      <div className="grid grid-cols-2 gap-4">
        <div className="h-64 rounded-lg border border-neutral-800 bg-neutral-900/50 animate-pulse" />
        <div className="h-64 rounded-lg border border-neutral-800 bg-neutral-900/50 animate-pulse" />
      </div>
    </div>
  )
}

function DashboardContent({ bundle }: { bundle: Awaited<ReturnType<typeof getDashboardBundle>> }) {
  // Populated by Tasks 10-13.
  return (
    <div className="grid grid-cols-[1fr_320px] gap-6">
      <div className="flex flex-col gap-6">
        {/* KPI tiles go here (Task 10) */}
        {/* Equity curve (Task 11) */}
        {/* Heatmap + Asset breakdown (Tasks 12-13) */}
      </div>
      <aside>
        {/* Findings sidebar (Task 13) */}
      </aside>
    </div>
  )
}

function ErrorState({ error }: { error: unknown }) {
  return (
    <div className="rounded-lg border border-pnl-loss/40 bg-pnl-loss/10 p-4 text-sm">
      <p className="font-medium text-pnl-loss">Failed to load dashboard</p>
      <p className="mt-1 text-xs text-neutral-400">{String((error as Error)?.message ?? error)}</p>
    </div>
  )
}

function relativeTime(d: Date): string {
  const diffMs = Date.now() - new Date(d).getTime()
  const mins = Math.round(diffMs / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm typecheck
git add src/hooks/useDashboardFilters.ts src/components/dashboard/ControlsRow.tsx app/routes/\(app\)/dashboard.tsx
git commit -m "feat(dashboard): scaffold with URL-persisted controls + skeleton

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 10 — KPI tiles with sparklines

**Files:**
- Create: `src/components/dashboard/KpiTile.tsx`
- Create: `src/components/dashboard/KpiTilesRow.tsx`
- Create: `src/lib/formatters.ts`
- Create: `tests/unit/components/KpiTile.test.tsx`

- [ ] **Step 1: `src/lib/formatters.ts`**

```ts
export function usd(n: number, opts: { signed?: boolean; short?: boolean } = {}): string {
  const sign = n > 0 && opts.signed ? '+' : ''
  if (opts.short && Math.abs(n) >= 1000) {
    return `${sign}$${(n / 1000).toFixed(Math.abs(n) >= 10_000 ? 0 : 1)}k`
  }
  return `${sign}$${n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 })}`
}

export function pct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`
}

export function deltaPct(n: number | null): string {
  if (n === null) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
}

export function duration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`
  return `${(seconds / 86400).toFixed(1)}d`
}
```

- [ ] **Step 2: `src/components/dashboard/KpiTile.tsx`**

```tsx
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
```

- [ ] **Step 3: `src/components/dashboard/KpiTilesRow.tsx`**

```tsx
import type { DashboardBundle } from '~/domain/dashboard'
import { KpiTile } from './KpiTile'
import { usd, pct } from '~/lib/formatters'

export function KpiTilesRow({ bundle }: { bundle: DashboardBundle }) {
  const { kpis, sparkline } = bundle
  return (
    <div className="grid grid-cols-5 gap-4">
      <KpiTile label="Realized PnL"     kpi={kpis.realizedPnl} format={(v) => usd(v, { signed: true })} sparkline={sparkline} />
      <KpiTile label="Win rate"          kpi={kpis.winRate}     format={(v) => pct(v)} spark={false} />
      <KpiTile label="Expectancy / trade" kpi={kpis.expectancy}  format={(v) => usd(v, { signed: true })} spark={false} />
      <KpiTile label="Trade count"       kpi={kpis.tradeCount}  format={(v) => String(Math.round(v))} spark={false} />
      <KpiTile label="Max drawdown"      kpi={kpis.maxDrawdown} format={(v) => usd(-Math.abs(v))} spark={false} />
    </div>
  )
}
```

- [ ] **Step 4: Test `tests/unit/components/KpiTile.test.tsx`**

```tsx
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
```

**Note:** If `@testing-library/react` is not installed, this task's dep install is: `pnpm add -D @testing-library/react @testing-library/jest-dom jsdom happy-dom`. Update `vitest.config.ts` to set `test.environment = 'jsdom'` (or `happy-dom`). If already set up from Phase 0, skip.

- [ ] **Step 5: Wire tiles into dashboard page**

In `DashboardContent`, add `<KpiTilesRow bundle={bundle} />` as the first child of the left column.

- [ ] **Step 6: Commit**

```bash
pnpm typecheck && pnpm vitest run tests/unit/components/KpiTile.test.tsx
git add src/lib/formatters.ts src/components/dashboard/KpiTile.tsx src/components/dashboard/KpiTilesRow.tsx app/routes/\(app\)/dashboard.tsx tests/unit/components/KpiTile.test.tsx
git commit -m "feat(dashboard): 5 KPI tiles with sparkline on realized PnL

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 11 — Equity curve card

**Files:**
- Create: `src/components/dashboard/EquityCurveCard.tsx`

- [ ] **Step 1: `EquityCurveCard.tsx`**

```tsx
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
              formatter={(v: number) => usd(v, { signed: true })}
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
```

- [ ] **Step 2: Slot into `DashboardContent`**

Add `<EquityCurveCard bundle={bundle} />` as the second child of the left column.

- [ ] **Step 3: Commit**

```bash
pnpm typecheck
git add src/components/dashboard/EquityCurveCard.tsx app/routes/\(app\)/dashboard.tsx
git commit -m "feat(dashboard): equity curve area chart

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 12 — Time-of-day heatmap card

**Why:** Spec §9.3 row 4 calls for a 24-hour × 7-day grid. Our `session_metric` table only has hour-of-day, not day-of-week (we'd need a second aggregate). For Phase 3 we render a **single-row, 24-column** hour strip using `bundle.sessionBreakdown` with diverging green/red expectancy color scale. Adding day-of-week requires a new metric table (parked as a Phase 6 follow-up noted in the wiki).

**Files:**
- Create: `src/components/dashboard/TimeOfDayHeatmapCard.tsx`

- [ ] **Step 1: `TimeOfDayHeatmapCard.tsx`**

```tsx
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
```

Add a `grid-cols-24` utility to `tailwind.config.ts`:
```ts
theme: { extend: { gridTemplateColumns: { '24': 'repeat(24, minmax(0, 1fr))' } } }
```

- [ ] **Step 2: Commit**

```bash
pnpm typecheck
git add src/components/dashboard/TimeOfDayHeatmapCard.tsx tailwind.config.ts
git commit -m "feat(dashboard): hour-of-day expectancy strip

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 13 — Asset PnL bars + findings sidebar

**Files:**
- Create: `src/components/dashboard/AssetBarsCard.tsx`
- Create: `src/components/dashboard/FindingsSidebar.tsx`

- [ ] **Step 1: `AssetBarsCard.tsx`**

```tsx
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
      <h3 className="text-sm font-medium mb-3">Top winners & losers by symbol</h3>
      <div className="h-64">
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 48 }}>
            <CartesianGrid stroke="#262626" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" stroke="#737373" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => usd(v, { short: true })} />
            <YAxis type="category" dataKey="symbol" stroke="#a3a3a3" fontSize={11} tickLine={false} axisLine={false} width={48} />
            <Tooltip
              contentStyle={{ background: '#171717', border: '1px solid #404040', borderRadius: 6, fontSize: 12 }}
              formatter={(v: number) => usd(v, { signed: true })}
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
        Click a bar label to filter trades. <Link to="/trades" className="text-brand hover:underline">Open trades list →</Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `FindingsSidebar.tsx`**

```tsx
import type { DashboardBundle } from '~/domain/dashboard'
import { Link } from '@tanstack/react-router'
import { Badge } from '~/components/ui/badge'

const DETECTOR_LABELS: Record<string, string> = {
  revenge_trading: 'Revenge trading',
  oversized_positions: 'Oversized positions',
  loss_of_discipline_windows: 'Discipline windows',
  position_sizing_instability: 'Sizing instability',
  cut_winners_ride_losers: 'Cut winners, ride losers',
  overtrading_after_losses: 'Overtrading after losses',
  fee_drag: 'Fee drag',
  scaling_into_losers: 'Scaling into losers',
  short_hold_scalping: 'Short-hold scalping',
  symbol_underperformance: 'Symbol underperformance',
  leverage_creep: 'Leverage creep',
}

export function FindingsSidebar({ bundle }: { bundle: DashboardBundle }) {
  const findings = bundle.topFindings
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <h3 className="text-sm font-medium mb-3">Active findings</h3>
      {findings.length === 0 ? (
        <p className="text-sm text-neutral-500">No active findings. Keep trading — patterns emerge over time.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {findings.map(f => (
            <li key={f.id} className="border-b border-neutral-800 last:border-b-0 pb-3 last:pb-0">
              <div className="flex items-start gap-2">
                <SeverityDot severity={f.severity} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-neutral-300">{DETECTOR_LABELS[f.detectorId] ?? f.detectorId}</span>
                    <Badge variant="outline" className="text-[10px]">{f.severity}</Badge>
                  </div>
                  <p className="text-xs text-neutral-400 mt-1 line-clamp-3">{f.bodyMarkdown}</p>
                  {f.referencedPositionIds.length > 0 && (
                    <Link
                      to="/trades/$positionId"
                      params={{ positionId: f.referencedPositionIds[0] }}
                      className="text-xs text-brand hover:underline mt-1 inline-block"
                    >
                      Open related trade →
                    </Link>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SeverityDot({ severity }: { severity: string }) {
  const cls =
    severity === 'critical' ? 'bg-pnl-loss' :
    severity === 'warning' ? 'bg-brand' : 'bg-neutral-500'
  return <span className={`mt-1 h-2 w-2 rounded-full ${cls} shrink-0`} aria-label={severity} />
}
```

- [ ] **Step 3: Wire into `DashboardContent`**

```tsx
function DashboardContent({ bundle }: { bundle: DashboardBundle }) {
  return (
    <div className="grid grid-cols-[1fr_320px] gap-6">
      <div className="flex flex-col gap-6">
        <KpiTilesRow bundle={bundle} />
        <EquityCurveCard bundle={bundle} />
        <div className="grid grid-cols-2 gap-4">
          <TimeOfDayHeatmapCard bundle={bundle} />
          <AssetBarsCard bundle={bundle} />
        </div>
      </div>
      <aside>
        <FindingsSidebar bundle={bundle} />
      </aside>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
pnpm typecheck
git add src/components/dashboard/AssetBarsCard.tsx src/components/dashboard/FindingsSidebar.tsx app/routes/\(app\)/dashboard.tsx
git commit -m "feat(dashboard): asset bars + active findings sidebar; full dashboard wired

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 14 — Trade list page (filter bar + table)

**Files:**
- Create: `app/routes/(app)/trades/index.tsx`
- Create: `src/components/trades/TradesFilterBar.tsx`
- Create: `src/components/trades/TradesTable.tsx`

- [ ] **Step 1: Trade list filter state hook (inline for now)**

Keep this lightweight — the filter state is local `useState` driven by URL search params on the trades page. Use `useSearch({ from: '/(app)/trades/' })` for the raw params.

- [ ] **Step 2: `TradesFilterBar.tsx`**

```tsx
import { Input } from '~/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { Button } from '~/components/ui/button'

export type TradesFilters = {
  search: string
  instrument: 'all' | 'spot' | 'perp'
  side: 'all' | 'long' | 'short'
  pnl: 'all' | 'winners' | 'losers'
}

export function TradesFilterBar({
  filters, onChange, resultCount,
}: { filters: TradesFilters; onChange: (next: TradesFilters) => void; resultCount: number }) {
  return (
    <div className="sticky top-14 z-30 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur px-6 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search symbol…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="w-48 h-8 text-xs"
          aria-label="Search symbol"
        />
        <ToggleGroup type="single" value={filters.instrument} onValueChange={(v) => v && onChange({ ...filters, instrument: v as TradesFilters['instrument'] })}>
          <ToggleGroupItem value="all"  className="text-xs">All</ToggleGroupItem>
          <ToggleGroupItem value="spot" className="text-xs">Spot</ToggleGroupItem>
          <ToggleGroupItem value="perp" className="text-xs">Perp</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" value={filters.side} onValueChange={(v) => v && onChange({ ...filters, side: v as TradesFilters['side'] })}>
          <ToggleGroupItem value="all"   className="text-xs">Any side</ToggleGroupItem>
          <ToggleGroupItem value="long"  className="text-xs">Long</ToggleGroupItem>
          <ToggleGroupItem value="short" className="text-xs">Short</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" value={filters.pnl} onValueChange={(v) => v && onChange({ ...filters, pnl: v as TradesFilters['pnl'] })}>
          <ToggleGroupItem value="all"      className="text-xs">All</ToggleGroupItem>
          <ToggleGroupItem value="winners"  className="text-xs">Winners</ToggleGroupItem>
          <ToggleGroupItem value="losers"   className="text-xs">Losers</ToggleGroupItem>
        </ToggleGroup>
        <div className="flex-1" />
        <span className="text-xs text-neutral-500 font-mono tabular-nums">{resultCount.toLocaleString()} trades</span>
        <Button size="sm" variant="outline" disabled>Bulk tag…</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: `TradesTable.tsx`**

```tsx
import { Link } from '@tanstack/react-router'
import { cn } from '~/lib/utils'
import type { TradeListRow } from '~/server/trades'
import { usd, pct, duration } from '~/lib/formatters'

export function TradesTable({
  rows, selectedIds, onToggleSelection, highlightedRowIdx, onHighlightRow,
}: {
  rows: TradeListRow[]
  selectedIds: Set<string>
  onToggleSelection: (id: string) => void
  highlightedRowIdx: number
  onHighlightRow: (idx: number) => void
}) {
  return (
    <table className="w-full text-xs border-collapse font-mono tabular-nums">
      <thead className="sticky top-28 bg-neutral-950 z-20 border-b border-neutral-800">
        <tr className="text-left text-neutral-400">
          <th className="py-2 pl-6 pr-2 font-medium"><span className="sr-only">Select</span></th>
          <th className="py-2 pr-3 font-medium">Symbol</th>
          <th className="py-2 pr-3 font-medium">Side</th>
          <th className="py-2 pr-3 font-medium text-right">Entry</th>
          <th className="py-2 pr-3 font-medium text-right">Exit</th>
          <th className="py-2 pr-3 font-medium text-right">Size $</th>
          <th className="py-2 pr-3 font-medium text-right">Hold</th>
          <th className="py-2 pr-3 font-medium text-right">PnL</th>
          <th className="py-2 pr-3 font-medium text-right">PnL %</th>
          <th className="py-2 pr-3 font-medium text-right">Fees</th>
          <th className="py-2 pr-6 font-medium"><span className="sr-only">Annotations</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr
            key={r.id}
            data-row-idx={i}
            onClick={() => onHighlightRow(i)}
            className={cn(
              'border-b border-neutral-900 hover:bg-neutral-900/40 cursor-pointer',
              highlightedRowIdx === i && 'bg-neutral-900/60',
              selectedIds.has(r.id) && 'bg-brand/10',
            )}
          >
            <td className="py-2 pl-6 pr-2 align-middle">
              <input
                type="checkbox"
                checked={selectedIds.has(r.id)}
                onChange={(e) => { e.stopPropagation(); onToggleSelection(r.id) }}
                aria-label={`Select ${r.symbol} trade`}
              />
            </td>
            <td className="py-2 pr-3">
              <Link to="/trades/$positionId" params={{ positionId: r.id }} className="hover:text-brand">
                <span className="text-neutral-200">{r.symbol}</span>
                <span className="ml-1 rounded bg-neutral-800 px-1 py-0.5 text-[10px] text-neutral-400">{r.instrumentType.toUpperCase()}</span>
              </Link>
            </td>
            <td className={cn('py-2 pr-3', r.side === 'long' ? 'text-pnl-win/80' : 'text-pnl-loss/80')}>{r.side}</td>
            <td className="py-2 pr-3 text-right text-neutral-300">{usd(r.entryAvgPrice)}</td>
            <td className="py-2 pr-3 text-right text-neutral-300">{r.exitAvgPrice == null ? 'open' : usd(r.exitAvgPrice)}</td>
            <td className="py-2 pr-3 text-right text-neutral-400">{usd(r.notionalUsd, { short: true })}</td>
            <td className="py-2 pr-3 text-right text-neutral-500">{duration(r.holdSeconds)}</td>
            <td className={cn('py-2 pr-3 text-right', r.realizedPnl > 0 ? 'text-pnl-win' : r.realizedPnl < 0 ? 'text-pnl-loss' : 'text-neutral-400')}>{usd(r.realizedPnl, { signed: true })}</td>
            <td className="py-2 pr-3 text-right text-neutral-500">{r.realizedPnlPct == null ? '—' : `${r.realizedPnlPct > 0 ? '+' : ''}${r.realizedPnlPct.toFixed(2)}%`}</td>
            <td className="py-2 pr-3 text-right text-neutral-500">{usd(r.totalFees)}</td>
            <td className="py-2 pr-6">
              <div className="flex items-center gap-1">
                {r.hasNote && <span title="Has note" className="h-1.5 w-1.5 rounded-full bg-brand" />}
                {r.tagCount > 0 && <span className="text-[10px] text-neutral-500">{r.tagCount}&thinsp;tag{r.tagCount > 1 && 's'}</span>}
                {r.wasLiquidated && <span className="text-[10px] text-pnl-loss">LIQ</span>}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 4: Trade list route**

```tsx
// app/routes/(app)/trades/index.tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { getTradeList } from '~/server/trades'
import { TradesFilterBar, type TradesFilters } from '~/components/trades/TradesFilterBar'
import { TradesTable } from '~/components/trades/TradesTable'

export const Route = createFileRoute('/(app)/trades/')({
  component: TradesPage,
  validateSearch: (s: Record<string, unknown>) => s as Record<string, string>,
})

function TradesPage() {
  const search = Route.useSearch()
  const nav = useNavigate({ from: '/trades' })

  const filters: TradesFilters = {
    search: search.search ?? '',
    instrument: (search.inst as TradesFilters['instrument']) ?? 'all',
    side: (search.side as TradesFilters['side']) ?? 'all',
    pnl: (search.pnl as TradesFilters['pnl']) ?? 'all',
  }
  function setFilters(next: TradesFilters) {
    const p: Record<string, string> = {}
    if (next.search) p.search = next.search
    if (next.instrument !== 'all') p.inst = next.instrument
    if (next.side !== 'all') p.side = next.side
    if (next.pnl !== 'all') p.pnl = next.pnl
    nav({ to: '.', search: () => p as never, replace: true })
  }

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [highlightedRowIdx, setHighlightedRowIdx] = useState(0)

  const { data, isLoading, error } = useQuery({
    queryKey: ['tradeList', filters],
    queryFn: () => getTradeList({
      data: {
        search: filters.search || undefined,
        instrument: filters.instrument,
        side: filters.side,
        pnl: filters.pnl,
        limit: 200,
      },
    }),
    staleTime: 60_000,
  })

  function toggleSel(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="-mx-6 -mt-6">
      <TradesFilterBar filters={filters} onChange={setFilters} resultCount={data?.total ?? 0} />
      <div className="overflow-x-auto">
        {error
          ? <p className="p-6 text-sm text-pnl-loss">Failed to load trades.</p>
          : isLoading || !data
            ? <p className="p-6 text-sm text-neutral-500">Loading trades…</p>
            : data.rows.length === 0
              ? <p className="p-6 text-sm text-neutral-500">No trades match these filters.</p>
              : <TradesTable rows={data.rows} selectedIds={selectedIds} onToggleSelection={toggleSel} highlightedRowIdx={highlightedRowIdx} onHighlightRow={setHighlightedRowIdx} />
        }
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
pnpm typecheck
git add app/routes/\(app\)/trades src/components/trades/TradesFilterBar.tsx src/components/trades/TradesTable.tsx
git commit -m "feat(trades): list page with filter bar + dense table

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 15 — Trade list keyboard nav + bulk-tag dialog

**Files:**
- Modify: `app/routes/(app)/trades/index.tsx` (add keyboard handler)
- Create: `src/components/trades/BulkTagDialog.tsx`

- [ ] **Step 1: Keyboard handler**

Inside `TradesPage`, add:

```tsx
import { useEffect, useRef } from 'react'

// at top of component
const searchInputRef = useRef<HTMLInputElement>(null)

useEffect(() => {
  function onKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
    if (e.key === '/') {
      e.preventDefault()
      searchInputRef.current?.focus()
    } else if (e.key === 'j') {
      setHighlightedRowIdx(i => Math.min((data?.rows.length ?? 1) - 1, i + 1))
    } else if (e.key === 'k') {
      setHighlightedRowIdx(i => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      const row = data?.rows[highlightedRowIdx]
      if (row) nav({ to: '/trades/$positionId', params: { positionId: row.id } })
    } else if (e.key === 'x' || e.key === ' ') {
      const row = data?.rows[highlightedRowIdx]
      if (row) { e.preventDefault(); toggleSel(row.id) }
    }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [data, highlightedRowIdx, nav])
```

Pass `ref={searchInputRef}` through `TradesFilterBar`. To keep the filter bar API clean, add `inputRef?: React.Ref<HTMLInputElement>` prop and forward to the `<Input>`.

- [ ] **Step 2: `BulkTagDialog.tsx`**

```tsx
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '~/components/ui/dialog'
import { Button } from '~/components/ui/button'
import { applyPositionTag } from '~/server/journal'
import { toast } from 'sonner'

export function BulkTagDialog({
  open, onOpenChange, positionIds, availableTags,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  positionIds: string[]
  availableTags: { setup: { id: string; label: string }[]; mistake: { id: string; label: string }[] }
}) {
  const [kind, setKind] = useState<'setup' | 'mistake'>('setup')
  const [tagId, setTagId] = useState<string | null>(null)
  const qc = useQueryClient()

  const m = useMutation({
    mutationFn: async () => {
      if (!tagId) return
      return applyPositionTag({ data: { positionIds, kind, setupTagId: kind === 'setup' ? tagId : undefined, mistakeTagId: kind === 'mistake' ? tagId : undefined } })
    },
    onSuccess: (res) => {
      toast.success(`Tagged ${res?.applied ?? 0} trade${res?.applied === 1 ? '' : 's'}`)
      qc.invalidateQueries({ queryKey: ['tradeList'] })
      onOpenChange(false)
    },
    onError: (err) => toast.error(`Failed: ${String((err as Error).message)}`),
  })

  const options = kind === 'setup' ? availableTags.setup : availableTags.mistake

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tag {positionIds.length} trade{positionIds.length === 1 ? '' : 's'}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex gap-2 text-xs">
            <Button variant={kind === 'setup' ? 'default' : 'outline'} size="sm" onClick={() => { setKind('setup'); setTagId(null) }}>Setup</Button>
            <Button variant={kind === 'mistake' ? 'default' : 'outline'} size="sm" onClick={() => { setKind('mistake'); setTagId(null) }}>Mistake</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {options.length === 0 && <p className="text-xs text-neutral-500">No {kind} tags yet. Create one from a trade detail page first.</p>}
            {options.map(t => (
              <button
                key={t.id}
                onClick={() => setTagId(t.id)}
                className={`text-xs rounded-full px-2 py-1 border ${tagId === t.id ? 'border-brand bg-brand/10 text-brand' : 'border-neutral-800 text-neutral-300 hover:border-neutral-600'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!tagId || m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? 'Applying…' : 'Apply tag'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Wire the dialog**

The trade list doesn't have available tags in its current query. For v1, fetch a tiny `listTags` server fn OR inline a second query when the bulk-tag dialog opens. Simpler: defer tag creation to the trade detail page (Task 19) and use the existing tags via a new server fn `listTags`. Add to `src/server/journal.ts`:

```ts
export const listTags = createServerFn({ method: 'GET' })
  .handler(async () => {
    const session = await auth.api.getSession({ headers: getWebRequest().headers })
    if (!session?.user) throw new Error('Unauthorized')
    const userId = session.user.id
    const setup = await db.select().from(setupTag).where(and(eq(setupTag.userId, userId), eq(setupTag.isArchived, false)))
    const mistake = await db.select().from(mistakeTag).where(and(eq(mistakeTag.userId, userId), eq(mistakeTag.isArchived, false)))
    return {
      setup: setup.map(s => ({ id: s.id, label: s.label, color: s.color })),
      mistake: mistake.map(m => ({ id: m.id, label: m.label, color: m.color })),
    }
  })
```

Then in trades page, add:

```tsx
const [bulkOpen, setBulkOpen] = useState(false)
const { data: tags } = useQuery({ queryKey: ['tags'], queryFn: () => listTags(), staleTime: 5 * 60_000 })
```

Replace the disabled "Bulk tag…" button in the filter bar with one that opens the dialog when `selectedIds.size > 0`.

```tsx
<Button size="sm" variant="outline" disabled={selectedIds.size === 0} onClick={() => setBulkOpen(true)}>
  Bulk tag {selectedIds.size > 0 && `(${selectedIds.size})`}
</Button>

{tags && (
  <BulkTagDialog
    open={bulkOpen}
    onOpenChange={setBulkOpen}
    positionIds={[...selectedIds]}
    availableTags={tags}
  />
)}
```

- [ ] **Step 4: Commit**

```bash
pnpm typecheck
git add app/routes/\(app\)/trades/index.tsx src/components/trades/BulkTagDialog.tsx src/server/journal.ts
git commit -m "feat(trades): keyboard nav (j/k/enter/x/slash) + bulk-tag dialog

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 16 — Trade detail: header + fills timeline

**Files:**
- Create: `app/routes/(app)/trades/$positionId.tsx`
- Create: `src/components/trades/PositionHeader.tsx`
- Create: `src/components/trades/FillsTimeline.tsx`
- Create: `src/components/trades/MetricChipsRow.tsx`

- [ ] **Step 1: `PositionHeader.tsx`**

```tsx
import type { TradeDetailBundle } from '~/server/trades'
import { usd, duration } from '~/lib/formatters'
import { cn } from '~/lib/utils'

export function PositionHeader({ bundle }: { bundle: TradeDetailBundle }) {
  const p = bundle.position
  const holdSec = p.closedAt ? Math.round((p.closedAt.getTime() - p.openedAt.getTime()) / 1000) : null
  const pnlColor = p.realizedPnl > 0 ? 'text-pnl-win' : p.realizedPnl < 0 ? 'text-pnl-loss' : 'text-neutral-300'
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 pb-4 border-b border-neutral-800">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold">{p.symbol}</h1>
        <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px] font-mono text-neutral-400">{p.instrumentType.toUpperCase()}</span>
        <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-mono', p.side === 'long' ? 'bg-pnl-win/20 text-pnl-win' : 'bg-pnl-loss/20 text-pnl-loss')}>{p.side}</span>
        {p.wasLiquidated && <span className="rounded bg-pnl-loss/20 px-1.5 py-0.5 text-[11px] font-mono text-pnl-loss">LIQUIDATED</span>}
      </div>
      <div className={cn('text-2xl font-mono tabular-nums', pnlColor)}>
        {usd(p.realizedPnl, { signed: true })}
      </div>
      <div className="text-xs text-neutral-500 font-mono tabular-nums flex items-center gap-4">
        <span>Size {usd(p.notionalUsd, { short: true })}</span>
        <span>Held {duration(holdSec)}</span>
        <span>Opened {p.openedAt.toISOString().slice(0, 16).replace('T', ' ')}Z</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `FillsTimeline.tsx`**

```tsx
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
              formatter={(_v, _n, ctx) => {
                const p = ctx.payload as typeof data[number]
                return [`${p.role} · ${p.size} @ ${usd(p.price)}`, 'Fill']
              }}
              labelFormatter={(t) => new Date(Number(t)).toISOString().replace('T', ' ').slice(0, 19) + 'Z'}
            />
            <Scatter data={data} shape="circle">
              {data.map((d, i) => (
                <circle key={i} fill={ROLE_COLOR[d.role] ?? '#a3a3a3'} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-neutral-500 font-mono tabular-nums">
        {(['open','add','reduce','close'] as const).map(r => (
          <span key={r} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ROLE_COLOR[r] }} />
            {r}
          </span>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: `MetricChipsRow.tsx`**

```tsx
import type { TradeDetailBundle } from '~/server/trades'
import { usd } from '~/lib/formatters'

export function MetricChipsRow({ bundle }: { bundle: TradeDetailBundle }) {
  const p = bundle.position
  const chips: Array<[string, string]> = [
    ['Entry avg', usd(p.entryAvgPrice)],
    ['Exit avg',  p.exitAvgPrice == null ? '—' : usd(p.exitAvgPrice)],
    ['Size (USD)', usd(p.notionalUsd, { short: true })],
    ['Peak notional', usd(p.maxNotionalUsd, { short: true })],
    ['Fees', usd(p.totalFees)],
  ]
  if (p.instrumentType === 'perp') chips.push(['Funding', usd(p.fundingPnl, { signed: true })])

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map(([k, v]) => (
        <div key={k} className="rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-xs">
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">{k}</div>
          <div className="font-mono tabular-nums text-neutral-200">{v}</div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Trade detail route scaffold**

```tsx
// app/routes/(app)/trades/$positionId.tsx
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { getTradeDetail } from '~/server/trades'
import { PositionHeader } from '~/components/trades/PositionHeader'
import { FillsTimeline } from '~/components/trades/FillsTimeline'
import { MetricChipsRow } from '~/components/trades/MetricChipsRow'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '~/components/ui/tabs'
import { NotesTab } from '~/components/trades/NotesTab'
import { TagsTab } from '~/components/trades/TagsTab'
import { FindingsTab } from '~/components/trades/FindingsTab'
import { CoachTabStub } from '~/components/trades/CoachTabStub'

export const Route = createFileRoute('/(app)/trades/$positionId')({
  component: TradeDetailPage,
})

function TradeDetailPage() {
  const { positionId } = Route.useParams()
  const { data, isLoading, error } = useQuery({
    queryKey: ['tradeDetail', positionId],
    queryFn: () => getTradeDetail({ data: { positionId } }),
    staleTime: 5 * 60_000,
  })
  if (error) return <p className="text-sm text-pnl-loss">Failed to load trade: {(error as Error).message}</p>
  if (isLoading || !data) return <p className="text-sm text-neutral-500">Loading…</p>

  return (
    <div className="flex flex-col gap-6">
      <PositionHeader bundle={data} />
      <MetricChipsRow bundle={data} />
      <FillsTimeline bundle={data} />
      <Tabs defaultValue="notes">
        <TabsList>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
          <TabsTrigger value="findings">Findings {data.findings.length > 0 && `(${data.findings.length})`}</TabsTrigger>
          <TabsTrigger value="coach">Coach</TabsTrigger>
        </TabsList>
        <TabsContent value="notes"><NotesTab bundle={data} /></TabsContent>
        <TabsContent value="tags"><TagsTab bundle={data} /></TabsContent>
        <TabsContent value="findings"><FindingsTab bundle={data} /></TabsContent>
        <TabsContent value="coach"><CoachTabStub /></TabsContent>
      </Tabs>
    </div>
  )
}
```

Note: `NotesTab`, `TagsTab`, `FindingsTab`, `CoachTabStub` will be created in Tasks 17–20. Add temporary stubs now so this file typechecks. Example:

```tsx
// src/components/trades/CoachTabStub.tsx
export function CoachTabStub() {
  return (
    <div className="rounded-lg border border-dashed border-neutral-800 p-6 text-sm text-neutral-500">
      Coach analysis lands in Phase 4. The button will kick off a Claude post-mortem that cites the findings above.
    </div>
  )
}
```

For `NotesTab`, `TagsTab`, `FindingsTab`, create empty placeholder components that accept `{ bundle }` and render a `Coming in the next task…` div. Tasks 18–20 replace them.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck
git add app/routes/\(app\)/trades/\$positionId.tsx src/components/trades/PositionHeader.tsx src/components/trades/FillsTimeline.tsx src/components/trades/MetricChipsRow.tsx src/components/trades/CoachTabStub.tsx src/components/trades/NotesTab.tsx src/components/trades/TagsTab.tsx src/components/trades/FindingsTab.tsx
git commit -m "feat(trade-detail): header + metric chips + fills timeline + tab scaffolding

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 17 — Notes tab (markdown editor with autosave)

**Files:**
- Modify: `src/components/trades/NotesTab.tsx`
- Create: `src/hooks/useAutosave.ts`

- [ ] **Step 1: `useAutosave.ts`**

```ts
import { useEffect, useRef, useState } from 'react'

export function useAutosave<T>(value: T, save: (v: T) => Promise<void>, delayMs = 1200) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(value)
  latest.current = value

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        setStatus('saving')
        await save(latest.current)
        setStatus('saved')
      } catch { setStatus('error') }
    }, delayMs)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [value, delayMs, save])

  return status
}
```

- [ ] **Step 2: `NotesTab.tsx`**

```tsx
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import type { TradeDetailBundle } from '~/server/trades'
import { Textarea } from '~/components/ui/textarea'
import { Button } from '~/components/ui/button'
import { upsertTradeNote } from '~/server/journal'
import { useAutosave } from '~/hooks/useAutosave'
import { useQueryClient } from '@tanstack/react-query'

export function NotesTab({ bundle }: { bundle: TradeDetailBundle }) {
  const [body, setBody] = useState(bundle.note?.bodyMarkdown ?? '')
  const [previewing, setPreviewing] = useState(false)
  const qc = useQueryClient()
  const status = useAutosave(body, async (v) => {
    await upsertTradeNote({ data: { positionId: bundle.position.id, bodyMarkdown: v } })
    await qc.invalidateQueries({ queryKey: ['tradeDetail', bundle.position.id] })
  })

  return (
    <div className="flex flex-col gap-3 mt-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-neutral-500">
          {status === 'saving' && 'Saving…'}
          {status === 'saved' && 'Saved.'}
          {status === 'error' && <span className="text-pnl-loss">Save failed — changes are local.</span>}
        </div>
        <Button variant="outline" size="sm" onClick={() => setPreviewing(p => !p)}>
          {previewing ? 'Edit' : 'Preview'}
        </Button>
      </div>
      {previewing ? (
        <div className="prose prose-invert prose-sm max-w-none rounded-md border border-neutral-800 bg-neutral-900/40 p-4 min-h-40">
          <ReactMarkdown rehypePlugins={[rehypeSanitize]} remarkPlugins={[remarkGfm]}>
            {body || '*No notes yet.*'}
          </ReactMarkdown>
        </div>
      ) : (
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What was your thesis? What did you see?"
          className="min-h-40 font-mono text-sm"
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
pnpm typecheck
git add src/components/trades/NotesTab.tsx src/hooks/useAutosave.ts
git commit -m "feat(trade-detail): Notes tab with autosave + markdown preview

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 18 — Tags tab (setup + mistake pickers, confidence, emotional state)

**Files:**
- Modify: `src/components/trades/TagsTab.tsx`

- [ ] **Step 1: `TagsTab.tsx`**

```tsx
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TradeDetailBundle } from '~/server/trades'
import { applyPositionTag, removePositionTag, upsertReflection, createTag } from '~/server/journal'
import type { EmotionalState } from '~/domain/journal'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { toast } from 'sonner'

const EMOTIONS: Array<{ id: EmotionalState; label: string }> = [
  { id: 'calm', label: 'Calm' },
  { id: 'fomo', label: 'FOMO' },
  { id: 'revenge', label: 'Revenge' },
  { id: 'bored', label: 'Bored' },
  { id: 'anxious', label: 'Anxious' },
  { id: 'confident', label: 'Confident' },
]

export function TagsTab({ bundle }: { bundle: TradeDetailBundle }) {
  const pid = bundle.position.id
  const qc = useQueryClient()

  const [newTagLabel, setNewTagLabel] = useState('')
  const [newTagKind, setNewTagKind] = useState<'setup' | 'mistake'>('setup')

  const invalidate = () => qc.invalidateQueries({ queryKey: ['tradeDetail', pid] })

  const applySetup = useMutation({
    mutationFn: (tagId: string) =>
      applyPositionTag({ data: { positionIds: [pid], kind: 'setup', setupTagId: tagId } }),
    onSuccess: invalidate,
    onError: e => toast.error(String((e as Error).message)),
  })
  const applyMistake = useMutation({
    mutationFn: (tagId: string) =>
      applyPositionTag({ data: { positionIds: [pid], kind: 'mistake', mistakeTagId: tagId } }),
    onSuccess: invalidate,
    onError: e => toast.error(String((e as Error).message)),
  })
  const removeSetup = useMutation({
    mutationFn: (tagId: string) =>
      removePositionTag({ data: { positionId: pid, kind: 'setup', setupTagId: tagId } }),
    onSuccess: invalidate,
  })
  const removeMistake = useMutation({
    mutationFn: (tagId: string) =>
      removePositionTag({ data: { positionId: pid, kind: 'mistake', mistakeTagId: tagId } }),
    onSuccess: invalidate,
  })
  const createNew = useMutation({
    mutationFn: () => createTag({ data: { kind: newTagKind, label: newTagLabel } }),
    onSuccess: () => { setNewTagLabel(''); qc.invalidateQueries({ queryKey: ['tradeDetail', pid] }); qc.invalidateQueries({ queryKey: ['tags'] }) },
  })

  const appliedSetup = new Set(bundle.tags.setupTagIds)
  const appliedMistake = new Set(bundle.tags.mistakeTagIds)

  const [confidence, setConfidence] = useState<number | null>(bundle.reflection?.confidence ?? null)
  const [emotion, setEmotion]       = useState<EmotionalState | null>(bundle.reflection?.emotionalState as EmotionalState ?? null)

  const saveReflection = useMutation({
    mutationFn: () => upsertReflection({ data: { positionId: pid, confidence, emotionalState: emotion, reflectionMarkdown: bundle.reflection?.reflectionMarkdown ?? null } }),
    onSuccess: () => { toast.success('Reflection saved'); invalidate() },
    onError: e => toast.error(String((e as Error).message)),
  })

  return (
    <div className="flex flex-col gap-6 mt-2">
      {/* Setup tags */}
      <section>
        <h4 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Setup</h4>
        <div className="flex flex-wrap gap-2">
          {bundle.availableTags.setup.map(t => {
            const active = appliedSetup.has(t.id)
            return (
              <button
                key={t.id}
                onClick={() => active ? removeSetup.mutate(t.id) : applySetup.mutate(t.id)}
                className={`text-xs rounded-full px-3 py-1 border ${active ? 'border-brand bg-brand/10 text-brand' : 'border-neutral-800 text-neutral-400 hover:text-neutral-200'}`}
              >
                {t.label}
              </button>
            )
          })}
          {bundle.availableTags.setup.length === 0 && (
            <p className="text-xs text-neutral-500">No setup tags yet. Add one below.</p>
          )}
        </div>
      </section>

      {/* Mistake tags */}
      <section>
        <h4 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Mistakes</h4>
        <div className="flex flex-wrap gap-2">
          {bundle.availableTags.mistake.map(t => {
            const active = appliedMistake.has(t.id)
            return (
              <button
                key={t.id}
                onClick={() => active ? removeMistake.mutate(t.id) : applyMistake.mutate(t.id)}
                className={`text-xs rounded-full px-3 py-1 border ${active ? 'border-pnl-loss bg-pnl-loss/10 text-pnl-loss' : 'border-neutral-800 text-neutral-400 hover:text-neutral-200'}`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </section>

      {/* Create tag */}
      <section className="flex items-center gap-2">
        <select
          value={newTagKind}
          onChange={(e) => setNewTagKind(e.target.value as 'setup' | 'mistake')}
          className="bg-neutral-900 border border-neutral-800 rounded-md text-xs px-2 py-1.5"
        >
          <option value="setup">Setup</option>
          <option value="mistake">Mistake</option>
        </select>
        <Input
          value={newTagLabel}
          onChange={(e) => setNewTagLabel(e.target.value)}
          placeholder="New tag label"
          className="h-8 text-xs w-48"
        />
        <Button size="sm" disabled={!newTagLabel.trim() || createNew.isPending} onClick={() => createNew.mutate()}>
          {createNew.isPending ? 'Adding…' : 'Add tag'}
        </Button>
      </section>

      {/* Confidence + emotion */}
      <section className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500 uppercase tracking-wide">Confidence</span>
          {[1,2,3,4,5].map(v => (
            <button
              key={v}
              onClick={() => setConfidence(confidence === v ? null : v)}
              className={`h-7 w-7 rounded-full border text-xs font-mono tabular-nums ${confidence === v ? 'border-brand text-brand bg-brand/10' : 'border-neutral-800 text-neutral-400'}`}
              aria-label={`Confidence ${v}`}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500 uppercase tracking-wide">Emotion</span>
          <Select value={emotion ?? undefined} onValueChange={(v) => setEmotion(v as EmotionalState)}>
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {EMOTIONS.map(e => <SelectItem key={e.id} value={e.id}>{e.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={() => saveReflection.mutate()} disabled={saveReflection.isPending}>
          {saveReflection.isPending ? 'Saving…' : 'Save'}
        </Button>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
pnpm typecheck
git add src/components/trades/TagsTab.tsx
git commit -m "feat(trade-detail): Tags tab — setup/mistake pickers, confidence, emotion

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 19 — Findings tab + Coach stub refinement

**Files:**
- Modify: `src/components/trades/FindingsTab.tsx`

- [ ] **Step 1: `FindingsTab.tsx`**

```tsx
import type { TradeDetailBundle } from '~/server/trades'
import { Badge } from '~/components/ui/badge'

const DETECTOR_LABELS: Record<string, string> = {
  revenge_trading: 'Revenge trading',
  oversized_positions: 'Oversized positions',
  loss_of_discipline_windows: 'Discipline windows',
  position_sizing_instability: 'Sizing instability',
  cut_winners_ride_losers: 'Cut winners, ride losers',
  overtrading_after_losses: 'Overtrading after losses',
  fee_drag: 'Fee drag',
  scaling_into_losers: 'Scaling into losers',
  short_hold_scalping: 'Short-hold scalping',
  symbol_underperformance: 'Symbol underperformance',
  leverage_creep: 'Leverage creep',
}

export function FindingsTab({ bundle }: { bundle: TradeDetailBundle }) {
  if (bundle.findings.length === 0) {
    return <p className="mt-4 text-sm text-neutral-500">No findings reference this trade.</p>
  }
  return (
    <div className="mt-2 flex flex-col gap-3">
      {bundle.findings.map(f => (
        <article key={f.id} className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{DETECTOR_LABELS[f.detectorId] ?? f.detectorId}</span>
              <Badge variant="outline" className="text-[10px]">{f.severity}</Badge>
            </div>
          </div>
          <h4 className="text-sm text-neutral-200 mb-1">{f.title}</h4>
          <p className="text-sm text-neutral-400 whitespace-pre-wrap">{f.bodyMarkdown}</p>
        </article>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
pnpm typecheck
git add src/components/trades/FindingsTab.tsx
git commit -m "feat(trade-detail): Findings tab showing detector hits for this trade

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 20 — Empty / loading / error states polish + accessibility pass

**Why:** Spec §9.10 calls for skeleton shimmers, illustrated empty states with CTAs, and contextual errors. We've put skeletons in the dashboard; the trades list and detail still show bare text. Tighten and audit.

**Files:**
- Modify: `app/routes/(app)/trades/index.tsx`
- Modify: `app/routes/(app)/trades/$positionId.tsx`
- Create: `src/components/EmptyState.tsx`
- Create: `src/components/LoadingSkeleton.tsx`

- [ ] **Step 1: `EmptyState.tsx`**

```tsx
import { Link } from '@tanstack/react-router'
import { Button } from '~/components/ui/button'

export function EmptyState({
  title, body, action,
}: { title: string; body: string; action?: { label: string; to: string } }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 py-12 px-6">
      <p className="text-base font-medium text-neutral-200">{title}</p>
      <p className="text-sm text-neutral-500 max-w-md">{body}</p>
      {action && (
        <Link to={action.to}>
          <Button variant="outline" size="sm" className="mt-3">{action.label}</Button>
        </Link>
      )}
    </div>
  )
}
```

- [ ] **Step 2: `LoadingSkeleton.tsx`**

```tsx
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 p-6">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-6 rounded bg-neutral-900/60 animate-pulse" style={{ width: `${70 + (i % 3) * 10}%` }} />
      ))}
    </div>
  )
}

export function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-10 w-64 rounded bg-neutral-900/60 animate-pulse" />
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-14 w-28 rounded bg-neutral-900/60 animate-pulse" />
        ))}
      </div>
      <div className="h-56 rounded bg-neutral-900/60 animate-pulse" />
    </div>
  )
}
```

- [ ] **Step 3: Replace bare text in trade list**

In `app/routes/(app)/trades/index.tsx`, swap:

```tsx
: isLoading || !data
  ? <TableSkeleton />
  : data.rows.length === 0
    ? <EmptyState title="No trades match these filters." body="Try broadening the range or clearing filters." action={{ label: 'Import data', to: '/import' }} />
    : <TradesTable ... />
```

- [ ] **Step 4: Replace bare text in trade detail**

In `app/routes/(app)/trades/$positionId.tsx`, swap the `Loading…` for `<DetailSkeleton />`.

- [ ] **Step 5: Accessibility smoke check**

Run `pnpm dev` and with your keyboard only:
- Tab through the top nav — focus rings visible on all links
- On the trades list, press `/` to focus search, `j`/`k` to move, `Enter` to open detail, `x` to toggle selection
- In the trade detail Notes tab, Tab into the textarea, type, confirm status chip updates

If focus rings are invisible on dark mode, add to `src/styles/globals.css`:

```css
:focus-visible {
  outline: 2px solid #ea580c;
  outline-offset: 2px;
}
```

- [ ] **Step 6: Commit**

```bash
pnpm typecheck
git add src/components/EmptyState.tsx src/components/LoadingSkeleton.tsx app/routes/\(app\)/trades src/styles/globals.css
git commit -m "feat(ui): loading skeletons + empty states + focus-visible ring

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-review checklist (run before closing Phase 3)

- [ ] `pnpm typecheck` clean
- [ ] `pnpm vitest run` — no new failures beyond the pre-existing Phase-0 smoke tests and the DB-required integration test
- [ ] Dev server boots (`pnpm dev`), login works, dashboard renders data for a user who has imported CSVs and run `pnpm rederive --user=<id>` (or had `ingestion/complete` fire)
- [ ] URL filters round-trip: change range/instrument, refresh, state persists
- [ ] Bulk-tag dialog applies to multiple selected trades
- [ ] Notes tab autosaves and markdown preview renders (sanitized, no raw HTML)
- [ ] Trade detail Findings tab shows any finding that references this position
- [ ] `/api/inngest` endpoint still returns 200 (nothing in Phase 3 should have broken Phase 1/2 wiring)
- [ ] No secrets leaked into the client bundle (check Network tab — `document.documentElement` should have no server env)

## Deferred to Phase 6 or follow-up

- Day-of-week axis on the heatmap (requires a new `dayOfWeekMetric` derived table)
- Symbol + setup-tag filters wired into the dashboard's KPI/equity/heatmap queries (today only `timeRange` filters the daily slice; others are UI-only)
- Export button on controls row
- Rich-text / markdown editor with toolbar on Notes tab (plain textarea for now)
- Filter bar: date range picker, setup-tag chips, size-percentile slider
- E2E tests via Playwright (out of scope)
- Visual regression screenshots (Phase 6)

## Wiki update (post-implementation)

Append a Phase 3 entry to `docs/wiki/phases.md` covering: shipped surfaces, notable decisions (e.g. symbol filter deferred, heatmap is hour-only), how the autosave / optimistic update pattern is structured, and the follow-up items above.
