# Phase 6 — Polish + Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task.

**Goal:** Clear the biggest deferred items from Phases 2–5 — filters that actually filter, a real 7×24 heatmap, keyboard nav, exports, a richer Notes editor, R-multiple + max-drawdown, typed Links everywhere, landing nav wired up, per-user timezone, and a clean test run. Ship these as bite-sized tasks.

**Architecture:**
- No new runtime deps outside TipTap/marked for the Notes editor (TBD — may stay plain with a small toolbar); everything else reuses existing patterns.
- `dayOfWeekMetric` becomes the 7th derived table; migrations auto-generated; runner wired in.
- Filters move from UI-only state → first-class query params on `getDashboardBundle`; aggregation happens server-side against per-period rollups we already compute, with a symbol/instrument predicate appended.
- Per-user timezone is stored on `user.timezone` (new column); auto-captured via `Intl.DateTimeFormat().resolvedOptions().timeZone` on first client hit after sign-in.

**Tech Stack:** Existing. Optional new dep in Task 6 — evaluate in that task.

---

## Task 1 — Test hygiene

**Files:**
- Delete: `tests/unit/components/KpiTile.test.tsx` (references a deleted component from pre-Phase-3.5)
- Modify: `tests/smoke/phase-0.test.ts` (still fails against empty-env `.env.local` — relax or gate)
- Modify: `src/lib/env.ts` if needed

**Steps:**
- [ ] Delete `KpiTile.test.tsx`. Confirm nothing else imports the referenced symbols.
- [ ] Phase-0 smoke test: either
  - (a) Gate it behind `process.env.CI === 'true'` so local dev without real OAuth doesn't fail, or
  - (b) Mock `env.ts` in the test's setup.
  Pick (a) — simpler.
- [ ] `pnpm vitest run` should report **0 failing** files after this task.
- [ ] `pnpm typecheck` clean.

## Task 2 — Dashboard filters actually filter

**Files:**
- Modify: `src/server/dashboard.ts`
- Modify: `src/domain/dashboard.ts` if filter shape changes
- Modify: `src/components/dashboard/*` consumers to forward the filters (they already do)
- Test: `tests/unit/server/dashboard-filters.test.ts`

**Contract:**
- `getDashboardBundle({ data: filters })` currently applies `timeRange` but ignores `symbols[]`, `instrument`, and `setupTagIds[]`. Extend the query:
  - `symbols`: filter `position` rows by `inArray(position.symbol, symbols)` before computing the bundle's `kpis`, `equityCurve`, `heatmap`, `assetBreakdown`.
  - `instrument`: `eq(position.instrumentType, instrument)` when `!= 'all'`.
  - `setupTagIds`: join via `position_tag` on `(positionId, kind='setup', setupTagId IN (...))` and restrict positions to those matching.
- KPI / summary computations should run on the **filtered position set**, not the full week. Keep the rollup-read shortcut ONLY when no filters are active; otherwise recompute from positions on the fly. Plan for `O(filtered positions)` cost — fine for beta.

**Steps:**
- [ ] Add a private helper `filteredPositions(db, userId, filters)` that returns the exact position rows in scope.
- [ ] Route every downstream aggregation through that helper. `equityCurve` recomputes from `dailyMetric`-like derived numbers restricted to these positions' closed dates; or compute on-the-fly from `realizedPnl` per closed day.
- [ ] Unit test: seed 3 symbols (BTCUSDT, ETHUSDT, SOLUSDT), request `{ symbols: ['BTCUSDT'] }` → assert only BTC positions contribute; request `{ instrument: 'spot' }` → assert only spot; request both → assert intersection.
- [ ] `pnpm vitest run tests/unit/server/dashboard-filters.test.ts` passes.

## Task 3 — Day-of-week heatmap

**Files:**
- Modify: `src/db/schema/derivation.ts` — add `dayOfWeekMetric` table
- Modify: `src/derivation/metrics/*` — add day-of-week aggregator
- Modify: `src/derivation/runner.ts` — persist the new metric
- Modify: `src/derivation/version.ts` — bump `DERIVATION_VERSION` to 2
- Modify: `src/server/dashboard.ts` — include a `heatmapDow: Array<{ dayOfWeekUtc, hourOfDayUtc, tradeCount, expectancy }>` or just make `heatmap` 7×24
- Modify: `src/components/dashboard/Heatmap.tsx` — consume real per-day data (already handles `dayOfWeekUtc ?? 0` fallback)
- Generate: new drizzle migration

**Contract:**
- `dayOfWeekMetric` table: `userId`, `dayOfWeekUtc` (0–6), `hourOfDayUtc` (0–23), `tradeCount`, `realizedPnl`, `winRate`, `expectancy`, `derivationVersion`. Unique `(userId, dayOfWeekUtc, hourOfDayUtc, derivationVersion)`.
- Aggregator: mirror `sessionMetric` but partition by day-of-week too.
- Runner persists it alongside other metrics.
- Bump `DERIVATION_VERSION` to `2` to force re-derive; document in the wiki that users should run `pnpm rederive` once after deploy.
- Dashboard bundle replaces `heatmap` with the 7×24 version.

**Steps:**
- [ ] Schema + migration.
- [ ] Aggregator + runner wiring.
- [ ] Bump version constant.
- [ ] Server fn + UI.
- [ ] Run `pnpm rederive --user=<your-user>` locally to verify.
- [ ] Unit test the aggregator with seeded positions.

## Task 4 — Keyboard nav on trades list

**Files:**
- Modify: `app/routes/(app)/_layout/trades/index.tsx`

**Bindings:**
- `/` → focus the symbol search input
- `j` → move highlight down one row
- `k` → move highlight up one row
- `Enter` → open highlighted row (navigate to detail)
- `x` or `Space` → toggle selection of highlighted row
- `Esc` → clear selection + blur search

**Implementation:**
- `useState<number>(0)` for `highlightedRowIdx`.
- `useEffect` attaches a global `keydown` listener that ignores events when the target is an `<input>` or `<textarea>` (so typing in search doesn't hijack `j/k`).
- Highlighted row gets a subtle border-left (`box-shadow: inset 2px 0 0 var(--accent)`).
- Reset `highlightedRowIdx` to `0` when filters change (result set shifts).

**Steps:**
- [ ] Add `useRef` on the search input for the `/` binding.
- [ ] Wire the key handler.
- [ ] Visual highlight on the active row.

## Task 5 — R-multiple + max-drawdown on trade detail

**Files:**
- Modify: `src/server/trades.ts` — extend `TradeDetailBundle.position` with `rMultiple: number | null` and `maxDrawdownPct: number | null`
- Modify: `src/derivation/merge.ts` or a new `src/derivation/metrics/position-metrics.ts` — compute these per position
- Modify: `src/db/schema/derivation.ts` — add `rMultiple` (numeric) and `maxDrawdownPct` (numeric) columns to the `position` table; generate migration; bump `DERIVATION_VERSION` if not already bumped in Task 3 (coordinate with Task 3 so we do one bump, not two)
- Modify: `app/routes/(app)/_layout/trades/$positionId.tsx` — show real values in `MetricChipsRow` (currently `'—'`)

**Computation:**
- **R-multiple** = realizedPnl / planned risk. We don't have "planned risk" yet (no stop-loss field). For v1 define R as `realizedPnl / (initial notional × 0.01)` (i.e. treating a 1% move as 1R). Explicit approximation — document in the metric chip hint as `"1R = 1% of entry notional"`. Nullable when `entryAvgPrice` is 0.
- **maxDrawdownPct** = max unrealized loss percentage observed during the position, computed from the fills' min price vs entry. For a long: `(min(fill.price below entry) - entry) / entry`. For a short: `(entry - max(fill.price above entry)) / entry`. Nullable when no opposing-price fills exist.

**Steps:**
- [ ] Add the two columns.
- [ ] Compute in the merger (where the weighted-entry logic lives).
- [ ] Bump DERIVATION_VERSION (or roll it into Task 3's bump).
- [ ] Surface in the bundle.
- [ ] Replace the `—` in the chip row.

## Task 6 — Notes editor with markdown toolbar

**Files:**
- Modify: `app/routes/(app)/_layout/trades/$positionId.tsx` — NotesTab

**Options:**
- **Plain textarea + toolbar** (recommended — no new dep): toolbar buttons (`B`, `I`, `H1`, `H2`, `List`, `Code`) manipulate the textarea selection via `document.execCommand` fallback OR direct `textarea.selectionStart` / `setRangeText`. Reuses existing markdown preview.
- **TipTap** (adds ~100 KB gzipped): full WYSIWYG. Overkill for markdown.

Pick plain textarea + toolbar.

**UI:**
- 8 toolbar buttons above the textarea in a thin `.tj-card` header strip: `B`, `I`, `H1`, `H2`, `• List`, `1. List`, `<>` (code), `—` (hr). Each calls a small helper that wraps/prefixes the current selection.
- Keyboard shortcuts: `Cmd+B`, `Cmd+I`, `Cmd+K` (link — prompt user for URL).
- Preview below the textarea is already rendered via `react-markdown` (Phase 5 Task 3). Keep.

**Steps:**
- [ ] Extract `wrapSelection(textarea, before, after)` helper.
- [ ] Render toolbar above textarea.
- [ ] Wire keyboard shortcuts.

## Task 7 — Export CSV buttons

**Files:**
- Create: `src/lib/csv.ts` — tiny `toCsv(rows, columns)` utility
- Modify: `app/routes/(app)/_layout/dashboard.tsx` — "Export" button in controls row
- Modify: `app/routes/(app)/_layout/trades/index.tsx` — "Export CSV" button (already present as a stub)
- Modify: `app/routes/(app)/_layout/trades/$positionId.tsx` — "Export JSON" button in position header

**Exports:**
- **Dashboard:** summary row + per-asset breakdown, plus filter snapshot at top.
- **Trades:** every visible row (respects current filters).
- **Trade detail:** full `TradeDetailBundle` as JSON (pretty-printed).

**All exports are client-side** — fetch the existing server fn output, serialize, trigger download via `Blob` + `<a download>`. No new server fn needed.

**Steps:**
- [ ] `toCsv` helper + a `downloadFile(name, blob)` helper.
- [ ] Wire each button.

## Task 8 — Typed `<Link>` everywhere

**Files:** sweep across
- `src/components/dashboard/*` — any bare `<a href="/trades/...">` → `<Link to="/trades/$positionId" params={{ positionId }}>`
- `src/components/trades/CoachNarrative.tsx` — `referencedPositionIds` links
- `app/routes/(public)/index.tsx` — internal landing anchors
- Anywhere else `grep -rn 'href="/' src app` shows

**Steps:**
- [ ] grep for bare anchor tags pointing to internal routes; replace with `<Link>` from `@tanstack/react-router`.
- [ ] Exception: the landing page's marketing section anchors (`#pricing`, `#faq`) can stay as `<a href="#anchor">` — those are intra-page jumps, not route nav.

## Task 9 — Landing polish

**Files:**
- Modify: `app/routes/(public)/index.tsx` — nav items (Product / Detectors / Pricing / Changelog) become anchor-scrolls to `#product`, `#detectors`, `#pricing`, `#changelog`
- Modify: `app/routes/(public)/index.tsx` — "View sample digest" button links to `/digest` (via `<Link to="/digest">`; if user not authed, `_layout` redirects to `/login` — fine)
- Create: `app/routes/(public)/changelog.tsx` — a simple page reading `docs/wiki/phases.md` (server-render it as markdown via `react-markdown`). Alternative: hand-maintained copy. Pick the hand-maintained route for now — simpler + looks more polished.

**Steps:**
- [ ] Add `id="product"`, `id="detectors"`, `id="pricing"`, `id="faq"` to the corresponding `<section>` elements.
- [ ] Wire the nav `<a>` tags to those anchors.
- [ ] Create `/changelog` with a hand-curated Markdown-to-JSX page covering phases 0 through 5 as a timeline.

## Task 10 — Per-user timezone

**Files:**
- Modify: `src/db/schema/auth.ts` — add `timezone text not null default 'UTC'` to `user`; migration
- Modify: `src/auth/server.ts` — expose `timezone` via `additionalFields`
- Create: `src/server/userPrefs.ts` — `setTimezone({ tz })` server fn that updates the user's timezone
- Modify: `app/routes/(app)/_layout.tsx` — on mount, client-side read `Intl.DateTimeFormat().resolvedOptions().timeZone` and POST it once per session if different from the stored value
- Modify: `src/jobs/narrator.ts` — `digestWeeklyScheduler` honors per-user timezone: computes local-22:00 trigger per user rather than global 22:00 UTC

**Implementation note:**
- Scheduler still fires at 22:00 UTC daily (cron pattern stays). Inside the function, query users whose `22:00 local` == now-UTC using their stored tz. Use `new Intl.DateTimeFormat('en-US', { timeZone: u.timezone, hour12: false, hour: 'numeric' }).format(new Date())` → compare to `'22'`.

**Steps:**
- [ ] Schema + migration.
- [ ] Auth config additionalFields.
- [ ] Set-tz server fn + client-side capture effect.
- [ ] Scheduler timezone filter.

## Task 11 — Coach references as typed Links

**Files:**
- Modify: `src/components/trades/CoachNarrative.tsx`

**Behavior:**
- After rendering the markdown prose, scan the `referencedPositionIds` array from the `CoachNarrative` schema. For each id, resolve its symbol + side via a light `getPositionsByIds({ data: { ids } })` server fn (create it in `src/server/trades.ts`). Render a small footer row: "Referenced trades: [BTCUSDT long Apr 21] [ETHUSDT short Apr 18]" — each a typed `<Link to="/trades/$positionId" params={{ positionId: id }}>`.
- Cache the lookup per `positionId` in TanStack Query.

**Steps:**
- [ ] `getPositionsByIds` server fn (accepts up to 10 ids, auth + ownership check).
- [ ] CoachNarrative fetches + renders footer chips.

## Task 12 — Wiki close-out + badge flips

**Files:**
- Modify: `docs/wiki/phases.md` — Phase 6 Shipped section
- Modify: `app/routes/(public)/index.tsx` — flip any remaining "PHASE 4"/"PHASE 5"/"PHASE 6" badges that are now live
- Modify: `app/routes/(app)/_layout/trades/$positionId.tsx` — Findings-count pill on Coach tab now shows real data, drop any PHASE 4 label

**Steps:**
- [ ] Add the Phase 6 entry with commits, decisions, gotchas, deferred items.
- [ ] Badge sweep.
- [ ] Target test count: 115+ passing (depends on Task 2 + Task 3 test additions).

---

## Scope NOT in Phase 6 (deferred to Phase 7+)

- **Bybit / OKX ingestion** — Phase 7. New CSV adapters + normalizer test fixtures + HL-parity test matrix. Substantial.
- **Custom user-defined detectors** — Phase 8. Detector DSL + admin UI + runtime evaluation + test matrix.
- **Email unsubscribe + preferences UI** — small follow-up phase, bundled with Phase 7 or done standalone.
- **Playwright E2E smoke suite** — separate setup phase (browser install, CI config, fixtures). Worth its own plan.
- **Digest "Send me this now" button** — narrator polish; ~1 day, bundle with Phase 7.
- **Real market-data candles in fills timeline** — requires a market-data provider integration. Phase 8+.
- **CLI-friendly env schema** (no more `GOOGLE_CLIENT_ID=cli` inline) — minor; may bundle into Phase 6 Task 1 if time permits. If not, defer.
