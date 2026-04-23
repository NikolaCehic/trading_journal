# Phase 8 — Pre-trade Plans + Regression Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`.

**Goal:** Capture pre-trade plans (entry, stop, target, size rationale) so R-multiple becomes real instead of a 1%-approximation, plan adherence becomes measurable, and the "broke rules" detector has something concrete to check against. Plus a Playwright E2E smoke suite to lock down regression risk across the 100+ server fns + routes we've accumulated.

**Architecture:**
- New `trade_plan` table keyed to `(userId, symbol, side)` with no hard link to `position` at creation time. Linking happens manually after a trade closes: the user picks a plan from a dropdown on the trade detail page. Auto-matching deferred — too judgment-heavy for v1.
- `position.planId` (nullable FK) is the join. When set, `r_multiple = realizedPnl / ((|entry − stop| × size))` (real R-multiple). When null, falls back to the Phase 6 1%-notional approximation.
- "Broke rules" detector v2 reads the linked plan per position and checks:
  - Did they hit stop? Exit price beyond stop → violation
  - Did they exit early (cut winner short)? Exit price before target AND realizedPnl > 0 → violation
  - Did they oversize? Actual size > plan size × 1.2 → violation
- Playwright E2E runs against a seeded demo user. Target one happy-path scenario + a few critical-path sanity checks. Runs locally via `pnpm e2e` and in CI.

**Tech Stack:** Existing + `@playwright/test` (new dev dep).

---

## Task 1 — `trade_plan` schema + CRUD

**Files:**
- Modify: `src/db/schema/journal.ts` — add `tradePlan` table
- Modify: `src/db/schema/derivation.ts` — add nullable `plan_id text references trade_plan(id)` column on `position`
- Modify: `src/db/schema/index.ts` (barrel)
- Create: `src/domain/plan.ts` — `TradePlan` type
- Generate: migration
- Create: `src/server/plans.ts` — createPlan, listPlans, getPlan, updatePlan, archivePlan, linkPositionToPlan, unlinkPositionFromPlan

**`trade_plan` table:**
```ts
export const tradePlan = pgTable('trade_plan', {
  id: text('id').primaryKey(),  // nanoid
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  symbol: text('symbol').notNull(),
  intendedSide: pgEnum('plan_side', ['long', 'short'])('intended_side').notNull(),
  // All prices nullable — user might plan with just rationale + size
  entryPrice: numeric('entry_price', { precision: 20, scale: 8 }),
  stopPrice: numeric('stop_price', { precision: 20, scale: 8 }),
  targetPrice: numeric('target_price', { precision: 20, scale: 8 }),
  plannedSize: numeric('planned_size', { precision: 20, scale: 8 }),
  rationale: text('rationale'),  // free-form markdown
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (t) => ({
  userSymbol: index('trade_plan_user_symbol_idx').on(t.userId, t.symbol),
}))
```

Server fns:
- `createPlan({ symbol, intendedSide, entryPrice?, stopPrice?, targetPrice?, plannedSize?, rationale? })` — returns `{ id }`
- `listPlans({ includeArchived?, symbol? })` — returns `TradePlan[]` with optional position link count
- `getPlan({ id })` — single plan with any linked positions
- `updatePlan({ id, ...fields })` — patch any editable field
- `archivePlan({ id })` — stamps `archivedAt`
- `linkPositionToPlan({ positionId, planId })` — sets `position.planId`; ownership check on both
- `unlinkPositionFromPlan({ positionId })` — nulls `position.planId`

All mutations guarded by `assertNotDemo`.

**Steps:**
- [ ] Schema (both tables) + barrel export.
- [ ] Generate migration.
- [ ] Domain type.
- [ ] Server fns (~200 lines total).
- [ ] Unit tests for each server fn (mock-db pattern).

## Task 2 — Plans list `/plans` + new-plan form `/plans/new`

**Files:**
- Create: `app/routes/(app)/_layout/plans/index.tsx` — list page
- Create: `app/routes/(app)/_layout/plans/new.tsx` — form page
- Create: `app/routes/(app)/_layout/plans/$planId.tsx` — edit/detail page
- Modify: `src/components/shell/TopBar.tsx` — add "Plans" nav item between Trades and Digest

**`/plans` list:**
- Table with columns: Symbol, Side, Entry, Stop, Target, Size, Created, Linked positions count, Actions
- Filter chips: All / Active (no archivedAt) / Archived
- "Create plan" button → `/plans/new`
- Row click → `/plans/:id` (detail + edit)

**`/plans/new`:**
- Form fields: symbol (text), intendedSide (radio: long/short), entryPrice, stopPrice, targetPrice, plannedSize (all number inputs, optional), rationale (textarea with markdown toolbar — reuse the Notes toolbar helpers)
- On submit → `createPlan` → navigate to the new plan's detail page

**`/plans/:id`:**
- Read-only view of all fields
- "Edit" button toggles to inline editing
- "Archive" / "Unarchive" button
- Below: list of linked positions (read `listPlans({ symbol }).planPositionsMap` or a new `getPlan({ id })` that includes linked positions); each row Links to `/trades/$positionId`

## Task 3 — Link-to-plan dropdown on trade detail

**Files:**
- Modify: `app/routes/(app)/_layout/trades/$positionId.tsx` — new section near the position header
- Modify: `src/server/trades.ts` — `TradeDetailBundle.linkedPlan` (nullable) added to the output

**Contract:**
- Trade detail fetches `getTradeDetail` which now includes:
  - `linkedPlan: { id, intendedSide, entryPrice, stopPrice, targetPrice, plannedSize, rationale } | null`
  - `availablePlans: Array<{ id, symbol, intendedSide, createdAt }>` — unarchived plans on this position's symbol+side that don't already have a linked position (or max 5 most recent)

**UI:**
- Header card gets a "Plan" chip to the right of the PnL chip:
  - If `linkedPlan` set: `"Plan linked · Unlink"` — click "Unlink" calls `unlinkPositionFromPlan`
  - If null: `"Link to a plan"` dropdown — selection triggers `linkPositionToPlan`; below: "+ New plan" linking to `/plans/new?symbol=<sym>&side=<side>`
- Dropdown is a small inline select (not a modal). Options show symbol + createdAt time.

## Task 4 — R-multiple v2 + plan adherence metrics

**Files:**
- Modify: `src/server/trades.ts` — in `getTradeDetail`, compute real R-multiple when plan is linked and has `entry` + `stop`:
  ```ts
  const realR = linkedPlan && linkedPlan.entryPrice && linkedPlan.stopPrice
    ? realizedPnl / (Math.abs(Number(linkedPlan.entryPrice) - Number(linkedPlan.stopPrice)) * Number(pos.size))
    : null
  ```
  Expose as `rMultiplePlanned` in the bundle alongside the existing `rMultiple` (1% approximation).
- Modify: `app/routes/(app)/_layout/trades/$positionId.tsx` — metric chip prefers `rMultiplePlanned` when set, with hint `"vs. planned risk"`; falls back to `rMultiple` with hint `"1R = 1% of entry"`.
- Add new chips: **Entry slip**, **Exit slip**, **Size ratio** (actual/planned), **Hit stop?**, **Hit target?** — computed inline in the `$positionId` component from `bundle.linkedPlan` + `bundle.position`:
  - Entry slip = `(avgEntry − plannedEntry) / plannedEntry` (signed percentage)
  - Exit slip = `(avgExit − plannedTarget) / plannedTarget` (when target set)
  - Size ratio = `actualSize / plannedSize`
  - Hit stop? = boolean (exitPrice ≤ stopPrice for long; ≥ for short)
  - Hit target? = boolean (exitPrice ≥ targetPrice for long; ≤ for short)
- Only render these chips when a plan is linked.

## Task 5 — "Broke rules" detector v2

**Files:**
- Modify: `src/derivation/detectors/breaking-rules.ts` (if not named that exactly, check — it might be `cut_winners_ride_losers` or similar; use the one that's closest in spirit or create a new one named `plan_adherence`)
- Modify: `src/derivation/runner.ts` — the new detector joins on `trade_plan` via `position.planId`
- Modify: `src/derivation/version.ts` — bump `DERIVATION_VERSION` to `3`

**Logic:**
For each position with a `planId`:
1. Oversized: `actualSize > plannedSize * 1.2` → flag
2. Cut winner short: `realizedPnl > 0 && !hitTarget && abs(exitPrice − targetPrice) > 0.5% of entryPrice` → flag (only when target set)
3. Let loser run: `realizedPnl < 0 && exitPrice crossed beyond stop price by > 1%` → flag (only when stop set)
4. No plan: if `position.planId == null` AND position has `hasNote == false` AND `tagCount == 0` → existing detector already catches this as "no-plan-trades"

Emit a finding per violation with detectorId `'plan_adherence_violation'` (or reuse existing `cut_winners_ride_losers` / `oversized_positions` detectors — inspect their logic first, maybe they already partially cover this).

**Decision:** add a NEW detector `'plan_adherence'` — don't overload existing ones. Document the DetectorId enum addition in `src/domain/finding.ts`.

Evidence shape: `{ planId, violationKind: 'oversized'|'cut_short'|'stop_breach', actualValue, plannedValue, costUsd }`.

Add to `DETECTOR_LABELS` in `src/components/dashboard/FindingsSidebar.tsx`.

**Version bump:** incrementing to `DERIVATION_VERSION = 3` requires user to `pnpm rederive` after deploy.

## Task 6 — Playwright E2E smoke suite

**Files:**
- Add dep: `pnpm add -D @playwright/test`
- Create: `playwright.config.ts`
- Create: `tests/e2e/smoke.spec.ts`
- Create: `tests/e2e/fixtures/` directory
- Modify: `package.json` — add `"e2e": "playwright test"` and `"e2e:install": "playwright install chromium"`

**Scenario (single happy path):**
1. Navigate to `/` (landing)
2. Assert hero text "A trading journal that talks back" is visible
3. Click "Try demo" button (assume demo seeded)
4. Assert URL ends in `/dashboard`
5. Assert TopBar renders with Dashboard/Trades/Digest/Import nav
6. Click "Trades"
7. Assert at least one row in the trades table
8. Click first row
9. Assert trade detail loads (symbol visible in header)
10. Click Notes tab, type some text, wait 1.5s for autosave
11. Assert "Saved Nm ago" appears
12. Click Settings gear icon
13. Assert `/settings` loads
14. Click Export Download button — assert file downloads

**Config:**
- Base URL: `process.env.E2E_BASE_URL ?? 'http://localhost:3000'`
- Expects dev server running; `webServer` block in config runs `pnpm dev` if not reachable.
- Single browser: chromium.
- Retry: 1 locally, 2 in CI.
- Trace: on-failure.

**Prerequisites:**
- Demo user seeded (user runs `pnpm seed:demo` before `pnpm e2e`). Document in README.

**Steps:**
- [ ] Install Playwright + chromium.
- [ ] `playwright.config.ts` with webServer reuse.
- [ ] `smoke.spec.ts`.
- [ ] Add npm scripts.
- [ ] Don't wire CI yet — that's a follow-up. Local green is enough for this phase.

## Task 7 — Wiki + changelog + landing detector count

**Files:**
- Modify: `docs/wiki/phases.md` — Phase 8 Shipped section
- Modify: `app/routes/(public)/changelog.tsx` — prepend v0.8 entry
- Modify: `app/routes/(public)/index.tsx` — update "11 behavioral detectors" stat to "12 behavioral detectors" if the new plan_adherence detector ships

**Steps:**
- [ ] All three above.
- [ ] Target 200+ tests passing.

---

## Scope NOT in Phase 8

- **Auto plan→position matching** — too judgment-heavy for v1. Manual linking stays.
- **Market-data candles** on fills timeline — needs provider, Phase 9+.
- **Custom user-defined detectors (DSL)** — Phase 9 (very complex).
- **CI config for Playwright** — local-first; CI workflow is its own small task.
- **Plan templates** (save a reusable plan shape) — out of MVP.
- **Plan reminders via email** — "you haven't entered BTC yet — plan expires" type. Future.
- **Mobile plans UI** — all surfaces are desktop-first today.
