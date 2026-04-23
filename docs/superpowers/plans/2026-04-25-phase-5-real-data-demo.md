# Phase 5 — Real-Data Wiring + Demo Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task.

**Goal:** Swap the design-mock data in Dashboard / Trades / Trade Detail for the real server functions already shipped in Phase 3, add graceful empty states for new users, and light up the "Try demo" button with a read-only seeded demo account.

**Architecture:**
- All server fns already exist (`getDashboardBundle`, `getTradeList`, `getTradeDetail`, `upsertTradeNote`, `applyPositionTag`, `removePositionTag`, `listTags`, `createTag`) — the work is **field-mapping** between server responses and the design's view models, plus handling empty / loading / error states at every consumer.
- Demo mode = a single seeded user (`user.isDemo = true`, already in the Better Auth schema) with pre-loaded fixture fills. Visitors clicking "Try demo" on the landing sign in as that user via a dedicated `/api/auth/demo` handler that bypasses Google OAuth. All write operations (import, tags, notes, rule adoption) are gated behind a `!user.isDemo` check server-side.
- Empty states reuse the `<EmptyState />` primitive already in `src/components/tj/primitives.tsx`.

**Tech Stack:** Existing — no new deps.

---

## Task 1 — Dashboard → real `DashboardBundle`

**Files:**
- Modify: `src/components/dashboard/EquityCurve.tsx`
- Modify: `src/components/dashboard/AssetBreakdown.tsx`
- Modify: `src/components/dashboard/FindingsSidebar.tsx`
- Modify: `src/components/dashboard/Heatmap.tsx`
- Modify: `app/routes/(app)/_layout/dashboard.tsx`
- Keep: `src/components/dashboard/mockData.ts` (still used by landing preview only)

**Contract changes:**
- `EquityCurve` accepts `points: Array<{ date: string; cumulativePnl: number }>` prop (from `DashboardBundle.equityCurve`). When array is empty, render a 220px empty slab with "No trades yet" centered text.
- `AssetBreakdown` accepts `rows: Array<{ symbol: string; instrumentType: 'spot'|'perp'; realizedPnl: number; tradeCount: number }>` (map from `DashboardBundle.assetBreakdown` which uses `AssetMetricValue` → no `instrumentType` field; default to `'perp'` for v1 since the `asset_metric` table doesn't split, or read from the first position for that symbol — pick the simpler path: default `'perp'`).
- `FindingsSidebar` accepts `findings: Array<{ id: string; level: 'red'|'amber'|'neutral'; title: string; evidence: string; detectorId: DetectorId }>`. Map `DashboardBundle.topFindings` → severity: `critical → red`, `warning → amber`, `info → neutral`. `title` = detector-id friendly name (use the same `DETECTOR_LABELS` map that lived in the old FindingsSidebar; restore it here). `evidence` = `f.bodyMarkdown.slice(0, 140)` one-liner preview. Still shows adopt-rule flow on top finding.
- `Heatmap` accepts `cells: Array<{ hourOfDayUtc: number; dayOfWeekUtc: number; expectancy: number; tradeCount: number }>`. Right now the design mock has a full 7×24 grid; real `DashboardBundle.heatmap` is hour-only (`hourOfDayUtc` + no `dayOfWeekUtc`). **Compromise:** keep the design's 7×24 visual but if `dayOfWeekUtc` is missing/undefined on cells, fill all 7 days with the same hour value. This is a UI concession; fixing at the source is deferred.

**Route:** `dashboard.tsx` now calls `useQuery({ queryFn: () => getDashboardBundle({ data: serializeFilters(filters) }) })` and passes slices to each sub-component. Loading → skeleton row. Error → error card.

**Empty-state:** if `bundle.meta.totalFillCount === 0`, skip the KPI row + equity + bars + heatmap entirely and show a single `<EmptyState title="Import your first trades" cta={<LinkToImport />} />`. Controls row stays visible.

**Steps:**
- [ ] Update each dashboard sub-component to accept the new props. Preserve the design's layout 1:1 — only the data source changes.
- [ ] Update `dashboard.tsx` to wire the query + pass the slices.
- [ ] Delete the mock imports from these four component files (mockData.ts stays for the landing preview).
- [ ] Typecheck + run.

## Task 2 — Trades list → real `getTradeList`

**Files:**
- Modify: `app/routes/(app)/_layout/trades/index.tsx`
- Delete: `src/components/trades/mockTrades.ts` (no longer needed — the landing doesn't use it)

**Contract:**
- `getTradeList({ data })` returns `{ rows: TradeListRow[]; total: number }` — match exact shape in `src/server/trades.ts`.
- Replace the `mockTrades` filtering with `useQuery({ queryKey: ['tradeList', filters], queryFn: () => getTradeList({ data: filters }) })`.
- Map `TradeListRow` → the design's `TradeRow` interface inline. If fields don't line up perfectly (e.g., the server's `pnlPct` might be named differently), compute at the consumer.
- Keyboard nav (`j`/`k`/`Enter`/`x`/`Space`/`/`) was present in the old trades page pre-Phase-3.5; **not restoring** in this task — defer to Phase 6. The plain click-through stays.
- Bulk select / bulk tag: keep the selection state, wire "Tag" button to call `applyPositionTag` for each selected id with the chosen tag. Minimum: click "Tag" → opens a small dialog listing existing mistake tags from `listTags()` → user picks → bulk-apply → toast success. Keep scope small.
- Empty state: if `data.total === 0` on **unfiltered** query, show "Import your first trades". If `total > 0` but filter result is empty, show "No trades match these filters" with "Clear all" CTA.

**Steps:**
- [ ] Rewrite page to use `useQuery` + map rows.
- [ ] Implement minimal bulk-tag dialog inline (don't create a separate file — keep it in this route).
- [ ] Delete `mockTrades.ts`.

## Task 3 — Trade detail → real `getTradeDetail` + journal writes

**Files:**
- Modify: `app/routes/(app)/_layout/trades/$positionId.tsx`

**Contract:**
- `getTradeDetail({ data: { positionId } })` returns `TradeDetailBundle` — shape in `src/server/trades.ts`. Includes `position`, `fills`, `findings`, `note`, `positionTags`, `reflection`.
- Replace the hardcoded BTCUSDT position header / fills / metric chips / candle chart with real data.
- **CandleChart:** real fills don't come with 1-min OHLC candles (we never pulled that data). v1: render only the fills as dots on a time axis, no candles behind them. Replace `generateCandles()` with a simple timeline `svg` that shows fill dots + vertical entry/exit guide lines, plus a line from first to last fill at average price. Label: "Fills timeline — price axis only; candles when we add market-data feeds."
- **Notes tab:** replace the hardcoded `useState(text)` with real autosave via `upsertTradeNote({ data: { positionId, bodyMarkdown } })`. Restore the `useAutosave` hook pattern from Phase 3 (or inline a simple debounce with `useRef` to avoid timer reset on re-render — the old `src/hooks/useAutosave.ts` may still exist; check).
- **Tags tab:** query `listTags()` once. Setup/mistake tags split by `kind`. Click tag → `applyPositionTag({ positionId, tagId })` with optimistic UI; click × → `removePositionTag({ positionId, tagId })`. "Add setup tag" input → `createTag({ kind: 'setup', label })` + auto-apply.
- **Findings tab:** list `bundle.findings` — each finding card shows `severity`, `title` (from `DETECTOR_LABELS`), `bodyMarkdown`, and `referencedPositionIds` rendered as `<Link>` anchors.
- **Coach tab:** already wired in Phase 4 Task 8; no change.
- **Metric chips:** map from `TradeDetailBundle.position` — R multiple leave as `—` (schema doesn't have R), duration from `openedAt/closedAt`, max drawdown from `position.maxNotionalUsd` differential (approximate — again, real data isn't ready).

**Steps:**
- [ ] Rewrite the route to call `getTradeDetail` + thread data into the existing tab components (Notes/Tags/Findings).
- [ ] Simplify CandleChart to fills-only timeline.
- [ ] Wire autosave + tag mutations with `useMutation` + invalidation.
- [ ] Keep Coach tab untouched.

## Task 4 — Empty-state polish everywhere

**Files:**
- Modify: `app/routes/(app)/_layout/dashboard.tsx` (done in Task 1)
- Modify: `app/routes/(app)/_layout/trades/index.tsx` (done in Task 2)
- Modify: `app/routes/(app)/_layout/import.tsx` (confirm empty history shows its copy — already done earlier, re-verify)
- Modify: `app/routes/(app)/_layout/digest/index.tsx` (digest preview fails gracefully if no trades — already has `<PreviewError />`; add a richer message for the "no data" case)

**Steps:**
- [ ] Walk the app logged-in as a fresh user (no imports): every page shows a useful empty state with a link to `/import`.
- [ ] No exceptions thrown. No "Could not generate a digest" panic card when the reason is just "no trades yet" — differentiate.

## Task 5 — Demo mode infra

**Files:**
- Modify: `src/db/schema/auth.ts` — check `isDemo` field already exists on the `user` table (it does, added in Phase 3.5). No schema change.
- Create: `src/server/demoSeed.ts` — seeds the demo user row + a fixture set of fills + runs derivation
- Create: `scripts/seedDemo.ts` — CLI entry point (mirrors `scripts/rederive.ts`)
- Modify: `package.json` — add script `"seed:demo": "..."`
- Modify: `src/auth/server.ts` — if not already, ensure `user.additionalFields.isDemo` is readable on sessions
- Create: `app/routes/api/demo.tsx` — API route: on POST, create a short-lived session for the demo user by calling Better Auth's internal session creation (inspect `better-auth` docs for the canonical path). Simpler alternative: mint a session cookie directly via `auth.api.createSession({ userId: DEMO_USER_ID })` if that API exists, else fall back to email-link sign-in flow.

**Demo seed content:**
- Single demo user: `email = 'demo@tradejournal.local'`, `isDemo = true`, `timezone = 'UTC'`
- ~40 fixture fills across 10 positions, mixed spot/perp, mixed wins/losses, 2 positions with FOMO tags, 1 with revenge, clear pattern that the detectors pick up
- Pre-seeded mistake tags (already auto-seeded by the Better Auth hook)
- Run the derivation pipeline once against the seeded fills

**Steps:**
- [ ] Write `demoSeed.ts` with an idempotent upsert (drop-and-recreate demo user + fills on every run).
- [ ] Write the CLI entry that calls `seedDemoUser(db)` — document as `pnpm seed:demo`.
- [ ] Wire `app/routes/api/demo.tsx` to stand up a demo session.
- [ ] Test locally: fresh incognito tab → click "Try demo" → land on demo's dashboard with real data.

## Task 6 — Read-only guard on writes (demo-mode enforcement)

**Files:**
- Modify: `src/server/import.ts`, `src/server/journal.ts`, `src/server/rules.ts`, `src/server/coach.ts`
- Modify: Wherever a server fn performs a mutation

**Pattern:** add a tiny helper `assertNotDemo(user)` that throws `403 demo_mode_readonly` when `user.isDemo === true`. Apply at the top of every mutation fn. Query fns stay open.

**Steps:**
- [ ] Create `src/auth/assertNotDemo.ts` with the helper.
- [ ] Import and call it in every `.handler` that writes.
- [ ] UI: when `session.user.isDemo`, show a banner at the top of the app "You're in demo mode — writes are disabled." Add a small hook `useIsDemo()` reading from session.

## Task 7 — Landing "Try demo" button

**Files:**
- Modify: `app/routes/(public)/index.tsx`

**Steps:**
- [ ] Change the disabled "Try demo" button → call a new `startDemoSession()` client fn that posts to `/api/demo` then navigates to `/dashboard`.
- [ ] Remove the "PHASE 5" badge.
- [ ] Keep the primary "Sign in with Google" button unchanged.

## Task 8 — Wiki close-out + badge flips

**Files:**
- Modify: `docs/wiki/phases.md`
- Modify: `app/routes/(public)/index.tsx` — flip "PHASE 5" badge on detector placeholder cards if any; flip "PHASE 4" hints where the feature is live

**Steps:**
- [ ] Add the Phase 5 "Shipped" section to the wiki: scope, commits, decisions, gotchas, deferred items.
- [ ] Target test count: 110+ passing.

---

## Scope not in Phase 5

- Rich Notes editor / toolbar — still plain textarea
- Bybit / OKX ingestion
- Custom user-defined detectors
- Export buttons on dashboard
- Email unsubscribe + preferences UI
- Real market-data candles in the fills timeline
- Day-of-week axis on heatmap (needs new `dayOfWeekMetric` derived table)
- E2E tests (Playwright)
