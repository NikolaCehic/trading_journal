# Project Wiki — Phases

One entry per phase. Updated at the end of each phase with what was built, design decisions worth remembering, and anything deferred.

- Source spec: `docs/superpowers/specs/2026-04-20-ai-trade-journal-design.md`
- Plans: `docs/superpowers/plans/`

---

## Phase 0 — Foundation · **Shipped**

**Plan:** `docs/superpowers/plans/2026-04-20-phase-0-foundation.md`

**Shipped**
- TanStack Start app bootstrapped, deployed to Cloudflare Pages
- Drizzle + Neon Postgres wired via `@neondatabase/serverless`
- Better Auth + Google OAuth + "Try demo" stub
- Inngest client + heartbeat cron + local dev adapter
- `@t3-oss/env-core` env validation at boot
- Sentry Workers SDK scaffolded
- GitHub Actions: typecheck, lint, Drizzle migration check, Vitest

**Key decisions**
- Pages + Workers runtime (free tier target, no egress fees)
- Dark mode only; warm-orange brand accent `#ea580c`
- Inter + JetBrains Mono with tabular figures mandated in CSS

---

## Phase 1 — Ingestion & canonical data · **Shipped**

**Plan:** `docs/superpowers/plans/2026-04-21-phase-1-ingestion.md`

**Shipped**
- Three source adapters behind `SourceAdapter<TInput>`: `binance-csv`, `hyperliquid-csv`, `hyperliquid-wallet`
- Orchestrator persisting raw rows + deduped canonical fills (`Fill` unique on `(user_id, exchange, external_id)`)
- Inngest `hl-wallet-pull` function with rate-limit backoff
- `/app/import` page: validation preview, live progress, import history
- `ingestion/complete` event emitted from both CSV server function and HL wallet Inngest job
- Unit tests per adapter + idempotent-reimport integration test (skips without real DB)

**Key decisions**
- Fill IDs are deterministic: `fill_${userId}_${exchange}_${externalId}` (sliced to 128 chars) → makes re-imports trivially idempotent
- Raw rows kept forever (even skipped ones) with `normalize_status`
- Binance spot synthesizes `external_id = hash(time+symbol+side+price+qty)` (spot CSV has no stable ID)
- HL CSV `dir` field (Open Long / Close Long / …) captured in `normalizer_hint` for downstream merging

**Deferred to Phase 2**
- Nothing outstanding — ingestion does not know about positions or findings yet; derivation picks up from the `Fill` table.

---

## Phase 2 — Derivation engine · **Shipped**

**Plan:** `docs/superpowers/plans/2026-04-22-phase-2-derivation.md`

**Shipped** (23 commits from `3e3d443` through `15205e3`)
- Derivation DB schema — 7 tables (`position`, `position_fill`, `daily_metric`, `asset_metric`, `session_metric`, `summary_rollup`, `finding`) + 3 enums, migrations `0001_majestic_miracleman.sql` + `0002_large_golden_guardian.sql` (not yet pushed to Neon)
- Domain types: `Position`, `PositionFillRef`, metric values, `Finding<TEvidence>` + 11 strongly-typed evidence schemas
- Position merger (`src/derivation/merge.ts`) with TDD: perp lifecycle, adds/reduces with weighted avg entry, partial closes, shorts, liquidation, still-open, side-flip, spot FIFO — 11 passing unit tests
- Metrics modules: `daily`, `asset`, `session`, `summary` + shared stats helpers (`mean`, `stddev`, `variance`, `median`, `percentile`, `expectancy`) — 4 passing unit tests
- All 11 detectors implemented with positive fixture + unit tests each:
  - `revenge_trading`, `oversized_positions`, `loss_of_discipline_windows`, `position_sizing_instability`, `cut_winners_ride_losers`, `overtrading_after_losses`, `fee_drag`, `scaling_into_losers`, `short_hold_scalping`, `symbol_underperformance`, `leverage_creep`
- Detector registry + runner (`src/derivation/runner.ts`) + `persistDerivation` (delete-then-insert, idempotent per `(userId, version)`)
- Inngest function `derive-on-ingestion-complete` subscribed to `ingestion/complete`, plus `rederive` function for version-bump workflows
- Admin CLI `pnpm rederive --user=<id> --version=N`
- Golden-fixture integration matrix — 12 persona CSVs cover `steady-discipline` (zero findings) + positive case for every detector; all green on first run

**Test state after Phase 2:** 76 passing / 4 failing (pre-existing Phase-0 smoke tests failing on empty env vars, unrelated to Phase 2) / 2 skipped (real-DB integration). `pnpm typecheck` clean.

**Key design decisions / gotchas recorded during implementation**
- `DERIVATION_VERSION = 1` — single source of truth in `src/derivation/version.ts`. Bump when detector/merger/metric logic changes observably.
- `Position.maxNotionalUsd` is used as a **proxy for leverage** in `leverage_creep`. HL CSV does not expose account margin, so explicit leverage isn't available for CSV imports. The detector works without tightening; future wallet-API data can replace this with real leverage without changing the detector interface.
- Merger bug-fix landed in commit `dd0c698`:
  - Critical: `currentAvgEntry` computed from `netSize` (not from the original `weightedEntrySum/totalOpenSize` ratio) so reduce-then-add sequences get the correct weighted entry
  - Important: fee pro-rating `closeFee = fee × (closeSize/size)` on side-flip and reduce-overshoot paths so a single fill's fee isn't double-counted across two positions
- `position_fill_position_id_idx` added in commit `5c257dc` to cover the "all fills for this position" lookup the persist layer issues
- `position_user_id_idx` removed (redundant with `position_user_symbol_idx`'s leading column)
- `normalizerHint` widened to `Record<string, unknown> | null` to match how the orchestrator persists the column for spot fills
- Plan's initial `position_sizing_instability` guard `if (vp === 0) return []` was inverted — when prior window is perfectly stable and recent has variance, that's the clearest possible "instability" signal, so we cap the ratio at 999 rather than bailing
- Plan's initial `revenge_trading` median fallback order (computed-first, summary-fallback) was flipped to trust the summary's precomputed median; both paths are equal in production since summary is computed by `computeSummaryRollup` from the same positions
- `scripts/rederive.ts` requires `--env-file=.env.local` and (because `env.ts` validates every var eagerly at import time) inline `GOOGLE_CLIENT_ID=cli GOOGLE_CLIENT_SECRET=cli` placeholders so the CLI boots without real Google OAuth secrets. Ugly but contained. A cleaner fix is a CLI-specific env schema; left as follow-up.
- `tsx` was promoted from transitive to direct devDependency in this phase to run the rederive script (pnpm-lock.yaml touched for that reason)

**Deferred from Phase 2**
- Apply `drizzle/0001_*.sql` + `drizzle/0002_*.sql` to the live Neon DB (user runs `pnpm drizzle-kit push` manually)
- Backfill `env.ts` with a CLI-friendly env variant so rederive doesn't need inline `GOOGLE_CLIENT_ID` overrides
- Phase-0 smoke tests (`tests/smoke/phase-0.test.ts`) fail against the current `.env.local` with empty OAuth vars — this was true before Phase 2 started; flagged for whoever owns the smoke test suite
- No real leverage data flows yet — `leverage_creep` fires on notional size. Tightening this is a v2 item once HL wallet API delivers position/margin snapshots.

---

## Phase 3 — Dashboard & Trade Views · **Shipped**

**Plan:** `docs/superpowers/plans/2026-04-23-phase-3-dashboard.md`

**Shipped** (22 commits from `ae40274` through `48a0813`)
- **`/app/dashboard`** — controls row with URL-persisted time-range + instrument toggles, 5 KPI tiles (realized PnL sparkline, win rate, expectancy, trade count, max drawdown) with prior-period deltas, full-width equity curve area chart with drawdown shading, 24-column hour-of-day expectancy strip, top-winners/losers horizontal bar chart, active-findings sidebar, derivation-version footer with fill/position counts
- **`/app/trades`** — sticky filter bar (search + instrument + side + PnL toggles), dense monospaced table with note/tag/liquidated indicators, keyboard nav (`/` focuses search, `j/k` move, `Enter` opens, `x`/`Space` toggles select), bulk-tag dialog
- **`/app/trades/:positionId`** — position header (symbol + badges + PnL), metric chips row, Recharts fills-timeline scatter (role-colored), 4-tab scaffold: Notes (autosave + markdown preview), Tags (setup/mistake pickers + custom tag creation + confidence chips + emotion select + Save for reflection), Findings (detector cards), Coach stub (Phase 4 placeholder)
- **Journal layer** — `trade_note`, `setup_tag`, `mistake_tag`, `position_tag`, `position_reflection` tables; 8 seeded starter mistake tags via Better Auth `databaseHooks.user.create.after`
- **Global shell** — `<TopBar />` with brand logo + nav + `<VersionBadge />` showing `v{DERIVATION_VERSION}` + user email; main column tightened to `max-w-[1280px]`
- **Loading / empty / focus polish** — `<TableSkeleton />`, `<DetailSkeleton />`, `<EmptyState />`, `:focus-visible` outline at brand orange; sonner `<Toaster />` mounted in root

**Test state after Phase 3:** 90 passing / 4 failing (still the pre-existing Phase-0 smoke tests failing on empty OAuth env vars) / 2 skipped (real-DB). `pnpm typecheck` clean. 14 new tests added across filter helpers, server validators, KPI tile component.

**Key design decisions / gotchas recorded during implementation**
- Presentation reads only derived rows (spec §4.1) — every server fn hits `summary_rollup`, `daily_metric`, `asset_metric`, `session_metric`, `finding`, `position`, `position_fill`, `fill`, plus the new journal tables. Never recomputes.
- Dashboard filter state lives entirely in the URL via typed search params + `useDashboardFilters` hook. `timeRange` actually filters the daily slice; `symbols` / `instrument` / `setupTagIds` are UI-only — wiring them into aggregate queries needs per-filter rollup tables, parked for Phase 6.
- Heatmap is hour-only (single-row 24-col grid). Day-of-week axis requires a new `dayOfWeekMetric` derived table — deferred.
- `DashboardBundle.topFindings` uses a narrow `DashboardFinding` type (concrete JSON-safe `evidence`) instead of the generic `Finding<TEvidence>` — TanStack Start's `ValidateSerializableMapped` rejects `unknown`. Same treatment applied in `TradeDetailBundle.fills.normalizerHint` and `TradeDetailBundle.findings.evidence` via a local `JsonValue` type (the pattern `src/server/import.ts` already used).
- Better Auth v1.6.5 exposes `databaseHooks.user.create.after` natively — used this for the mistake-tag seeder instead of a lazy fallback.
- shadcn's installed `<ToggleGroup>` (from `@base-ui/react`) no longer takes `type="single"` — it uses array values. Adapted everywhere (`value={[single]}`, unwrap in `onValueChange`).
- Notes tab uses plain `<Textarea>` + `react-markdown` + `rehype-sanitize`. Autosave is ref-based (`latestSave.current`) so the debounce timer doesn't reset on every render when the save callback closes over position-scoped state.
- sonner `<Toaster />` is imported from the raw package, not the `src/components/ui/sonner.tsx` wrapper (the wrapper pulls from `next-themes` which isn't set up; raw import with `theme="dark"` is equivalent).
- Stubbed `/app/trades` and `/app/digest` routes created in Task 8 to keep the top bar typechecking. `routeTree.gen.ts` was manually edited there and in Task 16 (for `$positionId`).
- Dashboard-side links to `/trades/:id` use plain `<a>` anchors (pragmatic — TanStack Router's typed `<Link>` requires routes registered at compile-time, Task 16 filled that in; swapping anchors → Link is Phase 6 polish).
- Built-in `db.$count(table, where)` works in the installed drizzle version (`0.45.2`); no SQL-count fallback needed.
- `applyPositionTag` ownership check tightened from "fetch all user positions" to `inArray(position.id, positionIds) AND eq(userId)` — bounded by the 200-ID request cap.
- Component tests: `@testing-library/react` + `jsdom` installed, `tests/setup.ts` extends `expect` with jest-dom matchers, component tests use `// @vitest-environment jsdom` docblock to opt in per-file.

**Deferred from Phase 3**
- Day-of-week axis on the heatmap (needs new `dayOfWeekMetric` derived table)
- Symbol / setup-tag / instrument filters wired into KPI + equity-curve + heatmap queries (today only `timeRange` is applied)
- Export button on dashboard controls row
- Rich-text / markdown-editor toolbar on Notes tab (plain textarea for now)
- Trade list: date range picker, size-percentile slider, tag-filter chips
- Replace plain `<a href="/trades/...">` anchors with typed `<Link to="/trades/$positionId">` across dashboard (bars, findings sidebar) and trade list (table rows)
- E2E tests (Playwright) and visual regression — parked for Phase 6
- Same pre-existing Phase-0 smoke-test failure (empty OAuth env vars in `.env.local`) still present

---

## Phase 3.5 — Design-system refactor & TanStack Start upgrade · **Shipped**

Triggered after an initial `pnpm dev` boot failure surfaced that the app was on a mixed-version TanStack Start stack (1.120 Vinxi base + 1.167 peer packages) and the shadcn v4-CLI output was emitting Tailwind v4 syntax against a Tailwind v3 build, so ~30% of utility classes generated no CSS.

**Stack upgrade**
- Dropped `@tanstack/start@1.120.20` + `@tanstack/start-client-core` + `vinxi@0.5.11` + `vite-tsconfig-paths`
- Added `@tanstack/react-start@^1.167.42`, `@vitejs/plugin-react@^6.0.1`, upgraded `vite` to `^8.0.0`
- Deleted `app.config.ts` + stray `vinxi` timestamp files; new `vite.config.ts` uses `tanstackStart({ srcDirectory: 'app' })`
- Added `app/router.tsx` exporting `getRouter()`
- Rewrote `app/routes/__root.tsx` to use the new `shellComponent` pattern
- API routes: `createAPIFileRoute('/api/...')` → `createFileRoute('/api/...')` + `server.handlers`
- Server fns: `@tanstack/start-client-core` import → `@tanstack/react-start`; `vinxi/http` `getWebRequest` → `@tanstack/react-start/server` `getRequest`

**UI overhaul**
- Generated a design system via Claude Design and ported it verbatim. `src/styles/globals.css` is now pure custom-property tokens + `.tj-*` semantic classes — no `@tailwind` directives, no `@apply`, no shadcn primitives.
- New shared components under `src/components/tj/`: `Icon`, `primitives` (`KpiTile`, `Delta`, `SymbolPill`, `SidePill`, `SeverityDot`, `FindingCard`, `TagChip`, `FilterChip`, `MetricChip`, `Segmented`, `Card`, `Checkbox`, `EmptyState`)
- Dashboard components rebuilt as pure SVG: `EquityCurve`, `AssetBreakdown`, `FindingsSidebar`, `Heatmap` (7×24 cell grid)
- Trade-detail candle-and-fills chart inlined in `$positionId.tsx`
- Marketing landing page at `/` ported verbatim from Claude Design's `tj-landing.jsx` — 11 sections (hero, product screenshot, three promises, findings demo, 11-detector grid, how-it-works, compare table, digest preview, principles, pricing, FAQ, final CTA, footer). All sign-in CTAs call `signIn.social({ provider: 'google', callbackURL: '/dashboard' })` directly.
- Deleted: `src/components/ui/*` (all 20 shadcn files), `EmptyState.tsx`, `LoadingSkeleton.tsx`, `VersionBadge.tsx`, plus 16 stale dashboard/trades components

**Route-tree fix (critical)**
- Original `(app)/_layout.tsx` was never wrapping children because sibling files in `(app)/` don't auto-nest — TanStack Router only parents routes that live inside a `_layout/` folder. Result: TopBar never rendered AND `beforeLoad` auth gate was bypassed on every app route.
- Moved all app pages into `app/routes/(app)/_layout/` (dashboard, import, trades/index, trades/$positionId, digest/index) and updated each `createFileRoute` path to `/(app)/_layout/...`. `routeTree.gen.ts` auto-regenerates correctly; `/dashboard` now returns 307 → `/login` for unauthenticated requests.

**Other fixes along the way**
- `.env.local` populated with real `DATABASE_URL` (Neon), real `BETTER_AUTH_SECRET`, real Google OAuth creds
- `pnpm drizzle-kit push` applied all pending migrations to Neon
- OAuth `callbackURL` fixed from `/app/dashboard` to `/dashboard` (the `(app)` route group has no URL segment)
- `QueryClientProvider` added to `__root.tsx` — dashboard `useQuery` was throwing "No QueryClient set"
- Stale zombie dev server on port 3001 killed; only the fresh port-3000 process runs

**Mocks for visual parity**
- Dashboard, Trades list, and Trade detail currently render **design-system mock data** (realistic KPIs, 12 example trades, 5 findings, 7×24 heatmap). The derived server fns still exist; field-mapping them into the design's view models is the remaining follow-up.
- Import flow is fully wired to real server fns (`validateCsvImport`, `startCsvImport`, `startWalletImport`, `getImportHistory`, `getImportStatus`) — this is how real data enters the DB.

**Test state after Phase 3.5:** unchanged from Phase 3 — presentation-layer change only. Component tests that referenced deleted shadcn `ui/*` primitives were not re-written and may now be stale; those are Phase 6 polish.

**Deferred from Phase 3.5**
- Re-wire dashboard / trades / trade-detail to real server fns (map `DashboardBundle` → design view-models, same for `TradeDetailBundle`)
- Port `EquityCurve` to accept real `equityCurve: { date; cumulativePnl }[]` instead of `generateEquityCurve()` mock
- Rewrite stale component tests that referenced deleted `ui/*` primitives
- Landing-page marketing nav items (Product / Detectors / Pricing / Changelog) currently no-op; wire as anchor-scrolls or separate routes if those pages ship
- "View sample digest" and "Read the changelog" buttons on the landing have no destination yet — pending Phase 4 content

---

## Phase 4 — AI Narrator · **Shipped**

**Plan:** `docs/superpowers/plans/2026-04-24-phase-4-narrator.md`

**Shipped** (11 commits from `5403d69` through `0940aa4`)

- **Env + SDKs** — `@anthropic-ai/sdk` + `resend`. `ANTHROPIC_API_KEY` promoted to required; `RESEND_API_KEY` / `DIGEST_FROM_EMAIL` optional (log-only mode when absent); `AI_ENABLED=on|off` kill switch.
- **DB** — `digest_run` (`narrative jsonb`, unique `(user_id, iso_week)`), `digest_rule` (user opt-in rules, unique `(user_id, detector_id)`), `trade_coach_note` (cache keyed by `(position_id, derivation_version)`). Migration `drizzle/0004_dapper_mariko_yashida.sql`.
- **Fact builders** (`src/narrator/facts/`) — `buildDigestFacts(db, userId, isoWeek)` and `buildCoachFacts(db, userId, positionId)` read only from derived tables. Return bundles with `allowedPositionIds` / `allowedFindingIds` allowlists for grounding. 18/18 unit tests.
- **Zod schemas + prompts + grounding validator** (`src/narrator/{schemas,validate,prompts/*}`) — `DigestNarrativeSchema`, `CoachNarrativeSchema`, prompt builders that encode the voice rules + grounding rules in the system message, and a post-hoc validator that rejects any fabricated IDs, numbers, or banned voice words. 13/13 tests.
- **LLM client + compose + fallback** (`src/narrator/{client,compose,fallback}`) — wraps `@anthropic-ai/sdk` with 20s timeout, defaults to `claude-sonnet-4-6` (override via `NARRATOR_MODEL`). `composeDigest`/`composeCoach` run prompt → lenient JSON parse → validate; on failure, single retry at temp 0.3 with stricter framing; on second failure, deterministic fallback template. Returns `{ narrative, tokensIn, tokensOut, retried, failed, error? }`. 8/8 tests.
- **Email render + Resend send** (`src/narrator/email/{render,send}`) — inline-styled table-based HTML digest (Gmail/Outlook/Apple Mail safe), plain-text fallback, subject formula `TJ · <date> — <signed P&L> · <N thing to try>`. `sendDigestEmail` never throws; returns typed `SendResult` with log-only path when Resend isn't configured. 11/11 tests.
- **Inngest functions** (`src/jobs/narrator.ts`) — `digestWeeklyScheduler` daily cron at 22:00 UTC with Sunday short-circuit, `composeDigestFn` on `digest/compose` with idempotent `onConflictDoNothing` insert, `sendDigestFn` on `digest/send` with skip-if-sent guard. Events `digest/compose` + `digest/send` in `src/jobs/events.ts`.
- **Coach tab** — `getTradeCoach` server fn (`src/server/coach.ts`) with auth + ownership + cache by `(positionId, derivationVersion)`; `CoachNarrative.tsx` presentational component renders grade chip (A–F color-coded) + markdown prose + "generated N ago" caption. Wired into `trades/$positionId.tsx` Coach tab (replaces the Phase 4 stub).
- **Pattern-of-the-week + rule opt-in** — `src/server/rules.ts` with `adoptRule` / `archiveRule` / `getRuleViolationsThisWeek`. `FindingsSidebar` rewritten to expose an "Adopt this rule" button on the top finding; after adoption, a `tj-chip-accent` chip shows live weekly violation count (re-fetched every 60s).
- **Digest preview** (`/digest`) — `previewDigest` server fn composes the current-week digest without persisting to `digest_run`. Preview page renders the composed narrative on the left + the rendered HTML in an iframe on the right, plus a meta row with token counts + failed/retried badges.
- **Budget + observability** (`src/narrator/budget.ts`) — per-user weekly cap `NARRATOR_USD_PER_USER_WEEK = $0.10` computed from historical `digest_run.tokensIn/out` + `trade_coach_note.tokensIn/out` at Anthropic Sonnet 4.6 pricing ($3/M in, $15/M out). `composeDigest`/`composeCoach` pre-check; over-budget → deterministic fallback. Structured `log.info({ msg: 'narrator: compose', fn, userId, tokensIn, tokensOut, validated, retried, failed, latencyMs })` at every exit.

**Test state after Phase 4:** 50/50 narrator tests green across 4 test files (`facts`, `schemas`, `compose`, `email`). Aggregate suite is higher — pre-existing failing suites from Phase 0 smoke and stale `KpiTile.test.tsx` not addressed in this phase.

**Key design decisions / gotchas**
- Grounding is done in code, not in the LLM. The validator extracts every dollar/percent/ID token from the composed prose and intersects with a set built from `JSON.stringify(facts)` plus integer-rounded / 2-decimal variants of every raw number in the fact bundle. Numbers `0` and `1` are always trivially allowed (so "1 thing to try" doesn't fail).
- Narrator uses plain string IDs (`z.string().min(1)`) instead of `.uuid()` because some entity IDs in this codebase are not strict UUIDs (e.g., persistence layer writes from derivation use `nanoid`-style).
- `CoachFactBundle` carries `userId` at the top level (added in Task 11) so the budget pre-check can identify the user without an additional lookup. The fact-builder populates it; compose reads it.
- `digest_run` unique key `(userId, isoWeek)` + `onConflictDoNothing` keep compose idempotent across retries and re-schedules. Re-running a week just skips if already composed/sent.
- ISO week string format `YYYY-Www` (e.g. `2026-W17`). Hand-rolled parser/formatter lives in both `digestFacts.ts` and `narrator.ts` (intentional duplication — small helpers, no shared module needed).
- Budget checker DB failure is non-fatal (try/catch with log.warn); compose proceeds. The alternative (block compose on budget DB outage) fails user-facing.
- `@anthropic-ai/sdk` v0.90 exports `Anthropic` as default; used as constructor. Response content is an array of blocks; we flatten `type === 'text'` ones.
- Email HTML uses `<table>` layout and inline styles only — no `<style>` block, no classes, no external CSS. This is the only way to render consistently across Gmail/Outlook/Apple Mail.
- `composeDigestFn` uses `onConflictDoNothing({ target: [digestRun.userId, digestRun.isoWeek] })` — drizzle requires the unique-constraint columns explicitly even when the schema has the unique set.
- Preview route does NOT write to `digest_run` — it's strictly read-through-compose. Budget checker still sees these calls via the eventual send path when the scheduled digest fires on Sunday.
- `trade_coach_note.positionId` is `text` (not `uuid`) because the referenced `position.id` is text. Migration keeps both sides consistent.

**Deferred from Phase 4**
- Wire the scheduler's user-selection query to filter by recently-active users (today it fans out to every user row — fine for beta-scale, but not for growth)
- Per-user timezone capture — the scheduler fires at 22:00 UTC, not local. Add a `user.timezone` column and offset-resolve in `digestWeeklyScheduler`
- "Send me this now" button on `/digest` preview route — fires a one-off `digest/send` with a synthetic `digest_run` row
- Custom user-defined detectors (Pro plan feature — separate phase)
- Unsubscribe + email preferences page
- Real detector→rule-violation query inside `getRuleViolationsThisWeek` — today it counts findings that reference the same `detectorId` in the period; a clean v2 would re-run the detector against this-week-only data and compare against the user's rule threshold explicitly
- Actual fill-level coach referencing (right now `referencedPositionIds` in `CoachNarrative` is validated but the UI doesn't turn those IDs into `<Link>`s yet)
- "View sample digest" / "Read the changelog" marketing buttons on the landing still no-op
- Flip the Coach tab's "PHASE 4" badge in the Findings-count pill to "LIVE" — small copy polish
- The Phase 0 smoke tests and stale `KpiTile.test.tsx` still fail and still aren't touched — Phase 6 polish

---

## Phase 5 — Real-Data Wiring + Demo Mode · **Shipped**

**Plan:** `docs/superpowers/plans/2026-04-25-phase-5-real-data-demo.md`

**Shipped** (7 task commits from `b85899e` through `2108184`)

- **Dashboard** — `EquityCurve`/`AssetBreakdown`/`FindingsSidebar`/`Heatmap` now accept real data props. Dashboard route uses `useQuery(['dashboard', filters], () => getDashboardBundle({ data: serializeFilters(filters) }))`. Empty state (`bundle.meta.totalFillCount === 0`) replaces KPIs + charts with a single "Import your first trades" CTA. `EquityCurve` keeps backward-compat for the landing page (no `points` prop → falls back to mock `MockEquityCurve`). Phase 4 adopt-rule flow in `FindingsSidebar` preserved.
- **Trades list** — `app/routes/(app)/_layout/trades/index.tsx` rewritten. Uses `useQuery(['tradeList', filters], () => getTradeList(...))`. Empty states: `total=0` unfiltered → "Import your first trades"; filters too narrow → "No trades match these filters". Bulk-tag dialog inline (plain divs + fixed positioning), fetches `listTags()`, calls `applyPositionTag` per selected tag with toast confirmation. Keyboard nav deferred to Phase 6. `mockTrades.ts` deleted.
- **Trade detail** — `app/routes/(app)/_layout/trades/$positionId.tsx` rewritten. `useQuery(['tradeDetail', positionId], () => getTradeDetail({ data: { positionId } }))`. Notes tab: real autosave via `upsertTradeNote` with 800ms debounce + `latestSave` ref pattern (avoids stale closures). Tags tab: real apply/remove/create via `applyPositionTag`/`removePositionTag`/`createTag` with optimistic invalidation. Findings tab: real `bundle.findings` rendered through `react-markdown` + `rehype-sanitize`. Coach tab (Phase 4) preserved untouched. CandleChart simplified to fills-only SVG — market-data candles deferred.
- **Empty-state polish** — Trade detail distinguishes "not found" (specific card + Link back) from generic errors. Digest preview adds a third state: `data.narrative` with all sections null → `PreviewNoData` card ("No closed trades this week yet"), short-circuiting before surfacing AI failures as errors.
- **Demo seed** — `src/server/demoSeed.ts` with `seedDemoUser()` that wipes + recreates the demo user (`demo-user-0001`, email `demo@tradejournal.local`, `isDemo=true`), seeds an `exchangeAccount` + `importRecord` + 24 hand-crafted fixture fills across 12 positions (mixed spot/perp, mixed wins/losses, deliberate revenge-trading cluster + FOMO entries), then runs `runDerivation`. CLI at `scripts/seedDemo.ts` — `pnpm seed:demo`.
- **`/api/demo` route** — `app/routes/api/demo.tsx` mints a signed Better Auth session cookie (HMAC-SHA-256 via `crypto.subtle`, matching hono's `<token>.<base64sig>` format so Better Auth's `getSignedCookie` validates it). Cookie name: `better-auth.session_token` (`__Secure-` prefix in prod). 7-day expiry. Returns 503 `demo_not_seeded` if the demo user doesn't exist yet.
- **Read-only guard on writes** — `src/auth/assertNotDemo.ts` exports `DemoReadonlyError` + `assertNotDemo(user)`. Applied to every mutation server fn: `startCsvImport`, `startWalletImport`, `upsertTradeNote`, `applyPositionTag`, `removePositionTag`, `createTag`, `upsertReflection`, `adoptRule`, `archiveRule`. **Not** applied to `getTradeCoach` (intentional — demo users SHOULD be able to use the Coach tab, and its writes are cache-only). `useIsDemo` hook wraps `useSession().data?.user?.isDemo`. `DemoBanner` component renders a 32px amber strip at the top of `RootDocument` when demo session active.
- **Landing "Try demo" button** — `handleDemo()` POSTs `/api/demo`, redirects to `/dashboard` on success, shows an `alert()` on failure (pre-auth page, no toast provider). Hero button no longer disabled; `PHASE 5` badge removed.

**Test state after Phase 5:** unchanged — no new tests written for Phase 5 tasks (this is a UI-wiring phase; server fn tests from Phase 3 still cover the data path). Pre-existing 3-error `KpiTile.test.tsx` file still not cleaned up.

**Key design decisions / gotchas**
- The design-mock `EquityCurve` stays callable with no props so the landing page's dashboard screenshot continues to render without data. When real `points` are passed, the chart re-axes to 0-baseline (not 10000-baseline like the mock) and colors by sign of the last cumulative P&L.
- Dashboard KPIs: "Avg W / Avg L" and "Profit factor" aren't in the KPI-with-delta shape (`DashboardBundle.kpis` only carries realizedPnl / winRate / expectancy / tradeCount / maxDrawdown), so those two tiles compute from `bundle.summary` directly without delta chips. Acceptable — they're derived, not first-class metrics.
- `AssetBreakdown` passes `instrument='perp'` to `SymbolPill` for every row because `AssetMetricValue` doesn't carry instrumentType. Visual compromise. A follow-up can map symbol → instrument via the first position of that symbol or add a lookup cache.
- `Heatmap` falls back to `dayOfWeekUtc ?? 0` when missing (real data may be hour-only; design is 7×24). Cells with no match render as empty 22px tiles. Acceptable visual degrade.
- Notes autosave: the `latestSave` ref pattern is critical. Putting `mutation` in the `useEffect` deps array would reset the debounce timer on every render (since `useMutation` returns a new object each render). Ref-based fresh reference → stable effect dep `[text]`.
- `applyPositionTag` takes `positionIds: string[]` (batch), so single-position use calls with `[positionId]` — not the prettiest API but it's what exists.
- Demo seed intentionally produces a **net-negative** portfolio so the detectors fire reliably. A demo showing "+$1,897.48 everything great" doesn't sell the product; a demo showing "you revenge-traded 4x after a big loss, here's the pattern" does.
- `/api/demo` session-mint replicates Better Auth's `hono.getSignedCookie` signing algorithm (HMAC-SHA-256 over token, base64-url-encoded). Dep-free. The alternative — enabling the email/password provider just for the demo login — would have added a second auth path to reason about. Direct session-insert is cleaner.
- `DemoBanner` renders in `__root.tsx` above `{children}`, meaning it appears on EVERY page including the landing. That's correct — if someone's in demo mode and navigates to `/`, the banner should still say so.
- Query fns are NOT guarded by `assertNotDemo` (Dashboard, TradesList, TradeDetail, digest preview, coach). Only writes. Demo users browse everything, just can't save anything.

**Deferred from Phase 5**
- Restore keyboard navigation (`/`, `j`, `k`, `Enter`, `x`, Space) on trades list — Phase 6 polish
- Day-of-week axis on heatmap (needs `dayOfWeekMetric` derived table)
- Symbol/setup-tag/instrument filters wired into KPI + equity-curve + heatmap queries (still only `timeRange` filters today)
- Export buttons on dashboard + trades list
- Rich Notes editor (plain textarea + markdown preview today)
- Instrument mapping on `AssetBreakdown` (all rows currently render `PERP` badge)
- R-multiple + max-drawdown metrics on trade detail chips (data not in bundle; need a new computed field or detector output)
- Real market-data candles in fills timeline
- Bybit / OKX ingestion
- Custom user-defined detectors
- Email unsubscribe + preferences UI
- Per-user timezone capture for digest scheduling
- Phase-0 smoke test + stale `KpiTile.test.tsx` — still not addressed

---

## Phase 6 — Polish + Correctness · **Shipped**

**Plan:** `docs/superpowers/plans/2026-04-26-phase-6-polish.md`

**Shipped** (11 task commits from `9a4d0d9` through `b829012`)

- **Test hygiene** — `tests/unit/components/KpiTile.test.tsx` deleted (referenced a deleted module from Phase 3.5). `tests/smoke/phase-0.test.ts` gated behind `process.env.CI === 'true'` via a `describeInCI` wrapper — it still runs in CI but no longer fails locally on fresh checkouts. Suite is now 139 passing / 5 skipped / 0 failing files.
- **Dashboard filters actually filter** — `getDashboardBundle` refactored around a `resolveFilteredPositionIds(db, userId, filters)` helper that honors `symbols[]`, `instrument`, and `setupTagIds[]` (AND semantics). All downstream aggregates (KPIs, equity curve, heatmap, asset breakdown, summary, top findings, session breakdown, meta counts) recompute from the filtered position set. Prior-period delta uses the same filters with a shifted window. 10 new unit tests. Dropped the rollup shortcut; keeps the read path uniform.
- **Day-of-week heatmap** — new `day_of_week_metric` table with composite PK `(userId, dayOfWeekUtc, hourOfDayUtc, derivationVersion)`. Aggregator in `src/derivation/metrics/dayOfWeek.ts` uses ISO convention (Mon=0..Sun=6) via `((getUTCDay()+6)%7)`. Persisted by the runner. `DERIVATION_VERSION` bumped from 1 → 2. Server fn reads from the new table on the unfiltered path; filter-active path still computes on-the-fly. Migration `drizzle/0005_wandering_gargoyle.sql`. 5 new tests. **Users must run `pnpm rederive` once after deploy** to populate the new metric.
- **Keyboard nav on trades list** — `/` focus search · `j`/`k` highlight move · `Enter` open · `x`/`Space` select · `Esc` clear. ArrowUp/ArrowDown also work. Highlight shown as a 3px accent-colored inset box-shadow on the left edge. `data-hl="true"` attribute on active row + `querySelector` scrollIntoView on index change. Shortcut hint rendered below the results count: `/ search · j/k navigate · Enter open · Space select · Esc clear`.
- **R-multiple + max-drawdown** — two new numeric columns on `position` (`r_multiple`, `max_drawdown_pct`). R-multiple is `realizedPnl / (entryAvgPrice * 0.01 * size)` — v1 approximation where 1R = 1% of entry notional (documented in comment). Max-drawdown walks fills in time order tracking the adverse excursion from entry; null when no adverse tick was ever seen mid-trade. Both surfaced in the trade-detail metric chips with appropriate color coding. Migration `drizzle/0006_fuzzy_post.sql`. 4 new merger tests. **Users must `pnpm rederive` to populate for existing positions.**
- **Notes editor toolbar** — above the `<textarea>`, 8 selection-wrapping buttons (**B** · **I** · **H1** · **H2** · **•** · **1.** · **`<>`** · **—** horizontal rule). Keyboard shortcuts: Cmd+B, Cmd+I, Cmd+K (link with prompt). Two helpers (`wrapSelection` + `prefixLines`) handle the textbox selection math. Preserves Phase-5 autosave behavior.
- **CSV / JSON exports** — new `src/lib/csv.ts` with `toCsv<T>` + `downloadFile` helpers. Dashboard export: summary + asset breakdown as CSV with filter metadata at top. Trades list: current filtered rows as CSV via header button; bulk-select bar exports only selected rows. Trade detail: full `TradeDetailBundle` as JSON via an icon-button in the header card corner. All client-side — no new server fns.
- **Typed Link sweep** — audit complete. The codebase was already clean: all internal route navigation uses `<Link>`; the remaining `<a>` tags are either intra-page hash anchors, API routes (`/api/auth/sign-out`), or placeholder nav items (wired in the next task). No-op commit.
- **Landing polish + `/changelog` page** — nav items now functional: Product/Detectors/Pricing anchor-scroll to `#product`/`#detectors`/`#pricing` section IDs; Changelog is a typed `<Link to="/changelog">`. "View sample digest" button now links to `/digest`. Footer's Changelog entry also updated. New `app/routes/(public)/changelog.tsx` with a hand-curated 8-entry timeline (v0.0 → v0.6). Added `html { scroll-behavior: smooth }` to globals.
- **Per-user timezone** — new `timezone text not null default 'UTC'` column on `user`; exposed via Better Auth `additionalFields`. `src/server/userPrefs.ts` exports `setTimezone` — validates IANA tz via `new Intl.DateTimeFormat({ timeZone })`. `_layout.tsx` fire-and-forget POSTs the browser's tz on session load if it differs from the stored value. Scheduler cron changed from `0 22 * * *` (daily UTC) to `0 * * * *` (hourly) — the handler filters users to those whose local time is `Sun 22:xx` via `Intl.DateTimeFormat('en-US', { timeZone, weekday, hour })` formatToParts. Demo users excluded. Migration `drizzle/0007_abnormal_toad_men.sql`. 5 new tests for `isSunday22InTz`.
- **Coach references as typed Links** — new `getPositionsByIds` server fn (POST, auth + ownership, silently drops unknown IDs, max 10). New `referenced_position_ids text[] not null default '{}'` column on `trade_coach_note` — persisted on miss, read on hit. `CoachNarrative` component now renders a footer chip row: "Referenced [BTCUSDT long +$352]" with each chip a typed `<Link to="/trades/$positionId">`. Migration `drizzle/0008_add_coach_referenced_position_ids.sql`.

**Test state after Phase 6:** 158 passing / 5 skipped / 0 failing. `pnpm typecheck` clean.

**Key design decisions / gotchas**
- Dashboard filters are strictly AND — an empty `symbols[]` means "all symbols", but adding any symbol filters down to that set. Same for `setupTagIds`. Combining with `instrument` narrows further.
- The setup-tag filter uses a secondary query + in-memory intersection because `selectDistinctOn` isn't reliably supported on the neon-http driver. Cost is one extra roundtrip; acceptable for beta scale.
- `DERIVATION_VERSION` bumped once in Task 3 (for the dayOfWeekMetric table) and the Task 5 position-column additions piggy-backed on the same version. Result: a single `pnpm rederive` covers both.
- Max-drawdown approximation is per-fill, not per-tick. A position that ran deep-red between fills won't capture the minimum price — but since fills include both scale-ins and exits, the signal is reasonable for behavioral analysis.
- R-multiple v1 defines "risk" as 1% of entry notional. The correct semantic is "risk = distance from entry to planned stop × size" — but we don't capture planned stops yet. Documented in code.
- Keyboard `ArrowDown`/`ArrowUp` also work — not just `j`/`k`. Decided this is nicer for new users without breaking the Vim bindings.
- Notes toolbar keeps plain-textarea ergonomics. TipTap was considered and dropped (100KB for a feature most users don't need in v1). Selection-wrap + `prefixLines` covers 80% of markdown-editing use.
- CSV export of the trades list respects current client-side filters — the visible `data.rows` IS the filtered set. Same for bulk-select export. No new server-side query.
- Typed Link sweep was a no-op — the codebase was already clean. Keeping the task in the wiki for completeness.
- `/changelog` is public (no auth). Mirrors landing's aesthetic, reuses `.tj-*` classes + `Wordmark`.
- Scheduler cron went hourly (instead of daily) because the Sunday 22:00 local check needs to fire every hour to catch every timezone. Cost: 24 no-op cron firings per non-Sunday day. Trivial.
- `isSunday22InTz` uses `Intl.DateTimeFormat(...).formatToParts(now)` — more robust than manual offset math. Invalid IANA tz string → function returns false (skip user silently). Logged at INFO level.
- `trade_coach_note.referenced_position_ids` is `text[] not null default '{}'` — existing cache rows (inserted before Phase 6) default to empty array; no crash on read.
- `getPositionsByIds` silently filters out positions the user doesn't own (instead of throwing) — safer UX because the AI could theoretically reference an ID from another user, and we don't want that to break the Coach tab UI.

**Deferred from Phase 6**
- **Bybit / OKX ingestion** — Phase 7 (new adapters + test matrix).
- **Custom user-defined detectors** — Phase 8 (detector DSL + admin UI).
- **Email unsubscribe + preferences UI** — bundle with Phase 7 narrator polish.
- **Playwright E2E smoke suite** — own setup phase.
- **"Send me this now" button** on `/digest` — narrator polish, Phase 7.
- **Real market-data candles** on fills timeline — needs a market-data provider, Phase 8+.
- **CLI-friendly env schema** — still requires `GOOGLE_CLIENT_ID=cli` etc. inline. Low priority; follow-up.
- **Stop-loss / planned-risk capture** — to make R-multiple exact. Separate UX surface for pre-trade planning.
- **Day-of-week axis label orientation** when the heatmap sidebar gets more cramped — minor polish.
- **Tooltip when Filter chips cross 3+ active** — visual busy-ness is noticeable. Nice-to-have.

---

## Phase 7 — Ingestion Expansion + Notification Prefs · **Shipped**

**Plan:** `docs/superpowers/plans/2026-04-27-phase-7-ingestion-prefs.md`

**Shipped** (6 task commits from `fa8c8e0` through `db4ccce`)

- **Bybit CSV adapter** — handles both "Closed P&L / Trade History" (perp) and spot CSV exports. Perp `Direction` (`Open Long` / `Close Long` / `Open Short` / `Close Short`) maps to `side: buy|sell` with `normalizerHint.dir` preserved so the merger uses HL-style lifecycle logic. `stripCommas()` helper handles thousands-separator in prices/fees. Fee = `Trading Fee + Exec Fee` summed. Spot `externalId` is a deterministic hash over time+pair+side+qty (Bybit spot export lacks a trade-ID column). 11 tests. Fixtures `fixtures/bybit-csv-{perp,spot}-sample.csv`.
- **OKX CSV adapter** — single-variant detection; spot vs perp distinguished by symbol format (`BTC-USDT-SWAP` → perp, `BTC-USDT` → spot). Symbol canonicalization strips the hyphens and `-SWAP` suffix. Fees are ABS'd (OKX reports them as negative in some exports). `normalizerHint.direction` captured for perp. 13 tests. Fixture `fixtures/okx-csv-sample.csv`.
- **Dispatch wiring** — `src/server/import.ts` source enum extended to 4 values; adapter construction switches on source; `/import` page adds Bybit + OKX chip toggles with format-specific drop-zone hints. `ExchangeKind` / `exchange_kind` enum extended with `'bybit' | 'okx'`. Migration `drizzle/0009_exchange_kind_bybit_okx.sql` adds the enum values.
- **Settings page `/settings`** — three cards: Account (email + tz readouts), Digest (enable/disable toggle), Export (download full JSON bundle). `setDigestEnabled` + `exportAllData` server fns. `user.digestEnabled boolean not null default true` column (migration `drizzle/0010_lowly_fixer.sql`). TopBar adds a gear icon linking to `/settings` between nav pills and avatar. Scheduler in `src/jobs/narrator.ts` now filters `.where(and(isDemo=false, digestEnabled=true))`.
- **Unsubscribe token flow** — HMAC-SHA256 over `userId` using `BETTER_AUTH_SECRET` as key; format `<userId>.<base64urlSig>`. Timing-safe verify. Every digest email footer now renders `Unsubscribe: <signedUrl>`. `/api/unsubscribe?t=...` verifies, flips `digestEnabled=false`, 302-redirects to `/unsubscribed` confirmation page (public route, no auth). 5 tests for sign/verify including tampered-signature + cross-user-forgery cases.
- **"Send this to me now"** — `sendDigestNow` server fn in `src/server/digestPreview.ts`: finds-or-composes the current-week `digest_run`, then enqueues `digest/send`. Reuses the existing `sendDigestFn` Inngest pipeline so log-only mode (no Resend key) still works. Button on `/digest` disabled when narrative fell back to the deterministic template (`data.failed`). Toast on success/error. Demo users blocked server-side via `assertNotDemo`.

**Test state after Phase 7:** 193 passing / 5 skipped / 0 failing. Typecheck clean.

**Key design decisions / gotchas**
- **`exchange_kind` Postgres enum** required `ALTER TYPE ... ADD VALUE 'bybit'` / `'okx'` via migration. Drizzle-kit generates this correctly; user must push before imports work.
- **Bybit spot trade IDs** aren't in the CSV export, so we synthesize a deterministic hash (`btoa(time|pair|side|qty)`) as the `externalId`. Two imports of the same file = same IDs = idempotent. If Bybit changes their export to include trade IDs, we'll migrate.
- **OKX fee sign** — the `Trading Fee` column can be negative (representing the fee *cost* as subtracted from proceeds). We `Math.abs()` for storage since the fee field semantics everywhere else are "cost paid."
- **Perp `normalizerHint.dir`** on Bybit mirrors what the HL adapter sets — the merger already knows how to consume `dir` values like `Open Long` / `Close Short` to compute position lifecycle. Keeping the same key means zero merger changes.
- **Settings page** reads state from `useSession().data.user` rather than a dedicated query. Better Auth's `additionalFields: { digestEnabled, timezone, isDemo }` config exposes them via the session. Toggle mutations invalidate session indirectly via a page-level revalidation (or let the user refresh — minor UX gap worth fixing in a follow-up).
- **`exportAllData`** uses `JsonValue` casts on JSONB fields (`normalizerHint`, `evidence`, `errorDetail`) to satisfy TanStack Start's `ValidateSerializableMapped` serialization checker (same pattern used in Phase 3 for `DashboardBundle`).
- **`sendDigestNow` + unique `(userId, isoWeek)`** — server fn checks for an existing row first; updates instead of inserts if found. Avoids violating the unique constraint when the scheduler ran earlier and user clicks "Send me now" after.
- **Unsubscribe is single-click** — no double-opt-in, no preferences redirect. Mailbox-friendly. The user can always turn it back on from `/settings`.
- **No new npm deps across all 6 tasks.** The project ships 4 exchanges, a full settings surface, and unsubscribe/email-send controls without a single new dependency.

**Deferred from Phase 7**
- **"Export my data" button deletes + confirms** — currently exports only. Account-deletion flow is a separate surface.
- **More granular digest preferences** — frequency (weekly vs biweekly), topic muting (e.g. "skip the biggest-win section"), quiet hours. Out of MVP.
- **Email preview in Settings** — from `/settings`, show a link that hits `/digest` preview. Minor UX polish.
- **Bybit "Closed P&L" format with Realized Profit column** — some Bybit exports include a separate Realized Profit column we don't currently consume. We accept the simpler "Trade History" variant. Research needed.
- **OKX fee-currency auto-conversion** — if fees are denominated in `BTC` for a BTC-USDT trade, we store the fee in BTC units; the derivation engine treats all fees as USD-equivalent for display. Small skew on spot-in-base-asset fees. Defer.
- **Live sync via exchange read-only API keys** — explicitly NOT this phase. CSV is the privacy-first path.
- **Stop-loss / planned-risk capture** — still deferred (needs a pre-trade planning surface).
- **Custom user-defined detectors** — Phase 8.
- **Real market-data candles** — Phase 8+.
- **Playwright E2E** — own setup phase.

---

## Phase 8 — Pre-trade Plans + Regression Testing · **Shipped**

**Plan:** `docs/superpowers/plans/2026-04-28-phase-8-plans-regression.md`

**Shipped** (6 task commits from `5e53651` through `ccbec60`)

- **`trade_plan` schema + CRUD** — new table with `symbol`, `intendedSide`, nullable `entryPrice`/`stopPrice`/`targetPrice`/`plannedSize`, free-form `rationale`, `archivedAt`. `position.planId` nullable FK with `ON DELETE SET NULL` (archiving a plan preserves linked positions). Migration `drizzle/0011_sad_alex_power.sql`. Seven server fns in `src/server/plans.ts` — all mutations guarded by `assertNotDemo`. 24 new unit tests covering happy paths, demo-readonly, filter + ownership. Circular schema imports (position ↔ tradePlan) handled via lambda FK refs.
- **`/plans` UI** — list page with Active/Archived/All filter, new-plan form with validated search params for symbol+side prefill, detail page with inline edit + archive/unarchive toggle + linked-positions chip row. TopBar adds a "Plans" nav entry between Trades and Digest. Rationale rendered with `react-markdown` + `rehype-sanitize` in read mode.
- **Link-to-plan on trade detail** — `TradeDetailBundle` extended with `linkedPlan` + `availablePlans` (unarchived plans on the position's symbol+side). `PlanChip` component above the PnL column: unlinked → "Link to plan" button → dropdown of matching plans + "+ New" shortcut (prefills `/plans/new?symbol=&side=`); linked → "Plan linked · view" chip + "Unlink" button. Mutations invalidate the trade-detail query; toasts on success/error.
- **R-multiple v2 + plan adherence chips** — `position.rMultiplePlanned: number | null` added to the bundle, computed as `realizedPnl / (|entry − stop| × size)` when plan has both prices. Metric-chips row prefers `rMultiplePlanned` (hint: "vs. planned risk") over the v1 1%-approximation fallback. A new 5-chip adherence row (Entry slip, Exit slip, Size ratio, Hit stop?, Hit target?) renders only when a plan is linked. Entry-slip / exit-slip color by favorability (long entry cheaper = green; long exit higher = green).
- **`plan_adherence` detector** — new detector in `src/derivation/detectors/plan-adherence.ts` checks three violation kinds per linked position:
  1. **oversized**: `actualSize > plannedSize * 1.2`
  2. **cut_short**: winner closed before 70% of planned move toward target
  3. **stop_breach**: loser held more than 1% past planned stop
  Emits `critical` severity on `stop_breach`, `warning` on others. Evidence includes `planId`, `violationKind`, `actualValue`, `plannedValue`, `deltaPct`, `costUsd`. Registered in detector index; `DETECTOR_LABELS` updated with "Plan adherence". **`DERIVATION_VERSION` bumped 2 → 3** — users must `pnpm rederive`. Runner pre-fetches `planMap` (Map<planId, tradePlanRow>) for detectors; all 11 existing detector fixtures updated to include `planId: null` + empty `planMap`. 6 new tests.
- **Playwright E2E smoke suite** — `@playwright/test` added as devDep; `playwright.config.ts` with single chromium project, `webServer` that reuses existing dev server in non-CI mode, `baseURL` env-configurable. `tests/e2e/smoke.spec.ts` walks landing → Try demo → dashboard → trades → detail → notes textarea → settings → export button visibility. Single happy-path, resilient selectors (role-based where possible). `pnpm e2e` / `pnpm e2e:install` / `pnpm e2e:ui` scripts. `.gitignore` excludes `/playwright-report/` + `/test-results/`. Notes-autosave expectation dropped from the test since demo users are blocked server-side by `assertNotDemo`.

**Test state after Phase 8:** 223 unit tests passing / 5 skipped / 0 failing. Typecheck clean. E2E suite exists but requires `pnpm e2e:install` + `pnpm seed:demo` + a live Neon DB to run — not wired to CI yet.

**Key design decisions / gotchas**
- **Manual plan→position linking, not auto-matching.** Plans live independently of positions; users link them via the dropdown after a trade closes. Auto-matching (match by symbol + side + timing window) is judgment-heavy and false positives would be annoying. Deferred.
- **`ON DELETE SET NULL`** on `position.planId` — so when a user archives/deletes a plan, we preserve linked positions but sever the reference. Hard-delete a plan → positions survive.
- **R-multiple fallback chain**: `rMultiplePlanned` > `rMultiple` (1% approx) > `—`. The chip hint changes to communicate which is being shown. Both are exposed in the bundle so UI can decide.
- **Entry/exit slip color semantics are side-sensitive**: for a long, cheaper-than-planned entry is favorable (green); for a short, richer entry is favorable. Two small helpers encapsulate this.
- **plan_adherence detector ONLY runs on linked + closed positions.** Open positions are excluded (no exit price to evaluate). Positions with no plan are ignored — the existing "no-plan-trades" detector handles that separately.
- **DERIVATION_VERSION = 3** captures both the `planId` field addition AND the new detector. Users must `pnpm rederive` — documented in the commit body. Rerun is idempotent (delete-then-insert scoped to `(userId, version)`).
- **Detector context extended**: `planMap: Map<string, TradePlanRow>` pre-fetched by the runner per derivation run. Alternative (per-position lookups) would multiply DB queries; the Map is a single query.
- **Playwright webServer** reuses the existing `pnpm dev` if already running (local iteration friendly); starts fresh in CI.
- **Playwright test is non-destructive** to demo state — it fills a note textarea but demo blocks the save, so the test just verifies the textarea accepts input and moves on. Settings export button is checked for visibility only (doesn't actually download in the test).

**Deferred from Phase 8**
- **Auto plan→position matching** — Phase 9+ (needs a scoring rubric).
- **Plan templates** (save a reusable plan shape, e.g. "breakout with 1.5R target") — out of MVP.
- **Plan reminders** — "you haven't entered BTC yet; plan expires" via email. Requires per-plan expiry.
- **Market-data candles** on fills timeline — Phase 9+ (needs market-data provider).
- **Custom user-defined detectors (DSL)** — Phase 9 or Phase 10 — very complex.
- **E2E CI wiring** — GitHub Actions workflow to run `pnpm e2e` on PR; own small task.
- **Mobile plans UI** — desktop-first remains.
- **Plan snapshots** — if user edits a plan after linking, the metric chips use the *current* plan (may not reflect the plan at link time). Fix by snapshotting plan values onto position at link-time.
- **Partial-fill exit-slip accuracy** — `rMultiplePlanned` uses final `realizedPnl` over planned risk; multi-exit fills may not line up with the plan's target. Good enough for v1.

---
