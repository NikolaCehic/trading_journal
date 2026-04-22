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

## Phase 2 — Derivation engine · **In progress** (plan drafted, execution underway)

**Plan:** `docs/superpowers/plans/2026-04-22-phase-2-derivation.md`

**Scope** (per spec §11 Phase 2)
- Position merging with golden fixtures
- Metrics tables (daily / asset / session / summary)
- All 11 deterministic detectors with unit + golden-fixture tests
- `derivation_version` infrastructure + admin `rederive` CLI
- Inngest handler on `ingestion/complete`

**Progress log** (to be filled as tasks complete)
- [ ] Task 0 — version + detector interface scaffolds
- [ ] Task 1 — derivation DB schema (7 tables, 3 enums, 1 migration)
- [ ] Task 2 — Position + Finding domain types + 11 evidence schemas
- [ ] Task 3 — fixture loader + `steady-discipline.csv`
- [ ] Task 4 — position merger (perp + spot + side-flip, TDD)
- [ ] Task 5 — metrics (daily / asset / session / summary) + shared stats helpers
- [ ] Task 6 — detector `revenge_trading`
- [ ] Task 7 — detector `oversized_positions`
- [ ] Task 8 — detector `loss_of_discipline_windows`
- [ ] Task 9 — detector `position_sizing_instability`
- [ ] Task 10 — detector `cut_winners_ride_losers`
- [ ] Task 11 — detector `overtrading_after_losses`
- [ ] Task 12 — detector `fee_drag`
- [ ] Task 13 — detector `scaling_into_losers`
- [ ] Task 14 — detector `short_hold_scalping`
- [ ] Task 15 — detector `symbol_underperformance`
- [ ] Task 16 — detector `leverage_creep`
- [ ] Task 17 — detector registry + runner + persist
- [ ] Task 18 — Inngest `derive-on-ingestion-complete` + `rederive`
- [ ] Task 19 — admin `rederive` CLI
- [ ] Task 20 — golden-fixture integration matrix (all 12 personas)

**Key design choices recorded up-front** (may evolve)
- `DERIVATION_VERSION` is a single constant in `src/derivation/version.ts` — bumped only when detector/merger/metric logic changes observably.
- `Position.maxNotionalUsd` is used as a **proxy** for leverage in `leverage_creep`. HL CSV does not expose account margin, so explicit leverage is not available. When wallet-API data is richer (future work), the detector can tighten without changing its interface.
- Spot position merging uses FIFO lots; perps use HL `dir` hints when present and infer from `side + netSize` otherwise.
- Every detector emits typed `evidence` JSONB matching a Zod/TS schema in `src/domain/finding.ts`. This is the input bundle Claude will eventually consume in Phase 4.
- `persistDerivation` is delete-then-insert scoped to `(userId, derivationVersion)` — re-running at the same version is idempotent.
- Fixtures are stored as HL CSV so they exercise the same ingestion pipeline as production imports.

**Deferred from Phase 2**
- Filled in at phase close.
