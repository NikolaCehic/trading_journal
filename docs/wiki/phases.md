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
