# AI Trade Journal — Design Spec

**Date:** 2026-04-20
**Status:** Design approved; ready for implementation planning
**Codename:** Post (working title)
**Source PRD:** `01-ai-trade-journal-post-trade-coach.md`

---

## 1. Overview

An AI-powered trading journal for crypto perps and spot traders. Imports trades from Binance (CSV) and Hyperliquid (CSV or wallet address), normalizes them into canonical fills and positions, runs 11 deterministic behavioral detectors, and uses Claude to narrate findings with verifiable citations to the user's own trades.

**Primary purpose:** flagship portfolio / interview piece for senior full-stack (frontend-heavy) roles. Two delivery targets: a polished live demo URL and a written case-study.

**Primary audience:** recruiters, hiring managers, and senior engineers evaluating the repo and demo as part of an interview process.

---

## 2. Scope

### 2.1 In scope (v1)

- Google OAuth auth (Better Auth) + one-click demo session
- CSV import: Binance Spot + Binance USDⓈ-M Futures
- CSV import: Hyperliquid
- Wallet-address pull: Hyperliquid via public info API
- Canonical fills table (immutable, append-only)
- Position merging (spot FIFO + perps cumulative-size)
- Metrics engine: daily / asset / session / summary
- 11 deterministic behavioral detectors (Section 7.3)
- Versioned derivations (`derivation_version` on every derived row)
- Weekly AI digest (Claude narrator, structured output, 4-pass guardrails)
- On-demand per-trade AI post-mortem
- Journal layer: notes, setup tags, mistake tags, confidence, emotional state
- Dashboard with URL-persisted filters, KPIs, equity curve, heatmap, asset breakdown, findings sidebar
- Trade list + trade detail pages
- Demo account (seeded "Alex" persona, 9 months of data)
- Landing page
- Case-study write-up in `/docs/case-study.md`
- Dark-mode UI only (no light mode)
- Warm-orange brand accent (`#ea580c`)

### 2.2 Out of scope (v1)

Deliberately deferred to v2 or separate portfolio projects:

- Exchange API integrations (Binance API, etc.) — v2
- Chat-based coach ("ask about your trades") — v2
- Multi-chain wallet intelligence — separate portfolio project (PRD #2)
- Real-time order-book terminal — separate portfolio project (PRD #3)
- Additional detectors: weekend/overnight, drawdown spiral, consecutive-loss tilt — v2
- Email delivery of weekly digest
- Mobile-optimized views (responsive only, not polished)
- Trade sharing / community features
- Eager per-trade post-mortems (only on-demand)
- Billing, teams, multi-user collaboration
- Full tax / accounting output
- Mark-to-market on open spot positions

---

## 3. Target users and primary flows

### 3.1 Visitor / recruiter flow (primary demo path)

1. Lands on `/`.
2. Reads one-sentence pitch + sees a looping dashboard clip.
3. Clicks "Try the demo."
4. Server function `createDemoSession()` signs them in as the seeded demo user.
5. Lands on `/app/dashboard` — fully populated dashboard visible immediately.
6. Explores trades, findings, weekly digest.
7. No signup, no OAuth roundtrip, no empty states.

### 3.2 Power-user flow

1. Signs in with Google OAuth via Better Auth.
2. Navigates to `/app/import`.
3. Uploads Binance CSV and/or pastes Hyperliquid wallet address.
4. Watches live progress as fills are ingested and derivation runs.
5. Explores their own dashboard, annotates trades, reads their weekly digest.

### 3.3 Demo isolation

- Demo user has `is_demo = true`.
- Demo user is allowed writes (notes, tags) to preserve interactivity.
- A daily Inngest cron (`demo.reseed`, 03:00 UTC) resets the demo user's journal annotations and regenerates the canonical demo snapshot.

---

## 4. Architecture

### 4.1 Three hard domain boundaries

The system has exactly three domains:

1. **Ingestion** — source adapters write immutable canonical fills.
2. **Derivation** — produces versioned metrics, positions, and detector findings from fills.
3. **Presentation** — reads only derived rows; never recomputes at query time.

**Architectural one-liner:** *Ingestion writes immutable fills. Derivation produces versioned metrics and findings from those fills. Presentation reads only derived rows — it never recomputes.*

### 4.2 Pipeline

```
 [Binance CSV]         [HL CSV]        [HL wallet address]
      │                   │                    │
      ▼                   ▼                    ▼
 ┌─────────────────────────────────────────────────────┐
 │                   Ingestion                          │
 │   (source adapter → canonical Fill[] → persist)      │
 └─────────────────────────────────────────────────────┘
                          │
                          ▼
                  ┌──────────────┐
                  │ fills (immut.│
                  │  canonical)  │
                  └──────────────┘
                          │
                          ▼   (triggered on ingestion.complete OR version bump)
 ┌─────────────────────────────────────────────────────┐
 │                  Derivation                          │
 │                                                      │
 │  fills  →  positions  →  metrics  →  detectors       │
 │                                      │               │
 │                                      ▼               │
 │                           detector findings          │
 │                    (stored, keyed by                 │
 │                     derivation_version)              │
 └─────────────────────────────────────────────────────┘
                          │
                          ▼
 ┌─────────────────────────────────────────────────────┐
 │                  Presentation                        │
 │                                                      │
 │  Dashboard      Trade detail    Weekly digest        │
 │  (reads         (reads fills +  (Claude narrates     │
 │   metrics)       findings)       findings; writes    │
 │                                  digest snapshot)    │
 └─────────────────────────────────────────────────────┘
```

### 4.3 `derivation_version` rule

Every derived row (positions, metrics, findings, digests, post-mortems) carries a `derivation_version` integer. When a detector changes or a new one is added, the version bumps. An admin command (`rederive --version=N`) regenerates all derived rows at the current version for all affected users.

**Benefits:**
- Reproducibility — every digest and screenshot can be pinned to a specific analysis version.
- Safe iteration — changing detector logic doesn't corrupt historical digests.
- Clean write-up artifact — version history of the analysis engine is a visible concept.

### 4.4 Where work runs

| Job | Where | Rationale |
|---|---|---|
| CSV upload + parse + persist fills | TanStack Start server function, streamed progress | Bounded size; live progress UX |
| Hyperliquid wallet pull | Inngest function | Long-running, paginated, rate-limited |
| Derivation (positions → metrics → detectors) | Inngest function, triggered on `ingestion.complete` | Keeps imports snappy; supports version bumps |
| Weekly digest (Claude call) | Inngest function, cron + event-driven | Not user-latency-sensitive |
| Per-trade post-mortem (Claude call) | Server function (on demand from Coach tab) | Interactive; cached by `(position_id, derivation_version)` |
| Dashboard and trade-list reads | Server functions, synchronous | Pure SELECTs against derived tables |

### 4.5 Claude's role — exactly three call-sites

Claude is invoked in exactly three places and nowhere else:

1. **Weekly digest narrator.** Input: structured JSON bundle of findings + summary metrics for a week. Output: structured narration with per-finding text + cited position IDs. Cached per `(user_id, week, derivation_version)`.
2. **Per-trade post-mortem.** Input: single position + its fills + related findings + user percentiles. Output: short markdown critique + cited finding IDs. Cached per `(position_id, derivation_version)`.
3. **Nowhere else.** No chat. No inline analysis. No raw-trade dumps into prompts.

Claude *narrates*. Deterministic code *reasons*.

---

## 5. Data model

Schema organized by domain. All tables live in a single Neon Postgres database, accessed via Drizzle ORM.

### 5.1 Identity

| Table | Purpose |
|---|---|
| `User` | id, email, name, image, `is_demo` bool, `created_at` |
| `Session` | Better Auth session storage |

### 5.2 Ingestion

| Table | Purpose |
|---|---|
| `ExchangeAccount` | User's connected source. One per `(user × exchange × optional wallet address)`. |
| `Import` | Single import attempt. Status: `pending → parsing → normalizing → deriving → complete \| failed`. Carries file metadata, row counts, errors. |
| `RawImportRow` | Raw source row as-received, stored as JSONB. Never deleted. Tracks `normalize_status` (`normalized \| skipped \| errored`). |

### 5.3 Canonical layer (immutable)

| Table | Purpose |
|---|---|
| `Fill` | Single execution. `(user_id, exchange, symbol, instrument_type: spot\|perp, side: buy\|sell, price, size, fee, fee_currency, executed_at, external_id, raw_import_row_id, normalizer_hint JSONB)`. Unique on `(user_id, exchange, external_id)` for idempotent re-imports. Append-only. No `derivation_version` (source of truth). |

### 5.4 Derivation layer (versioned)

Every row carries `derivation_version`.

| Table | Purpose |
|---|---|
| `Position` | Logical trade. Merged from fills. Fields: entry/exit avg prices, size, realized PnL, fees, funding PnL (perps), max leverage, `was_liquidated`, open/close timestamps. |
| `PositionFill` | Join of fills to positions with `role` (`open \| add \| reduce \| close`). |
| `DailyMetric` | Per `(user_id, date)`: trade count, realized PnL, volume, win/loss split. |
| `AssetMetric` | Per `(user_id, symbol)`: trade count, realized PnL, win rate, avg win/loss, expectancy. |
| `SessionMetric` | Per `(user_id, hour_of_day_utc)`: trade count, realized PnL, win rate. |
| `SummaryRollup` | Per `user`, one row: total PnL, win rate, expectancy, avg win, avg loss, profit factor, max drawdown, trade count, median position size. |
| `Finding` | Single detector firing. `detector_id`, `severity`, `period_start/end`, `title`, `body_markdown`, `evidence` JSONB (typed per detector), `referenced_position_ids` array. |

### 5.5 Journal layer (user-generated, not derived)

| Table | Purpose |
|---|---|
| `TradeNote` | Free-form markdown attached to a `Position`. |
| `SetupTag` | User-defined setup labels. User-scoped. |
| `MistakeTag` | User-defined mistake labels. Seeded with ~8 starters on signup. |
| `PositionTag` | M:N join of positions to setup/mistake tags. |
| `PositionReflection` | Optional: confidence (1–5), emotional state (`calm \| fomo \| revenge \| bored \| anxious \| confident`), post-trade reflection text. |

### 5.6 AI output layer

| Table | Purpose |
|---|---|
| `WeeklyDigest` | Unique `(user_id, week_start, derivation_version)`. Stores Claude's narration, cited finding/position IDs, model name, token counts. Immutable once written. |
| `TradePostMortem` | Unique `(user_id, position_id, derivation_version)`. Same discipline at the trade level. |

### 5.7 Design choices worth calling out

- **Raw rows kept forever.** Storage is cheap; retroactive re-normalization is priceless.
- **Position merging is the hardest problem.** Section 7.1 defines the rule; a golden-fixture test suite pins it.
- **`Finding.evidence` is typed JSONB.** Each detector has a Zod/TS schema for its evidence shape. This is what Claude consumes.
- **AI outputs are artifacts, not live.** Cached by derivation version; version bumps create new rows, preserving history.
- **Using `Position` not `Trade`.** Some crypto CSVs use "trades" to mean "fills"; `Position` is unambiguous.

---

## 6. Ingestion

Three source adapters share one pipeline. Each implements:

```ts
interface SourceAdapter<Input> {
  kind: 'binance-csv' | 'hyperliquid-csv' | 'hyperliquid-wallet'
  validate(input: Input): Promise<ValidationReport>
  parse(input: Input, importId: string): AsyncGenerator<RawRow>
  normalize(raw: RawRow): Fill | null
}
```

Orchestrator responsibilities:
- Persist raw rows to `RawImportRow`.
- De-dupe fills by `(user_id, exchange, external_id)`.
- Progress the `Import.status` state machine.
- Emit `ingestion.complete` on success.

### 6.1 Binance CSV

- **Supported variants:** Spot Trade History, USDⓈ-M Futures Trade History. Exactly these two.
- **Variant detection:** CSV header fingerprinting. Unknown fingerprints are refused with a clear error.
- **External ID:** Binance spot CSV has no stable trade ID. Synthesized as `hash(timestamp_ms + symbol + side + price + quantity)` for determinism.
- **Validation report example:** *"Detected: Binance Spot Trade History. 847 rows spanning 2024-10-03 → 2025-04-15. Will import as 847 fills across 12 symbols."*
- User confirms before any persistence.

### 6.2 Hyperliquid CSV

- **Supported:** user-portfolio trade export (one format, stable columns).
- **External ID:** HL's `tid` field.
- **`dir` field hint:** `Open Long`, `Close Short`, `Liquidation`, etc. Captured as `normalizer_hint` on the fill; used by position merging.

### 6.3 Hyperliquid wallet pull

- **Mechanism:** user pastes wallet address. Server calls `POST https://api.hyperliquid.xyz/info` with `{"type": "userFills", "user": "0x..."}`.
- **No API keys, no signatures, no wallet connection.** Public on-chain data, server-side fetch.
- **Ownership disclaimer:** *"Importing by wallet address pulls public on-chain fills. We don't verify ownership — only import addresses you control or want to analyze."* Shown clearly in the import UI.
- **Execution:** Inngest function. Paginated via `startTime` cursor. Respects HL's 1200 weight-points/minute rate limit (our calls cost ~20, so ~60 calls/minute ceiling).
- **Progress events:** per-page update of `Import.fill_count`; UI polls for live count.
- **Rate-limit handling:** exponential backoff with jitter; surface in import status without failing the import.

### 6.4 Common concerns

- **Idempotency:** re-running any import on the same data produces zero new fills. Enforced by the unique constraint; tested explicitly.
- **Row-level error tolerance:** a bad row logs a reason and is skipped; the import continues. Surfaced in the summary: *"847 imported, 3 skipped (2 malformed timestamps, 1 unknown symbol)."*
- **Whole-import failure:** corrupt files, unknown formats, or API errors abort before any fills are written. Clear error shown to user.
- **Raw rows always kept,** including skipped ones, with `normalize_status` on each.
- **`ingestion.complete` event** fires regardless of source, carrying `{import_id, user_id, new_fill_count}`. Derivation subscribes to exactly this event.

---

## 7. Derivation: merging, metrics, detectors

### 7.1 Position merging rule

A **position** is a run of fills on one symbol where net holding goes from zero to non-zero and back to zero.

- Adds increase size mid-position; reduces decrease it; close zeroes it out.
- A side-flip (fully closing and opening the opposite side) is two positions.
- **Perps:** validated against Hyperliquid's `dir` hint when available. Binance perps relies on cumulative size.
- **Spot:** FIFO lots. A position opens on first buy; closes when cumulative sold size matches opened size. Still-open spot positions are tracked but marked realized-only (no mark-to-market in v1).
- **Symbol scope:** merging is symbol-scoped; nothing cross-asset.
- **Deterministic and versioned.** Pure function, unit-tested; its version contributes to `derivation_version`.

If merging is ambiguous for a trade, the row is flagged `needs_review` rather than guessed.

### 7.2 Metrics

All pure functions of fills + positions. No external data.

| Table | Granularity | Consumer |
|---|---|---|
| `DailyMetric` | per `(user, date)` | equity curve, daily PnL |
| `AssetMetric` | per `(user, symbol)` | best/worst asset cards |
| `SessionMetric` | per `(user, hour_of_day_utc)` | time-of-day heatmap |
| `SummaryRollup` | per `user` | top-of-dashboard KPIs |

### 7.3 The 11 detectors

Each detector is a typed module with `id`, `description`, `evidence_schema`, `run(ctx) → Finding[]`. All deterministic, all unit-tested with golden fixtures.

**Thresholds are configurable constants per detector**, defined at the top of each detector file and subject to tuning against real data. The values below are starting defaults — the derivation engine records them in each finding's evidence so outputs remain interpretable across tuning.

1. **`revenge_trading`** — opens a new position within **≤15 minutes** of a losing close *and* sized **>1.5× median**.
2. **`oversized_positions`** — **top 10% by size** have loss rate **≥1.5×** the user's baseline loss rate, across **≥15** positions in the bucket.
3. **`loss_of_discipline_windows`** — hour-of-day buckets with **≥10 trades** and expectancy **≥1.0σ below** the user's overall mean.
4. **`position_sizing_instability`** — rolling-30-day size variance **≥1.5×** the prior-30-day variance.
5. **`cut_winners_ride_losers`** — avg losing duration **≥1.5×** avg winning duration, *and* avg win < avg loss.
6. **`overtrading_after_losses`** — daily trade count on days-after-loss **≥1.4×** daily trade count on days-after-win, across **≥10** days in each cohort.
7. **`fee_drag`** — total fees **≥25%** of gross PnL (or fees cause a flip from gross-profit to net-loss).
8. **`scaling_into_losers`** — add-role fills on underwater positions are **≥2×** the rate of add-role fills on in-profit positions.
9. **`short_hold_scalping`** — positions held **<5 minutes** have expectancy **≥0.8σ below** positions held ≥5 minutes, across **≥20** short-hold samples.
10. **`symbol_underperformance`** — symbols with **≥10 trades** and expectancy **≥1.0σ below** user's overall.
11. **`leverage_creep`** *(perps-only)* — last-30-day max-leverage average **≥1.3×** prior-30-day average, across **≥10** leveraged positions in each window.

### 7.4 Finding evidence is strongly typed

Example (`revenge_trading`):

```ts
type RevengeTradingEvidence = {
  threshold_minutes: number
  threshold_size_multiplier: number
  median_size_usd: number
  instances: Array<{
    position_id: string
    prior_position_id: string
    minutes_between: number
    prior_realized_pnl_usd: number
    size_multiplier_vs_median: number
  }>
}
```

Each detector has its own schema. Claude consumes this structure; no raw fill dumps.

### 7.5 Execution lifecycle

Triggered by `ingestion.complete`:

1. Worker builds positions from new fills via the merger.
2. Computes `DailyMetric`, `AssetMetric`, `SessionMetric`, `SummaryRollup`.
3. Runs each detector sequentially against the fresh context.
4. Persists findings at current `derivation_version`.
5. Emits `derivation.complete` event — consumed by the weekly-digest scheduler.

Also triggered by admin `rederive --version=N` for version bumps.

### 7.6 Testing — golden fixtures

Checked-in CSV fixtures under `/fixtures/`, each representing a persona whose pathology is known. **Every detector has at least one positive fixture; one shared negative fixture (`steady-discipline.csv`) asserts no detector fires on clean trading.**

Full fixture list:

- `fixtures/steady-discipline.csv` → expect zero findings (shared negative case)
- `fixtures/revenge-trader.csv` → expect `revenge_trading`
- `fixtures/size-bloater.csv` → expect `oversized_positions`
- `fixtures/evening-tilt.csv` → expect `loss_of_discipline_windows`
- `fixtures/size-drift.csv` → expect `position_sizing_instability`
- `fixtures/winner-cutter.csv` → expect `cut_winners_ride_losers`
- `fixtures/loss-chaser.csv` → expect `overtrading_after_losses`
- `fixtures/fee-bleed.csv` → expect `fee_drag`
- `fixtures/pyramid-losers.csv` → expect `scaling_into_losers`
- `fixtures/scalp-gambler.csv` → expect `short_hold_scalping`
- `fixtures/bad-ticker.csv` → expect `symbol_underperformance`
- `fixtures/leverage-creep.csv` → expect `leverage_creep`

Each test: import fixture → run derivation → assert findings match expected. These fixtures are also reused as building blocks to assemble the demo account's seed data.

### 7.7 Module layout

```
src/derivation/
├── merge.ts
├── metrics/
│   ├── daily.ts
│   ├── asset.ts
│   ├── session.ts
│   └── summary.ts
├── detectors/
│   ├── revenge-trading.ts
│   ├── oversized-positions.ts
│   ├── loss-of-discipline-windows.ts
│   ├── position-sizing-instability.ts
│   ├── cut-winners-ride-losers.ts
│   ├── overtrading-after-losses.ts
│   ├── fee-drag.ts
│   ├── scaling-into-losers.ts
│   ├── short-hold-scalping.ts
│   ├── symbol-underperformance.ts
│   └── leverage-creep.ts
└── runner.ts
```

---

## 8. AI layer

### 8.1 Weekly digest

**Output shape (what the user sees on `/app/digest/:week`):**

1. **Header:** week date range + summary KPIs (PnL, trade count, win rate, expectancy, delta vs. prior week).
2. **Opener:** 3–4 sentences from Claude, grounded in the week's summary + top findings.
3. **Findings cards:** one per finding that fired. Each shows: detector name + severity badge, Claude's 2–4 sentence narration, clickable citations to specific positions, inline mini-chart if relevant.
4. **Reflection prompt:** one question Claude asks the user to think about before next week.
5. **Provenance footer:** *"Generated at derivation v4 · Claude Sonnet 4.6 · 2026-04-20."*

**Input bundle:**

```ts
type WeeklyDigestBundle = {
  week_start: string
  week_end: string
  summary: SummaryMetrics
  comparison_to_prior: Deltas
  findings: Finding[]
  findings_prior_week: FindingIdRef[]
}
```

**Output (via Anthropic tool-use structured output):**

```ts
type WeeklyDigestNarration = {
  opener: string
  narrations: Record<FindingId, string>
  reflection_prompt: string
  cited_position_ids: PositionId[]
  cited_finding_ids: FindingId[]
}
```

### 8.2 Per-trade post-mortem (on-demand)

**Trigger:** user clicks "Coach this trade" on `/app/trades/:id`.

**Input:**

```ts
type PostMortemBundle = {
  position: Position
  fills: Fill[]
  related_findings: Finding[]
  user_percentiles: {
    size_percentile: number
    duration_percentile: number
    leverage_percentile?: number
  }
  user_note?: string
}
```

**Output:** short markdown critique (≤ 600 chars) + cited finding IDs. Same guardrails as digest. Cached by `(position_id, derivation_version)`.

**Interesting moment:** post-mortems reference the cross-trade detector findings. Example:
> *"You opened [[pos_abc]] 4 minutes after closing [[pos_xyz]] at a -$218 loss, sized 1.9× your median — this is the `revenge_trading` pattern flagged for you in [[finding_rev_01]]. The pattern correlates with a 31% win rate across 7 prior instances."*

### 8.3 Citation rendering

Claude emits `[[pos_xxx]]` and `[[finding_yyy]]` tokens inline. Frontend renders them as clickable chips that deep-link to `/app/trades/pos_xxx` or the finding detail. Validation rejects any citation token referencing an ID not in the input bundle.

### 8.4 Guardrails — four validation passes

Run after every Claude response, before persistence:

1. **Schema check** — Zod validation on the structured output.
2. **Citation validity** — every `[[pos_xxx]]` / `[[finding_yyy]]` token resolves to an ID in the input bundle. Every `cited_finding_ids` entry matches a real finding.
3. **No-forecast filter** — regex rejection of predictive language (`will`, `going to`, `likely to`, `expect`, `should rally`, etc.).
4. **Length bounds** — narration per finding ≤ 400 chars; opener ≤ 800 chars; post-mortem ≤ 600 chars.

On failure: retry once with stricter system prompt. On second failure: surface a clear error to the user ("Digest failed to generate — retry"). **Never** silently serve invalid output.

### 8.5 Model choice and caching

- **Default:** Claude Sonnet 4.6 (model ID `claude-sonnet-4-6`).
- **Optional escalation:** Claude Opus 4.7 (model ID `claude-opus-4-7`) for weekly digest when prose quality matters; configurable via env.
- **Temperature:** 0.2 for narration.
- **Cache:** DB-backed rows in `WeeklyDigest` and `TradePostMortem`. Cache key includes `derivation_version` — version bumps invalidate naturally.

### 8.6 Evals harness

Checked-in under `/src/ai/evals/`. Run manually via `pnpm evals`.

- **Grounding eval:** every number in narration maps to a bundle field (regex on numeric tokens).
- **Citation coverage eval:** every finding in the bundle is mentioned or explicitly deprioritized.
- **Forecast-leakage eval:** regex from guardrails, run against held-out outputs.
- **Tone eval:** checklist — no shaming, no absolute certainty, no financial-advice phrasing.

Not in CI for v1 (API cost); present in the repo as portfolio artifact.

---

## 9. Frontend routes & UX

### 9.1 Global shell

- Top bar: wordmark, primary nav (Dashboard · Trades · Digest · Import · Settings), account menu, derivation-version indicator.
- Max-width content column ~1280px.
- **Typography:** Inter for UI, **JetBrains Mono for all numbers** (tabular figures mandatory).
- **Brand accent:** `#ea580c` (warm orange). Used for CTAs, active nav, highlights.
- **PnL colors:** muted green (`#16a34a` ~85% opacity), muted red (`#dc2626` ~85% opacity). Deliberately distinct from brand orange.
- **Neutrals:** warm grays (Tailwind `stone` / `neutral`).
- **Theme:** dark mode only.
- **Motion:** intentional only (KPI roll-ups, card transitions). Respects `prefers-reduced-motion`.

### 9.2 Route map

| Route | Purpose |
|---|---|
| `/` | Landing page (editorial-style marketing) |
| `/login` | Google OAuth entry |
| `/auth/callback` | OAuth callback |
| `/app` | Redirects to `/app/dashboard` |
| `/app/dashboard` | Headline analytics view |
| `/app/trades` | Trade list with filters |
| `/app/trades/:positionId` | Trade detail with Notes / Tags / Findings / Coach tabs |
| `/app/digest` | Weekly digest list |
| `/app/digest/:weekStart` | Specific week's digest |
| `/app/import` | CSV upload + HL wallet connect + import history |
| `/app/settings` | Account + demo indicator + data export/delete |

### 9.3 `/app/dashboard` layout

**Row 1 — Controls:** time-range pill selector (`7d / 30d / 90d / YTD / All / Custom`), asset multi-select chip UI, instrument-type toggle, setup-tag filter, export button. **All filter state persisted in URL search params via TanStack Router — shareable.**

**Row 2 — 5 KPI tiles (equal width):**
1. Realized PnL (with delta + 30-day sparkline)
2. Win rate
3. Expectancy (per trade, $)
4. Trade count
5. Max drawdown

Each tile: large headline number, label, delta vs. prior period, sparkline.

**Row 3 — Equity curve (full width):** cumulative PnL area chart with drawdown overlay shaded below zero. Hover reveals daily breakdown. Major peaks/troughs auto-labeled.

**Row 4 — Two-up secondary charts:**
- **Left:** Time-of-day heatmap (24-hour × 7-day-of-week grid, diverging green/red expectancy scale).
- **Right:** Asset PnL breakdown (horizontal bars, top 5 winners + top 5 losers; click-through to filtered trades).

**Right rail — Active findings sidebar:** top 3–5 current findings by severity. Each: detector chip, severity dot, one-sentence summary, click-through. "3 more →" link.

**Footer band:** *"Analyzing 847 fills across 312 positions · derivation v4 · last updated 2 hours ago."*

### 9.4 `/app/trades`

- Sticky filter bar: asset multi-select, date range, setup/mistake tags, PnL filter (winners/losers/all), size percentile slider, search.
- Dense table columns: exchange icon, symbol + instrument badge (SPOT/PERP), side, entry avg, exit avg, size ($), held duration, realized PnL ($ + %), fees, tag chips, note indicator.
- Right-aligned numerics, tabular digits.
- Keyboard nav: `j/k` move, `enter` open, `/` focus search.
- Bulk-tag: select rows → apply setup/mistake tag.

### 9.5 `/app/trades/:positionId`

- **Header:** symbol + instrument badge, side, final PnL (large, colored), size, held duration, leverage (perps).
- **Fills timeline:** price-at-fill dots connected across time, role badges (open/add/reduce/close), fee annotations. (Not a market chart — just the fills' own price path. Honest to what we have.)
- **Metric chips row:** entry avg, exit avg, max MAE, fees, funding (perps), realized PnL.
- **Tabs (in order):** Notes · Tags · Findings · Coach.
  - Notes: markdown editor, auto-save.
  - Tags: setup + mistake pickers, confidence 1–5, emotional-state dropdown.
  - Findings: any findings referencing this position, with their narrations.
  - Coach: "Coach this trade" button → loads post-mortem → renders with cited chips. Cached by `(position_id, derivation_version)`.

### 9.6 `/app/digest` and `/app/digest/:weekStart`

- **List:** one card per generated week. Shows date range, PnL for the week, top-severity finding count, teaser from opener.
- **Detail:** full digest as specified in Section 8.1, with provenance footer.

### 9.7 `/app/import`

- Three source cards side-by-side: Binance CSV, Hyperliquid CSV, Hyperliquid wallet address.
- CSV flow: drop zone → validation modal → confirm → progress → done.
- HL wallet flow: address input → format validation → Start import → live progress bar polling `Import` row.
- Import history table below: status chip, source, date, fill count, duration. Failed imports expandable to see errors.

### 9.8 `/` landing page (editorial register)

Single-column, calm, not dashboard-style.

1. Hero: one-sentence pitch, two CTAs (**Try the demo** primary, **Sign in with Google** secondary).
2. Looping dashboard screencap (autoplay, muted).
3. Three-up value props.
4. "How it works" 3-step strip (Import → Analyze → Read the digest).
5. "What the AI actually does" panel — pattern-detection + Claude-as-narrator explanation.
6. FAQ: "Is my data safe?", "Which exchanges?", "Do I need to trust the AI?", "Is this free?".
7. Footer: GitHub link, case-study link, tech-stack badges.

### 9.9 State, data fetching, routing

- **TanStack Router** for all routes with typed search params. Dashboard state is URL-shareable.
- **TanStack Query** for reads, `staleTime` tuned per route (dashboard 30s, trade list 60s, trade detail 5min, digest effectively forever).
- **`createServerFn`** for mutations and AI triggers. Progress-streamed for imports.
- **Optimistic updates** on tag/note edits; rollback on failure.

### 9.10 Empty / loading / error states

- **Loading:** skeleton shimmers matching final layout. Never centered spinners.
- **Empty:** real illustrations + actionable copy with inline CTAs.
- **Error:** contextual, specific recovery steps, expandable technical detail.

### 9.11 Accessibility

- Keyboard nav throughout, `/`, `?`, `j/k` shortcuts.
- Contrast AAA for numeric text.
- Screen-reader chart summaries generated from the metric bundle.
- Focus ring discipline.
- `prefers-reduced-motion` honored.

### 9.12 Mobile

Desktop-first, mobile-responsive but not mobile-optimized. Dashboard collapses to single column; trade list becomes cards; charts resize.

---

## 10. Infrastructure & deployment

### 10.1 Final stack

| Layer | Choice |
|---|---|
| Frontend framework | TanStack Start |
| Hosting | Cloudflare Pages (frontend + Pages Functions on Workers) |
| Runtime | Cloudflare Workers |
| Database | Neon Postgres |
| DB driver | `@neondatabase/serverless` (HTTP/WebSocket, Workers-compatible) |
| ORM | Drizzle ORM |
| Background jobs / events / crons | Inngest (`inngest/cloudflare` adapter) |
| File storage | Cloudflare R2 (S3-compatible, no egress fees) |
| Auth | Better Auth + Google OAuth |
| LLM | Anthropic SDK direct (Claude Sonnet 4.6 default, Opus 4.7 optional) |
| Error tracking | Sentry (Workers SDK) |
| Env validation | `@t3-oss/env-core` |
| UI components | shadcn/ui + Tailwind CSS |
| Charts | Recharts |

### 10.2 Inngest events and crons

| Event / Cron | Trigger | Handler |
|---|---|---|
| `ingestion.complete` | Orchestrator on import success | Derivation runner |
| `derivation.complete` | Derivation runner on finish | Weekly digest scheduler (if week boundary) |
| `digest.weekly` (cron) | Sundays 00:00 UTC | Regenerate digests for users with new findings |
| `demo.reseed` (cron) | Daily 03:00 UTC | Reset demo user's journal layer and regenerate canonical snapshot |
| HL wallet pull job | `createDemoSession` / user action | Paginated HL API fetch with backoff |

### 10.3 Required environment variables

All read via `@t3-oss/env-core`; fails at boot if missing.

- `DATABASE_URL`, `DIRECT_URL`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
- `ANTHROPIC_API_KEY`
- `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ACCOUNT_ID`
- `SENTRY_DSN`

### 10.4 CI/CD

- **GitHub Actions** on PR: typecheck (`tsc --noEmit`), ESLint, Drizzle migration validation, Vitest unit tests, detector golden-fixture tests.
- **Cloudflare Pages** deploys: automatic preview on PR, production on merge to `main`.
- Branch protection on `main` requires GitHub checks to pass.

### 10.5 Security posture

- OAuth state + nonce via Better Auth.
- CSRF via SameSite cookies + Origin header check on server functions.
- Rate limits on expensive endpoints (post-mortem: 1 call / position / minute / user via Inngest concurrency keys).
- **Zod validation** at every server-function boundary.
- Raw CSV uploads stored privately in R2 (signed URLs only).
- Markdown rendered via `react-markdown` + `rehype-sanitize` (hardened allowlist).
- No secrets in client bundle (`@t3-oss/env-core` enforces server/client split).
- Google OAuth scopes: `email` and `profile` only.

### 10.6 Cost ceiling (portfolio scale)

| Service | Expected monthly cost |
|---|---|
| Cloudflare Pages / Workers | $0 (free tier) |
| Cloudflare R2 | $0 (free tier; no egress fees) |
| Neon Postgres | $0 (free tier) |
| Inngest | $0 (free tier) |
| Sentry | $0 (free tier) |
| Anthropic | $5–20 (digest caching keeps volume low) |
| **Total** | **$5–20/month** |

### 10.7 Repo structure

```
/app
  /routes                       TanStack Start file-based routes
    __root.tsx
    (public)/
      index.tsx                 landing
      login.tsx
    (app)/
      _layout.tsx               app shell
      dashboard.tsx
      trades/
        index.tsx
        $positionId.tsx
      digest/
        index.tsx
        $weekStart.tsx
      import.tsx
      settings.tsx
/src
  /domain                       pure types: Fill, Position, Finding, etc.
  /ingestion
    adapters/
      binance-csv.ts
      hyperliquid-csv.ts
      hyperliquid-wallet.ts
    orchestrator.ts
  /derivation
    merge.ts
    metrics/
    detectors/                  11 files, one per detector
    runner.ts
  /ai
    narrator.ts                 weekly digest prompt + call
    postmortem.ts
    guardrails.ts               four validation passes
    evals/                      checked-in eval harness
  /auth                         Better Auth config
  /db                           Drizzle schema + client + migrations
  /jobs                         Inngest functions
  /lib
    log.ts
    env.ts                      @t3-oss/env-core config
/drizzle                        Drizzle-kit migrations
/fixtures                       golden CSV fixtures (also demo data source)
/tests
  unit/
  integration/
/docs
  /superpowers/specs/           this spec
  case-study.md                 portfolio write-up
```

---

## 11. Delivery phases

Cadence assumes ~25–30 hours/week part-time. Each phase ends in a deployable, demoable state.

### Phase 0 — Foundation (~1 week)
- Repo scaffolded: TanStack Start + Tailwind + shadcn + Drizzle + Neon + Better Auth + Inngest local + typed env + Sentry + GitHub Actions.
- Deployed to Cloudflare Pages at a custom subdomain.
- Google OAuth working + "Try demo" stub.
- **Ships:** deployed URL with auth; infra is real.

### Phase 1 — Ingestion & canonical data (~2–3 weeks)
- Three source adapters behind the shared interface.
- Orchestrator persisting raw rows + deduped canonical fills.
- Inngest function for HL wallet pull.
- `/app/import` UI with validation previews, progress, and history.
- Per-adapter unit tests + integration test for idempotent re-import.
- **Ships:** import own Binance CSV and HL wallet address end-to-end.

### Phase 2 — Derivation engine (~2–3 weeks)
- Position merging with golden fixtures (critical test suite first).
- Metrics tables populated.
- All 11 detectors with fixture tests.
- `derivation_version` infrastructure + admin `rederive` command.
- Inngest handler on `ingestion.complete`.
- **Ships:** findings generated deterministically; engine complete (not yet visible).

### Phase 3 — Dashboard & trade views (~2–3 weeks)
- `/app/dashboard` with all rows, URL-persisted filters.
- `/app/trades` list with filters, keyboard nav, bulk-tag.
- `/app/trades/:id` detail with fills timeline, metric chips, Notes + Tags + Findings tabs.
- Empty / loading / error states.
- **Ships:** first screenshot-worthy milestone.

### Phase 4 — AI narrator (~1–2 weeks)
- Claude narrator for weekly digest via tool-use structured output.
- Four guardrail passes.
- Per-trade post-mortem + Coach tab.
- Citation rendering.
- `/app/digest` list + detail.
- `digest.weekly` cron.
- Eval harness under `/src/ai/evals/`.
- **Ships:** AI coach works end-to-end with verifiable citations.

### Phase 5 — Demo account & landing (~1 week)
- Seed script: rich 9-month synthetic trader "Alex" exhibiting ~6 of 11 pathologies, assembled from golden fixtures + hand-curated filler.
- `demo.reseed` daily cron.
- `/` landing page (all 7 sections per 9.8).
- **Ships:** recruiter-ready demo.

### Phase 6 — Polish & write-up (~1–2 weeks)
- Dark-mode polish pass across every screen.
- Micro-interactions (roll-ups, card transitions).
- A11y audit (keyboard nav, focus, reduced-motion, chart summaries).
- Perf pass: synthetic 10k-fill user; dashboard p95 < 500ms.
- Case-study write-up (`/docs/case-study.md`).
- Short Loom walkthrough linked from README.
- **Ships:** final artifact.

**Total:** ~8–10 weeks part-time. Fits the 1–2 month flagship budget.

---

## 12. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Position merging correctness | High | Golden-fixture tests first in Phase 2 before any metric. Spot + perps each have their own fixtures. Ambiguous rows flagged `needs_review`, not guessed. |
| Claude output quality drift | Medium | Four guardrail passes, citation validation, evals, low temperature, structured output via tool use. |
| Scope creep | High | Phases are gates. No starting Phase N+1 until N is deployed. Ideas go in `/docs/future-ideas.md`, not into current scope. |
| Demo data feels fake | Medium | Handcraft 20–30 key trades; scaffold the rest. Documented persona psychology. Review with a trader's eye before shipping. |
| Dashboard performance at scale | Low-Medium | Precomputed metrics by design + DB indexes. Phase 6 perf test against a synthetic 10k-fill user (< 500ms p95 budget). |
| Hyperliquid API changes or rate-limit issues | Low | Small, isolated adapter. Integration test. Rate-limit backoff built in. |
| Visual polish takes longer than expected | Medium | shadcn as base, minimal custom components, dark-only halves surface area. One intentional polish pass in Phase 6, not continuous polishing. |
| AI cost spikes from demo traffic | Low | Digest caching per-week-per-version. Post-mortems capped per-user-per-minute. Demo writes reset nightly. |

---

## 13. Deferred to v2 or separate projects

Deliberately named so the case-study write-up can reference them as considered and deferred:

- Exchange API integrations (Binance first, then others)
- Chat-based coach
- Email delivery of weekly digest
- Additional detectors: weekend/overnight risk, drawdown spiral, consecutive-loss tilt
- Mobile-optimized views
- Trade sharing / community features
- Eager per-trade post-mortems
- Multi-chain wallet intelligence (separate project, PRD #2)
- Real-time order-book terminal (separate project, PRD #3)

---

## 14. Write-up artifacts

Three linked artifacts in the README:

1. **Live demo URL** — "Try the demo" button → populated dashboard.
2. **Case study** (`/docs/case-study.md`) — architecture diagram, versioned-derivations story, AI guardrails story, 4–6 screenshots, lessons.
3. **Repo** — organized for reading: `/src/domain`, `/src/ingestion`, `/src/derivation`, `/src/ai` each a self-contained story.

The recruiter target: one click → working app. Second click → engineering story. Third click → readable code.
