# Phase 12 — Polish Close-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`.

**Goal:** Close out the remaining deferred items — volume pane on the candle chart, BTC-price overlay on the dashboard equity curve, nested predicate composition for custom detectors, per-user built-in detector toggles, and JSON export/import for custom detectors. Mobile UX is explicitly out of scope per the user request. Preview deploys are deferred — they require external service setup (Vercel/CF) that's infra, not code. Stop-loss / planned-risk pre-trade capture is already covered by Plans (Phase 8).

**Tech Stack:** Existing. No new deps.

---

## Task 1 — Volume pane on trade detail

**Files:**
- Modify: `app/routes/(app)/_layout/trades/$positionId.tsx` — `CandlesAndFills` component

**Behavior:**
- Extend the SVG to include a volume pane below the main candle pane
- Layout: main pane is 75% of height (~210px when h=280); volume pane is the bottom 25% (~70px)
- Share x-axis with the price pane
- Each candle's `volume` rendered as a vertical bar centered on the candle's x position, colored green if close >= open else red, same width as the candle body
- Y-axis for volume scales to max volume across the rendered candles
- Horizontal separator line between panes
- No labels on the volume axis — keep it visual-only

**Steps:**
- [ ] Adjust `innerH` to `innerH * 0.72` for price pane; allocate `innerH * 0.25` for volume pane with small gap
- [ ] Add volume rendering loop after candles
- [ ] Add separator line at `paneBoundaryY`
- [ ] Confirm hover tooltip still works (shouldn't change — hover only cares about price)

## Task 2 — BTC price overlay on dashboard equity curve

**Files:**
- Modify: `src/components/dashboard/EquityCurve.tsx`
- Modify: `src/server/dashboard.ts` — fetch BTC price series inline with the bundle (or lazy-load via separate query)
- Potentially: `src/domain/dashboard.ts` — add `btcContext: Array<{ date; priceUsd }>` to the bundle

**Simplest approach:** don't bloat `getDashboardBundle`. Add a separate lightweight server fn `getBtcEquityContext({ from, to })` that returns `Array<{ date: string; close: number }>` sampled at daily intervals. The dashboard fires it as a second `useQuery` in parallel.

**UI:**
- When BTC context is loaded, render a subtle second line in the equity curve SVG (stroke `var(--fg-faint)`, dashed, no area fill)
- Indexed to `100` at the start of the visible range (so "BTC relative" vs "your cumulative P&L") — shows outperformance intuitively
- Hover tooltip shows both values
- Fallback: when query errors or returns empty, just skip the overlay (don't render the line)

**Steps:**
- [ ] Add `getBtcEquityContext({ from, to })` server fn that uses `getCandles(db, { exchange: 'binance', symbol: 'BTCUSDT', interval: '1d', from, to })` + reduces to daily close prices
- [ ] Dashboard route fires a parallel query; passes result as `btcContext` prop to `EquityCurve`
- [ ] `EquityCurve` accepts optional `btcContext: Array<{ date: string; priceUsd: number }>` prop; renders dashed line indexed to 100
- [ ] Small legend strip at top of chart: "your P&L · BTC indexed" chips with color swatches

## Task 3 — Nested predicate composition in `/detectors/new` + `/detectors/$id`

**Files:**
- Modify: `app/routes/(app)/_layout/detectors/new.tsx`
- Modify: `app/routes/(app)/_layout/detectors/$detectorId.tsx`

**Current:** flat list of conditions joined by all/any.

**New:** group view. Each group is a list of conditions + a sub-composition (all/any/not). Groups can contain nested groups.

**UX:**
- Default view: one group with "all" composition and one condition row (unchanged)
- Each group has:
  - A composition toggle: `all` / `any` / `not` (not has a single child only)
  - "Add condition" button → new leaf in this group
  - "Add group" button → new nested group inside this group
  - "Remove" button (if not the root group)
- Visual nesting: indent nested groups by 16px; draw a subtle left border in `var(--border)` to show scope
- Data shape: `GroupNode = { composition: 'all' | 'any' | 'not'; children: Array<LeafCondition | GroupNode> }`
- Convert to `PositionPredicate`:
  - `{ composition: 'all', children: [...leaves] }` → `{ all: leaves.map(toLeafPredicate) }`
  - `{ composition: 'not', children: [single] }` → `{ not: toNode(single) }`
  - Recursive

**Constraints on the UI:**
- `not` groups allow exactly one child (show "add condition" only when empty; enforce at save time)
- Max depth 4 levels — warn user at save if exceeded (prevents user from creating pathological trees)

**Reverse-parse for detail page:**
- `/detectors/$id` currently shows read-only flat view via `predicateToConditions`. Extend to handle nested via recursive walker that converts back to GroupNode tree.

**Steps:**
- [ ] Define GroupNode + LeafCondition types
- [ ] Build `<PredicateGroupEditor group onChange />` component — recursive
- [ ] Refactor form state to GroupNode root
- [ ] `buildPredicate(root)` recursive converter
- [ ] `predicateToGroupNode(predicate)` for edit/view reverse-parse (handle `all` / `any` / `not` / leaf)
- [ ] Preview counter still works (debounced call to `previewCustomDetector`)
- [ ] Update detail page's read-only view to render nested groups

## Task 4 — Per-user built-in detector toggles

**Files:**
- Modify: `src/db/schema/auth.ts` OR new `src/db/schema/userPrefs.ts` — add `disabledBuiltinDetectors text[]` column on `user` (list of detector IDs disabled for this user)
- Modify: `src/auth/server.ts` — `additionalFields.disabledBuiltinDetectors`
- Modify: `src/derivation/runner.ts` — filter out disabled built-in detectors from `DETECTORS` for each user before running
- Modify: `src/server/userPrefs.ts` — `setBuiltinDetectorEnabled({ detectorId, enabled })` server fn
- Modify: `app/routes/(app)/_layout/detectors/index.tsx` — add a "Built-in detectors" section at the top of the page with a row per built-in + an enabled toggle
- Generate migration

**Server fn:**
```ts
export const setBuiltinDetectorEnabled = createServerFn({ method: 'POST' })
  .inputValidator((d) => z.object({
    detectorId: z.string().min(1),   // must be one of BuiltinDetectorId — validate
    enabled: z.boolean(),
  }).parse(d))
  .handler(async ({ data }) => {
    const userId = await requireUserMutation()
    // Update user.disabledBuiltinDetectors array
    const [current] = await db.select({ disabled: user.disabledBuiltinDetectors }).from(user).where(eq(user.id, userId)).limit(1)
    const set = new Set(current?.disabled ?? [])
    if (data.enabled) set.delete(data.detectorId)
    else set.add(data.detectorId)
    await db.update(user).set({ disabledBuiltinDetectors: Array.from(set) }).where(eq(user.id, userId))
    return { ok: true, enabled: data.enabled }
  })
```

**Runner filter:**
```ts
const userRow = await db.select({ disabled: user.disabledBuiltinDetectors }).from(user).where(eq(user.id, userId)).limit(1)
const disabledSet = new Set(userRow[0]?.disabled ?? [])
const activeDetectors = DETECTORS.filter(d => !disabledSet.has(d.id))
// ... run activeDetectors instead of DETECTORS
```

**UI:**
- "/detectors" page gets a new section above the custom-detector list: "Built-in detectors (12)"
- Row per built-in: detector label + brief blurb + enabled toggle
- Disabled detectors render with reduced opacity
- Toggle fires `setBuiltinDetectorEnabled`; optimistic update via query invalidation

Built-in descriptions — reuse the blurbs from the landing page's `DetectorCard` section.

## Task 5 — Export/import custom detectors (JSON)

**Files:**
- Modify: `app/routes/(app)/_layout/detectors/index.tsx` — add "Export all" + "Import" buttons
- Modify: `src/server/customDetectors.ts` — add `importCustomDetectors({ detectors })` batch server fn (maybe — see below)

**Export:**
- Pure client-side — fetch `listCustomDetectors()` (already have the query) → serialize to JSON with metadata header:
  ```json
  {
    "schemaVersion": 1,
    "exportedAt": "2026-04-24T...",
    "detectors": [ { name, title, severity, predicate, enabled } ... ]
  }
  ```
- Download via `downloadFile` helper (already exists in `src/lib/csv.ts`)
- Include every custom detector; strip `id`, `userId`, `createdAt`, `updatedAt`

**Import:**
- Dialog: "Paste your detectors JSON" with a textarea
- On submit: parse → validate each detector via `PositionPredicateSchema` → call `importCustomDetectors({ detectors })`
- Server fn does N inserts in sequence, skipping if a detector with the same `name` already exists (idempotent)
- Return `{ imported: N, skipped: N, failed: N }` + per-row error details

**Server fn:**
```ts
const importInput = z.object({
  detectors: z.array(z.object({
    name: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/),
    title: z.string().min(1).max(200),
    severity: z.enum(['info', 'warning', 'critical']),
    predicate: PositionPredicateSchema,
    enabled: z.boolean().optional(),
  })).max(100),  // cap to prevent abuse
})

export const importCustomDetectors = createServerFn({ method: 'POST' })
  .inputValidator((d) => importInput.parse(d))
  .handler(async ({ data }): Promise<{ imported: number; skipped: number; errors: Array<{ name: string; error: string }> }> => {
    const userId = await requireUserMutation()
    let imported = 0, skipped = 0
    const errors: Array<{ name: string; error: string }> = []

    for (const det of data.detectors) {
      try {
        // Check existing by (userId, name)
        const [existing] = await db.select({ id: userDetector.id }).from(userDetector)
          .where(and(eq(userDetector.userId, userId), eq(userDetector.name, det.name))).limit(1)
        if (existing) {
          skipped++
          continue
        }
        const id = 'det_' + crypto.randomBytes(10).toString('base64url')
        await db.insert(userDetector).values({
          id, userId,
          name: det.name,
          title: det.title,
          severity: det.severity,
          predicate: det.predicate,
          enabled: det.enabled ?? true,
        })
        imported++
      } catch (err) {
        errors.push({ name: det.name, error: String(err) })
      }
    }

    return { imported, skipped, errors }
  })
```

**UI:**
- Export: single button in page header → calls `listCustomDetectors()` + `downloadFile`
- Import: button opens a modal (backdrop + centered card) with a textarea; paste; validate; show result toast

## Task 6 — Wiki + changelog

**Files:**
- Modify: `docs/wiki/phases.md`
- Modify: `app/routes/(public)/changelog.tsx` — v0.12 entry

---

## Scope NOT in Phase 12

- **Mobile UX** — explicitly deferred per user request.
- **Preview deploys from CI** — infra-heavy, needs external service (Vercel/CF) setup beyond code.
- **Stop-loss pre-trade capture** — already covered by the Plans feature (Phase 8).
- **Sharing detectors publicly / detector library** — different UX surface.
- **Alerts on custom detector matches** — "notify me immediately when this fires" needs a push channel.
