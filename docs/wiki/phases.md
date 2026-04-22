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

## Phase 3 — Dashboard & Trade Views · **In progress** (plan drafted, execution pending)

**Plan:** `docs/superpowers/plans/2026-04-23-phase-3-dashboard.md`

**Scope** (per spec §11 Phase 3 + §9)
- `/app/dashboard` — controls row (URL-persisted filters), 5 KPI tiles with sparkline, full-width equity curve, time-of-day hour strip, top-winner/loser asset bars, active-findings sidebar, stats footer
- `/app/trades` — sticky filter bar (search + instrument + side + PnL), dense table with keyboard nav (`j/k/enter/x/slash`), bulk-tag dialog
- `/app/trades/:positionId` — header + fills-timeline scatter + metric chips + Notes (markdown autosave) / Tags (setup + mistake + confidence + emotion) / Findings / Coach stub tabs
- Journal layer — `trade_note`, `setup_tag`, `mistake_tag`, `position_tag`, `position_reflection` tables + 8 seeded starter mistake tags
- Global shell polish — `<TopBar />`, derivation `<VersionBadge />`, focus-visible ring
- Loading skeletons + contextual empty/error states across all three routes

**Progress log** (to fill as tasks complete)
- [ ] Task 0 — install recharts + markdown + shadcn UI components (12 new ui files)
- [ ] Task 1 — journal DB schema + migration (5 tables, 2 enums, `drizzle/0003_*.sql`)
- [ ] Task 2 — journal + dashboard domain types
- [ ] Task 3 — default mistake-tag seeder wired to Better Auth sign-in (with fallback to lazy seed)
- [ ] Task 4 — `getDashboardBundle` server fn + URL filter parse/serialize helpers
- [ ] Task 5 — `getTradeList` server fn with filters + pagination
- [ ] Task 6 — `getTradeDetail` server fn (position + fills + findings + journal)
- [ ] Task 7 — journal mutation server fns (notes, tags, reflections, custom tags)
- [ ] Task 8 — global shell: `<TopBar />`, `<VersionBadge />`, brand tailwind tokens
- [ ] Task 9 — dashboard scaffold + controls row + URL-persisted filters
- [ ] Task 10 — 5 KPI tiles with sparklines (+ `formatters.ts`)
- [ ] Task 11 — full-width equity curve area chart
- [ ] Task 12 — time-of-day expectancy strip (hour-only for v1; day-of-week deferred)
- [ ] Task 13 — top-winners/losers asset bar chart + active-findings sidebar
- [ ] Task 14 — trade list page (filter bar + dense table)
- [ ] Task 15 — keyboard nav (`j/k/enter/x/slash`) + bulk-tag dialog
- [ ] Task 16 — trade detail: header + metric chips + fills timeline + tab scaffolding
- [ ] Task 17 — Notes tab (textarea + autosave + markdown preview with rehype-sanitize)
- [ ] Task 18 — Tags tab (setup/mistake pickers, confidence, emotional state, tag creation)
- [ ] Task 19 — Findings tab
- [ ] Task 20 — loading skeletons + empty states + focus-visible ring

**Key design decisions recorded up-front** (may evolve)
- Presentation reads *only* derived rows — every dashboard/trade query hits `summary_rollup`, `daily_metric`, `asset_metric`, `session_metric`, `finding`, `position`, `position_fill`. Never recomputes.
- Dashboard filters live in the URL via TanStack Router typed search params (`useDashboardFilters` hook). `timeRange` actually filters the daily slice; `symbols` / `instrument` / `setupTagIds` are UI-only for this phase (wiring them into the aggregate queries requires a per-filter rollup table — parked for Phase 6).
- Heatmap is hour-only this phase. Day-of-week axis needs a new `day_of_week_metric` derived table — documented as deferred.
- Notes tab uses plain `<textarea>` + `react-markdown` + `rehype-sanitize`. No WYSIWYG. Autosave debounced at 1.2s via `useAutosave`.
- Mutation handlers use TanStack Query `invalidateQueries` (not optimistic patching) for now — simpler, still feels responsive.
- Coach tab is a stub — `<CoachTabStub />` describes what Phase 4 will plug in.
- `<VersionBadge />` shows `v{DERIVATION_VERSION}` in the top bar so every screenshot is timestamped with the analysis engine version.
- Tailwind tokens added: `brand: #ea580c`, `pnl-win: #16a34a`, `pnl-loss: #dc2626`, `gridTemplateColumns['24']` for the heatmap strip.

**Deferred from Phase 3**
- To be filled at phase close. Anticipated: day-of-week heatmap axis, dashboard-level symbol/setup filters, export button, rich markdown editor.

---
