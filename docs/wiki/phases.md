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
