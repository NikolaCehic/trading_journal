# Phase 7 — Ingestion Expansion + Notification Prefs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`.

**Goal:** Double the supported exchanges (add Bybit + OKX CSV adapters), give users real control over the weekly digest (per-account timezone + digest on/off + unsubscribe link in emails), and ship the "send me this now" button on `/digest`.

**Architecture:**
- Adapters live in `src/ingestion/adapters/*-csv.ts`. Each exports a class conforming to the existing `Adapter` interface (see `binance-csv.ts` / `hyperliquid-csv.ts` for the shape). Orchestrator + import UI key off the `source` string.
- Settings page is a plain authed route under `(app)/_layout/settings/` with three toggles (digest enabled, timezone override, email) backed by a new `user_pref` table — or reuse the `user` table if simpler (it already has `timezone`). We'll reuse `user`.
- Unsubscribe uses a signed token (HMAC over `userId`) embedded in digest email links. Clicking the link hits `/api/unsubscribe?t=...`, validates, sets `digestEnabled=false`, shows a confirmation page.

**Tech Stack:** Existing. No new deps.

---

## Task 1 — Bybit CSV adapter

**Files:**
- Create: `src/ingestion/adapters/bybit-csv.ts`
- Create: `fixtures/bybit-csv-sample.csv`
- Create: `fixtures/bybit-csv-spot-sample.csv`
- Test: `tests/unit/ingestion/bybit-csv.test.ts`

**Bybit trade-history CSV columns** (public docs, perp):
```
Contract,Type,Direction,Status,Filled,Qty,Price,Exec Fee,Trading Fee,Created Time,ID
```

**Bybit spot CSV columns:**
```
Time,Pair,Type,Side,Price,Executed,Amount,Fee,
```

Normalization:
- `exchange: 'bybit'`
- `instrumentType`: derived from file header/known columns — if `Contract` column present → `perp`; if `Pair` column → `spot`.
- `side`: `Buy` → `buy`, `Sell` → `sell`. Perp `Direction: Open Long/Close Long/Open Short/Close Short` → map to `buy`/`sell` by lifecycle.
- Price, size, fee: parse numeric. Bybit uses comma thousands in some exports — strip.
- `externalId`: `ID` column. Unique per trade.
- `executedAt`: parse ISO from `Created Time` or `Time`.
- `normalizerHint`: preserve original `Direction` for perps so the merger can use it.

**Steps:**
- [ ] Write adapter class with `name`, `detect(headerRow)`, `parse(csvContent)` → `CanonicalFill[]`.
- [ ] Create 2 fixture CSVs: 5 perp rows + 5 spot rows. Mix of buys/sells with realistic symbols (`BTCUSDT`, `ETHUSDT`).
- [ ] Unit tests: detect, parse, handles thousands-comma, rejects header-mismatch.
- [ ] Target 6–8 tests.

## Task 2 — OKX CSV adapter

**Files:**
- Create: `src/ingestion/adapters/okx-csv.ts`
- Create: `fixtures/okx-csv-sample.csv`
- Test: `tests/unit/ingestion/okx-csv.test.ts`

**OKX trade-history CSV columns** (public docs):
```
Trading Pair,Direction,Side,Order Type,Filled Quantity,Filled Amount,Trading Fee,Fee Currency,Avg Filled Price,Order Time,Trade ID
```

Normalization:
- `exchange: 'okx'`
- Instrument: infer from symbol format (`BTC-USDT-SWAP` → perp, `BTC-USDT` → spot). Normalize symbol to match other exchanges (`BTC-USDT-SWAP` → `BTCUSDT`, `BTC-USDT` → `BTCUSDT` — yes, both map to the same canonical symbol; instrument type distinguishes them in downstream logic).
- `side: Side` column directly (`buy`/`sell`).
- `executedAt`: parse from `Order Time` — OKX uses `YYYY-MM-DD HH:MM:SS` local or UTC depending on export settings. Assume UTC; document the assumption.
- `externalId: Trade ID`.

**Steps:**
- [ ] Adapter class + fixtures + tests (6–8 tests).

## Task 3 — Wire adapters into orchestrator + import UI

**Files:**
- Modify: `src/server/import.ts` — add `'bybit-csv'` and `'okx-csv'` to the `source` enum and dispatch to the new adapters in `validateCsvImport` + `startCsvImport`
- Modify: `src/ingestion/orchestrator.ts` — extend the source → adapter map
- Modify: `app/routes/(app)/_layout/import.tsx` — source picker chips: Binance / Hyperliquid / **Bybit** / **OKX**
- Modify: `src/domain/import.ts` (if source enum lives there)

**Steps:**
- [ ] Audit where `source` is validated (likely zod enum); add two values.
- [ ] Dispatch path: `new BybitCsvAdapter()` / `new OkxCsvAdapter()`.
- [ ] Add two toggle chips in the import UI.
- [ ] Verify existing Binance+HL flows still work.

## Task 4 — Settings page (/settings)

**Files:**
- Create: `app/routes/(app)/_layout/settings/index.tsx`
- Create: `src/server/userPrefs.ts` additions (extend existing file from Phase 6 Task 10)
- Modify: `src/db/schema/auth.ts` — add `digestEnabled boolean not null default true`
- Modify: `src/auth/server.ts` — expose `digestEnabled` via `additionalFields`
- Generate migration

**UI:**
- Single page `/settings` with 3 sections, design-system styled:
  1. **Account:** email (read-only), current timezone (read-only from auto-capture — show "Detected: Europe/Berlin")
  2. **Digest:** toggle "Send weekly digest email Sunday nights" (`digestEnabled`); current delivery time = `Sunday 22:00 local`
  3. **Export my data:** button that downloads everything the user has — positions + fills + notes + tags as one JSON blob (reuse `src/lib/csv.ts` + server fn)

**Server fns:**
- `setDigestEnabled({ enabled: boolean })` — updates the flag
- `exportAllData()` — returns the full user dataset as a JSON-serializable object

**Nav:** add a "Settings" link to `TopBar` (far-right, before avatar; small gear icon).

**Steps:**
- [ ] Schema + migration + auth config.
- [ ] Server fns (`setDigestEnabled`, `exportAllData`).
- [ ] Settings page UI.
- [ ] TopBar gear icon link.

## Task 5 — Unsubscribe token flow

**Files:**
- Modify: `src/narrator/email/render.ts` — email footer gets a real unsubscribe URL
- Modify: `src/narrator/email/send.ts` — pass a signed token into render
- Create: `src/lib/unsubscribeToken.ts` — `signToken(userId)` + `verifyToken(token)` using the same `BETTER_AUTH_SECRET` as HMAC key (already in env)
- Create: `app/routes/api/unsubscribe.tsx` — GET handler: verify token → flip `digestEnabled=false` → redirect to `/unsubscribed`
- Create: `app/routes/(public)/unsubscribed.tsx` — confirmation page

**Token format:** `<userId>.<hmacSha256(userId).base64url>`. Same pattern as the demo session signing (Phase 5 Task 5).

**Email footer:** replace the existing `"Sent by Trade Journal · reply to reach a human"` line with `"Unsubscribe from the weekly digest"` linked to `${BETTER_AUTH_URL}/api/unsubscribe?t=<token>`.

**Steps:**
- [ ] Token helpers + tests.
- [ ] Wire into renderer + sender.
- [ ] Unsubscribe API route.
- [ ] Confirmation page.

## Task 6 — "Send me this now" on digest preview

**Files:**
- Modify: `app/routes/(app)/_layout/digest/index.tsx`
- Modify: `src/server/digestPreview.ts` — add a `sendDigestNow()` server fn that creates a real `digest_run` row and fires `digest/send`

**UI:**
- Button below the preview panes: "Send this to me now"
- Disabled if `data.failed === true` (don't ship a fallback email on user request; at least warn them it's the fallback)
- On click: POST → wait for success → show toast "Digest email queued" OR error

**Server fn:**
```ts
export const sendDigestNow = createServerFn({ method: 'POST' }).handler(async () => {
  // auth + assertNotDemo
  // Build facts for current week
  // Compose narrative
  // Insert digestRun with status='composed'
  // Fire digest/send event
  // Return digestRunId
})
```

Uses the existing `composeDigestFn` + `sendDigestFn` pipeline — just pre-inserts the row and enqueues the send event.

**Steps:**
- [ ] Server fn.
- [ ] Button + toast wiring.

## Task 7 — Wiki close-out

**Files:**
- Modify: `docs/wiki/phases.md`
- Modify: `app/routes/(public)/changelog.tsx` — prepend v0.7 entry
- Modify: `app/routes/(public)/index.tsx` — update "2 exchanges · Binance, Hyperliquid" stat → "4 exchanges · Binance, Hyperliquid, Bybit, OKX"

**Steps:**
- [ ] Phase 7 Shipped section in wiki with commits/decisions/gotchas/deferred.
- [ ] Changelog v0.7 entry.
- [ ] Landing stat update.

---

## Scope NOT in Phase 7

- **Custom user-defined detectors** — Phase 8 (detector DSL + admin UI; big).
- **Real market-data candles** — Phase 8+ (needs market-data provider integration).
- **Playwright E2E** — own setup phase.
- **CLI-friendly env schema** — still inline-workaround; defer until it actually blocks something.
- **Stop-loss / planned-risk capture** — needs a pre-trade planning surface, separate product line.
- **Notification preferences beyond on/off** — per-topic muting, email frequency, etc. Out of MVP scope.
- **Real-time / webhooks from exchanges** — CSV import is explicitly the opt-in, privacy-first path; live sync is a separate phase.
