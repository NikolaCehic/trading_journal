# Trade Journal — Use Cases & User Flows

An end-to-end map of what the application does, who it's for, and every screen a user can reach. Written as the source of truth for onboarding new engineers, writing help docs, and scoping new work.

---

## 1. What the app is

A behavioural trade journal for crypto traders. Users connect exchange history (CSV uploads or an on-chain wallet address), the app derives positions and trading stats from raw fills, then surfaces both analytics (equity curve, win rate, profit factor) and **behavioural detectors** (revenge trading, oversized positions, cutting winners short, etc.). A weekly AI-generated digest nudges the user toward one concrete change.

Stack: Remix (on Cloudflare Workers via wrangler), Inngest for background jobs, Neon/Postgres with Drizzle, Better Auth + Google OAuth, Claude API for the narrator/digest.

---

## 2. Personas & value proposition

- **Active crypto trader** — wants to understand their own behavioural leaks (size drift, tilt, revenge trades) not just P&L.
- **Pro / high-frequency user** — lots of fills, many accounts. Needs fast imports and eventually auto-sync.
- **Curious observer / demo user** — lands via marketing, needs a zero-setup preview (the `demoSeed` path).

The pitch (mirrored on the landing page): *"Your P&L is the symptom; your patterns are the disease."*

---

## 3. The mental model in one paragraph

A user uploads a CSV or pastes a wallet address → the app parses it into **canonical fills** (one row per execution) → fills are merged into **positions** (weighted-average entries, split exits, fees, funding) → detectors run against the closed positions to generate **findings** → pre-aggregated **daily/asset/session metrics** are written → UI surfaces on dashboard, trades list, trade detail, and digest.

Everything after "upload" happens inside Inngest jobs so the UI never blocks. The `import` row has its own state machine the user can watch.

---

## 4. Route map

### Public routes (unauthenticated)

| Route | Purpose |
|---|---|
| `/` | Landing page, pricing, detector showcase, Google sign-in |
| `/login` | Dedicated sign-in page |
| `/changelog` | Release notes |
| `/unsubscribed` | Email unsubscribe confirmation |

### App routes (authenticated, under `(app)/_layout`)

| Route | Purpose |
|---|---|
| `/dashboard` | KPIs (net P&L, win rate, avg W/L, profit factor, trade count), equity curve, asset breakdown, findings sidebar, time-of-day heatmap. Filters: 7d / 30d / 90d / YTD / all, and spot / perp / all. |
| `/import` | CSV uploader (Binance, Hyperliquid, Bybit, OKX), Hyperliquid wallet connector, and live import history table. |
| `/trades` | Trade list with filters (symbol, instrument, side, P&L sign), keyboard navigation (`j`/`k`/`Enter`), bulk tagging, export. |
| `/trades/$positionId` | Trade detail: position header, metric chips (R multiple, max DD, fees, funding, notional, fill count), adherence row vs plan, fills timeline (candles + fill overlay), tabs for Notes, Tags, Findings, Coach. |
| `/plans` | Pre-trade plan list, filter by active / archived / all. |
| `/plans/new` | Create a plan: symbol, side, entry / stop / target, size, markdown rationale. |
| `/plans/$planId` | Edit plan, view linked positions and adherence. |
| `/detectors` | Built-in detector toggles (12 live) + custom detector CRUD (create, edit, enable, export). |
| `/detectors/new` | Define a custom detector (name, title, severity, predicate). |
| `/detectors/$detectorId` | Edit a custom detector. |
| `/digest` | Weekly digest preview: narrative panel, email HTML iframe, "send now" button, token usage, fallback/retry badges. |
| `/settings` | Account read-only (email, timezone), weekly digest toggle, full data export as JSON, link to detectors. |

---

## 5. Key user flows

### 5.1 First-time user: sign up → first import → first insight

1. User hits `/` → clicks Google sign-in.
2. Better Auth creates user row; redirect to `/dashboard`.
3. Dashboard sees zero fills → shows empty state with CTA to `/import`.
4. User uploads a CSV (or pastes an HL wallet).
5. Import row transitions: `pending` → `parsing` → `deriving` → `complete`.
6. Dashboard populates: equity curve, KPIs, top findings.
7. Weekly digest is scheduled (Sunday 22:00 in user's timezone, default on).

### 5.2 CSV import

1. `/import` → select exchange → drag-drop or pick file.
2. Frontend reads the file and calls `validateCsvImport({ csvContent, source })` (`app/routes/(app)/_layout/import.tsx:34`). The matching adapter detects variant and returns a preview: row count, date range, symbols, errors if any.
3. User confirms → `startCsvImport` creates the `importRecord` row and fires `ingestion/complete` (for CSV it's parsed inline before the event, see `src/jobs/ingestion.ts`).
4. Derivation job picks it up, merges fills → positions, runs detectors, writes aggregates.
5. UI polls `getImportStatus` and reflects the state in the import history table.
6. On `complete`, fills are visible in `/trades` and `/dashboard` refreshes.

### 5.3 Hyperliquid wallet connect

1. `/import` → "Hyperliquid wallet" card → paste `0x…` address (validated as `0x` + 40 hex).
2. `startWalletImport` creates an `importRecord` (exchange `hyperliquid`, source `hyperliquid-wallet`) and fires `ingestion/hl-wallet-pull`.
3. `hlWalletPullFn` runs (`src/jobs/ingestion.ts:10`): concurrency-limited to 5, retries twice. Calls the HL API via `HyperliquidWalletAdapter`, persists fills, emits `ingestion/complete`.
4. Derivation flow from 5.2 continues from here identically.

### 5.4 Drill into a single trade

1. `/trades` → filter / search → highlight a row (`j`/`k`) → `Enter` opens `/trades/$positionId`.
2. User sees: breadcrumb, header (symbol/side/dates/avg entry/exit/size/PnL), metric chips, adherence row (if plan-linked), fills chart with candles, fills table.
3. **Notes tab** — markdown editor, autosaves `tradeNote`.
4. **Tags tab** — apply setup and mistake tags; tags roll up into dashboard analytics.
5. **Findings tab** — all detector hits scoped to this position.
6. **Coach tab** — Claude-generated narrative (cached in `tradeCoachNote`).

### 5.5 Plan-driven trading

1. Before entering a trade: `/plans/new` → fill symbol, side, entry/stop/target, size, rationale.
2. Later, after fills are derived, `plan/auto-match` fires → `autoMatchPlansFn` tries to link a closed position to a plan by symbol + side + timing.
3. On `/trades/$positionId`, a plan-linked trade gets an adherence row comparing actual entry/stop/exit vs planned.
4. Unlinked plans accumulate on `/plans`; weekly plan-reminder emails ping the user (see `src/jobs/planReminders.ts`).

### 5.6 Custom detectors

1. `/detectors` → "New detector" → fill name, title, severity, predicate.
2. Saved detectors run on the next derivation pass against every user position.
3. Hits show up on trade detail Findings tab and contribute to the digest "top finding" candidate pool.
4. Built-in detectors can be toggled on/off per user via `getBuiltinDetectorSettings` / `setBuiltinDetectorEnabled`.
5. Export / import custom detectors as JSON for portability.

### 5.7 Weekly digest

1. Hourly cron (`digestWeeklyScheduler` in `src/jobs/narrator.ts`) checks every user: is it Sunday 22:00 in their timezone and is the digest toggle on?
2. If yes, fires `digest/compose` for the current ISO week.
3. `composeDigestFn` gathers facts (biggest win, biggest loss, top finding by cost, trade count), calls Claude for narrative, renders email HTML, writes `digestRun`, fires `digest/send`.
4. `sendDigestFn` signs an unsubscribe token and sends via email provider.
5. User can preview at `/digest` any time, or hit "send now" to test. If Claude is disabled (`AI_ENABLED=off` or no `ANTHROPIC_API_KEY`), a fallback template is used and the send button disables.

### 5.8 Export & delete

- `/settings` → "Download export" → calls `exportAllData` → returns a single JSON bundle (positions, fills, notes, tags, findings, rules, imports, plans). Filename `trade-journal-export-YYYY-MM-DD.json`. No lock-in.
- Full account deletion cascades through foreign keys (landing page advertises "delete in one click").

---

## 6. Supported import sources

Adapters in `src/ingestion/adapters/` implement `SourceAdapter<Input>`. Each adapter has `validate`, `parse`, and `normalize` methods; validate is used for the preview step, parse+normalize for ingestion.

| Source | Input | Variants | Notes |
|---|---|---|---|
| `binance-csv` | CSV text | Spot, USDⓈ-M Futures | Auto-detects variant by header set |
| `hyperliquid-csv` | CSV text | Single format | Required headers: `time, coin, side, px, sz, dir, fee, feeToken, tid`; `side` is `A`/`B` (sell/buy) |
| `hyperliquid-wallet` | `0x` address | n/a | Public HL API, no signing; the only live wallet-based source today |
| `bybit-csv` | CSV text | UTA + non-UTA, spot + perp | |
| `okx-csv` | CSV text | Unified spot + futures | |

Sample fixtures live in `fixtures/` (one per exchange plus behavioural demos — see §10).

---

## 7. Background pipeline (Inngest)

Events (`src/jobs/events.ts`) and functions (`src/jobs/functions.ts`).

### Events

| Event | Payload highlights | Emitter |
|---|---|---|
| `ingestion/hl-wallet-pull` | `walletAddress`, `importId`, `userId` | `/import` wallet submit |
| `ingestion/complete` | `newFillCount`, `importId`, `userId` | `hlWalletPullFn`, CSV import path |
| `derivation/complete` | `positionCount`, `findingCount`, `derivationVersion` | `deriveOnIngestionCompleteFn` |
| `derivation/rederive` | `userId`, `version` | Ad-hoc (detector updates, etc.) |
| `plan/auto-match` | `userId` | After derivation completes |
| `digest/compose` | `userId`, `isoWeek` | `digestWeeklyScheduler` |
| `digest/send` | `digestRunId` | `composeDigestFn` |

### Functions (summary)

| Function | Trigger | Concurrency | What it does |
|---|---|---|---|
| `hlWalletPullFn` | `ingestion/hl-wallet-pull` | 5 parallel | Fetch HL fills, persist, emit `ingestion/complete` |
| `deriveOnIngestionCompleteFn` | `ingestion/complete` | 3 parallel, keyed by `userId` | Run `runDerivation`, emit `derivation/complete` + `plan/auto-match`, mark import `complete`. Intentionally does NOT wrap large payloads in `step.run` to avoid Inngest step-output size caps (see `src/jobs/derivation.ts:10`). |
| `rederiveFn` | `derivation/rederive` | 1 per user | Re-run derivation at a specific version |
| `digestWeeklyScheduler` | cron hourly | — | Per user, is it Sunday 22:00 in their tz? If yes, fire `digest/compose` |
| `composeDigestFn` | `digest/compose` | — | Facts → Claude narrative → email HTML → `digest/send` |
| `sendDigestFn` | `digest/send` | — | Sign unsubscribe, send via email provider |
| `autoMatchPlansFn` | `plan/auto-match` | — | Link newly closed positions to `tradePlan` rows |
| `sendPlanReminderFn` | cron per-user | — | Monday 9am check-in emails for active plans |

### Import status states

Defined in `src/db/schema/ingestion.ts:4`:

`pending` → `parsing` → `normalizing` (legacy) → `deriving` → `complete` | `failed`

The UI polls `getImportStatus` and renders the current state in the import history table on `/import`. `failed` exposes `errorMessage` + `errorDetail` to the user.

---

## 8. Data model headlines

Only the load-bearing tables — see `src/db/schema/` for full definitions.

- **`fill`** (`canonical.ts`) — one row per execution. Key fields: `userId, exchange, symbol, instrumentType (spot|perp), side (buy|sell), price, size, fee, feeCurrency, executedAt, externalId`. Unique on `(userId, exchange, externalId)` so re-imports are idempotent.
- **`position`** (`derivation.ts`) — a merged trade. `entryAvgPrice, exitAvgPrice, size, notionalUsd, maxNotionalUsd, realizedPnl, totalFees, fundingPnl, rMultiple, maxDrawdownPct, openedAt, closedAt, planId, planSnapshot*, derivationVersion`. `closedAt = null` for open positions.
- **`positionFill`** — junction, with `role` ∈ `open | add | reduce | close`.
- **`dailyMetric`, `assetMetric`, `sessionMetric`** — pre-aggregated stats, scoped by `derivationVersion` so the dashboard always reads a consistent snapshot.
- **`tradeNote`, `setupTag`, `mistakeTag`, `positionTag`, `positionReflection`** (`journal.ts`) — user-authored content attached to a position.
- **`tradePlan`** — pre-trade plans; linked from `position.planId` after auto-match.
- **`importRecord`, `rawImportRow`** (`ingestion.ts`) — the import state machine + raw audit trail.
- **`digestRun`, `digestRule`, `tradeCoachNote`** (`narrator.ts`) — weekly digest state and cached narrator output.
- **`customDetector`** — user-defined detectors.

---

## 9. Settings & account

Route: `/settings` (`app/routes/(app)/_layout/settings/index.tsx`).

- **Account** (read-only): email, detected timezone, demo flag.
- **Weekly digest**: toggle (default on; disabled for demo users). Mutation `setDigestEnabled`.
- **Export**: `exportAllData` returns the full JSON bundle.
- **Detectors**: link to `/detectors` for built-in toggles + custom detector CRUD.
- **Timezone detection**: `Intl.DateTimeFormat().resolvedOptions().timeZone` at layout mount (`app/routes/(app)/_layout.tsx:29`), falls back to UTC.

---

## 10. Behavioural fixture library

`fixtures/` contains hand-crafted CSVs that each trigger a specific detector pattern. Useful for demos, detector regression tests, and the `demoSeed` seeded account.

| Fixture | Pattern it demonstrates |
|---|---|
| `revenge-trader.csv` | Entries within minutes of a loss, same symbol |
| `loss-chaser.csv` | Holding losers past stop, doubling down |
| `scalp-gambler.csv` | Sub-minute holds, high fee drag |
| `size-bloater.csv` | Size grows during drawdown |
| `winner-cutter.csv` | Cutting winners below median R |
| `evening-tilt.csv` | Losses concentrated in late hours |
| `size-drift.csv` | High variance in position size |
| `leverage-creep.csv` | Max notional climbs session over session |
| `pyramid-losers.csv` | Adding to losing positions |
| `fee-bleed.csv` | Net profitable gross, net negative after fees |
| `steady-discipline.csv` | Healthy baseline for contrast |
| `bad-ticker.csv` | Malformed input for parser robustness tests |
| `hyperliquid-sample.csv`, `hyperliquid-detailed-sample.csv`, `binance-*`, `bybit-csv-*`, `okx-csv-sample.csv` | Canonical exchange samples |

---

## 11. Planned / partial features

Things visible in the code or marketing copy that are not fully live:

- **Pattern-of-the-week detector** — placeholder card with dashed border on the landing page (`/(public)/index.tsx:438`). Copy: "one detector, highlighted weekly, with a single suggested rule you can opt into." Not wired up.
- **Additional detectors** — landing page labels the detectors section "Phase 4" and promises 14 total; 12 are live.
- **Stocks & forex** — FAQ on landing page explicitly says "not yet."
- **Hyperliquid auto-sync** — manual wallet pull works; scheduled auto-sync is marketed as Pro but not implemented as of this writing.
- **Digest fallback mode** — the AI narrator falls back to a template when `AI_ENABLED=off` or no `ANTHROPIC_API_KEY`; the `/digest` preview exposes `fallback` and `retried` status badges. Not a bug — a documented degraded state.

---

## 12. File reference index

| Concern | Location |
|---|---|
| Public routes | `app/routes/(public)/` |
| App routes | `app/routes/(app)/_layout/` |
| Ingestion adapters | `src/ingestion/adapters/` |
| Job definitions | `src/jobs/` (ingestion, derivation, narrator, planMatcher, planReminders, functions, events) |
| Derivation engine | `src/derivation/` (persist, detectors, position merging) |
| Narrator (digest + coach) | `src/narrator/` (facts, compose, schemas, email/render) |
| Data model | `src/db/schema/` (canonical, derivation, journal, ingestion, narrator, auth, customDetectors, market) |
| Server mutations / queries | `src/server/` (import, exportData, demoSeed, …) |
| Fixtures | `fixtures/` |
| QA audits | `docs/qa/2026-04-24-*.md` |
| Phase roadmap | `docs/wiki/phases.md` |
