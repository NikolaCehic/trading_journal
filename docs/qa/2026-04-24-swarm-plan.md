# QA Swarm Plan — 2026-04-24

**Purpose.** Curated, parallel-dispatchable task list covering the **7 CRITICAL + 23 HIGH** findings from the 2026-04-24 QA audit. Designed for a single driver session running Claude Code subagents in parallel (`Agent()` calls).

**Source:** `docs/qa/2026-04-24-master-punch-list.md` (index) and the five per-domain audit reports in `docs/qa/`.

**Execution model:** Option A — subagents dispatched from one driver, sharing the working tree. The master rule is **no two parallel agents in the same wave may touch the same file**. The wave partition below enforces this.

---

## Driver instructions (read before dispatching)

1. **Before anything else,** run `pnpm typecheck && pnpm test && git status` to confirm a clean baseline. If these fail, fix or revert until green.
2. **Wave 1 dispatch:** copy each `T01`–`T18` block below into a separate `Agent()` call **in a single message**. All 18 are file-isolated and parallel-safe.
   - If 18 concurrent agents is too many for the local rate limit, split into two sub-batches (e.g., T01–T09, then T10–T18). No inter-task dependency within Wave 1, so order within sub-batches is arbitrary.
3. **Gate 1 (blocking):** when every Wave-1 agent has returned, run:
   - `pnpm typecheck` — must pass
   - `pnpm test` — must pass
   - `pnpm build` — must pass
   - Spot-check the UI: load `/dashboard`, `/trades`, `/plans`, `/detectors`, `/import`, force a query error (devtools → block network) and confirm error cards render, verify focus rings are visible on Tab navigation, verify modal contrast tokens look right in dark mode.
   - Commit the batch: one or many commits — driver's call.
4. **Wave 2 dispatch:** copy each `T20`–`T22` block in a single message (3 parallel agents). Each owns exactly one list-route file, so no conflict.
5. **Gate 2 (blocking):** typecheck + test + build + manual keyboard walkthrough:
   - On `/trades`, open BulkTagDialog → Tab must stay inside, Esc must close, focus must return to trigger.
   - On `/detectors`, same for ImportDialog.
   - On `/plans` and `/detectors`, each row must be keyboard-focusable with a visible focus ring and Enter must open the detail.
   - Commit the batch.
6. **Wave 3 dispatch:** copy `T23` as a single `Agent()` call.
7. **Gate 3:** typecheck + test + build + one last toast walkthrough in demo mode (triggers `DemoReadonlyError`): confirm toasts read "Sign in to save changes" instead of "DemoReadonlyError: …". Commit.
8. **Done.** Open a single PR titled `qa: close 7 CRIT + 23 HIGH from 2026-04-24 audit` (or separate PRs per wave if preferred).

**If an agent returns failure or leaves a task incomplete:** do not dispatch the next wave until the failing task is redone or its finding is explicitly deferred with a note in this plan.

---

## Scope

- 7 CRITICAL + 23 HIGH = 30 findings
- Pattern-collapsed (per master punch list patterns A–F) into **22 tasks** across 3 waves
- Total parallelism: 18 + 3 + 1 = **22 subagent dispatches**
- Excluded: 32 MEDIUM, 21 LOW, 21 INFO findings (separate phase — see master punch list)

---

## Coverage matrix — every CRIT/HIGH finding maps to one task

| Finding | Domain | Severity | Task | File(s) |
|---|---|---|---|---|
| CRIT-1 / data C-01 | data | CRIT | T04 | `src/derivation/persist.ts`, `src/derivation/runner.ts` |
| CRIT-2 / err C-01 | ux | CRIT | T05 | `app/routes/__root.tsx` |
| CRIT-3 / err C-02 (plans) | ux | CRIT | T06a | `app/routes/(app)/_layout/plans/index.tsx` |
| CRIT-3 / err C-02 (detectors) | ux | CRIT | T06b | `app/routes/(app)/_layout/detectors/index.tsx` |
| CRIT-4 / A-01 (BulkTagDialog) | a11y | CRIT | T20 | `app/routes/(app)/_layout/trades/index.tsx` (uses Modal from T01) |
| CRIT-5 / A-02 (ImportDialog) | a11y | CRIT | T22 | `app/routes/(app)/_layout/detectors/index.tsx` (uses Modal from T01) |
| CRIT-6 / A-03 | a11y | CRIT | T07 | `app/routes/(app)/_layout/import.tsx` |
| CRIT-7 / A-04 (trades rows) | a11y | CRIT | T20 | `app/routes/(app)/_layout/trades/index.tsx` |
| CRIT-7 / A-04 (plans rows) | a11y | CRIT | T21 | `app/routes/(app)/_layout/plans/index.tsx` |
| CRIT-7 / A-04 (detectors rows) | a11y | CRIT | T22 | `app/routes/(app)/_layout/detectors/index.tsx` |
| sec H1 | sec | HIGH | T10 | `app/routes/api/demo.tsx` |
| sec H2 (csvContent max) | sec | HIGH | T09 | `src/server/import.ts` |
| sec H3 (validateCsvImport demo guard) | sec | HIGH | T09 | `src/server/import.ts` |
| data H-01 (planSnapshot preserved) | data | HIGH | T04 | `src/derivation/persist.ts`, `src/derivation/runner.ts` |
| data H-02 (autoMatchPlansFn WHERE guard) | data | HIGH | T11 | `src/jobs/planMatcher.ts` |
| data H-03 (fillCount on duplicates) | data | HIGH | T12 | `src/ingestion/orchestrator.ts` |
| data H-04 (rule version filter) | data | HIGH | T13 | `src/server/rules.ts` |
| err H-01 (FindingsSidebar onError) | ux | HIGH | T18 | `src/components/dashboard/FindingsSidebar.tsx` |
| err H-02 (toggleMut onSuccess) | ux | HIGH | T06b | `app/routes/(app)/_layout/detectors/index.tsx` |
| err H-03 (HL wallet double-submit) | ux | HIGH | T07 | `app/routes/(app)/_layout/import.tsx` |
| err H-04 (CSV confirm double-submit) | ux | HIGH | T07 | `app/routes/(app)/_layout/import.tsx` |
| err H-05 (DemoReadonlyError toasts) | ux | HIGH | T02 + T23 | `src/lib/toastError.ts` (new) + 15 call sites |
| api H-01 (csvContent) | api | HIGH | T09 | dup of sec H2 |
| api H-02 (getBtcEquityContext range) | api | HIGH | T15 | `src/server/market.ts` |
| api H-03 (getDashboardBundle LIMIT) | api | HIGH | T14 | `src/server/dashboard.ts` |
| api H-04 (previewCustomDetector) | api | HIGH | T16 | `src/server/customDetectorsPreview.ts` |
| A-05 (--fg-faint contrast) | a11y | HIGH | T03 | `src/styles/globals.css` |
| A-06 (primary btn contrast) | a11y | HIGH | T03 | `src/styles/globals.css` |
| A-07 (--pnl-down contrast) | a11y | HIGH | T03 | `src/styles/globals.css` |
| A-08 (--fg-subtle contrast) | a11y | HIGH | T03 | `src/styles/globals.css` |
| A-09 (form labels) | a11y | HIGH | T08 | 3 detail routes |
| A-15 (focus-visible) | a11y | HIGH | T03 | `src/styles/globals.css` |
| A-23 (heatmap kbd) | a11y | HIGH | T17 | `src/components/dashboard/Heatmap.tsx` |

---

## Wave 1 — 18 parallel tasks (primitives + atomic fixes)

> All Wave-1 tasks touch disjoint files. Dispatch in a single message with 18 `Agent()` calls (or two sub-batches of ~9 each). Every task below is written as a ready-to-paste prompt: title, goal, files, steps, acceptance, verification.

---

### T01 — Build `Modal` primitive (Pattern C seed)

**Goal.** Create a reusable accessible dialog primitive that BulkTagDialog (Wave 2 T20) and ImportDialog (Wave 2 T22) will migrate to.

**Files (write NEW):**
- `src/components/tj/Modal.tsx`

**Context.** Read `src/components/tj/primitives.tsx` to match the existing component style, styling tokens, and the `.tj-card` / `.tj-chip` CSS class conventions. Read `app/routes/(app)/_layout/trades/index.tsx` lines 108–250 (BulkTagDialog) and `app/routes/(app)/_layout/detectors/index.tsx` lines 426–504 (ImportDialog) so the primitive covers both use cases.

**Requirements:**
- Exports `<Modal open onClose title children>` and optionally a `<ModalFooter>` slot helper.
- Root element is a backdrop `<div>` with `position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: grid; place-items: center; z-index: 50;` and `onClick` → `onClose`.
- Inner dialog is a `<div>` with `role="dialog"`, `aria-modal="true"`, `aria-labelledby="<generated id>"`, and `onClick` of `e.stopPropagation()` so clicks inside do not dismiss.
- Title renders in an `<h2 id={generatedId}>` inside a `.tj-card`-styled container.
- **Focus trap.** On open, focus the first focusable element inside the dialog. On Tab/Shift-Tab, loop within the dialog (query focusables: `button, [href], input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])`). You can do this inline (~30 lines of a `useEffect`) — no external dependency.
- **Esc closes.** `useEffect` attaches a `keydown` listener on `document` while `open`, calls `onClose` on `Escape`.
- **Focus restore.** On open, capture `document.activeElement` as the previous focus. On close (via any path), restore focus to that element.
- No portal is required — TanStack router renders into `#app` and absolute positioning is sufficient. But if you want to use `createPortal` to `document.body`, that's fine.

**Acceptance criteria:**
- Manual keyboard walkthrough: open via prop, Tab cycles within; Shift-Tab cycles backwards; Esc closes; backdrop click closes; clicks inside do not close; focus returns to previous element on close.
- `pnpm typecheck` passes.
- No existing usage of this component yet (Wave 2 will migrate consumers) — do NOT modify `trades/index.tsx` or `detectors/index.tsx`.

**Verification commands:**
```
pnpm typecheck
pnpm test
```

---

### T02 — Build `toastError` helper (Pattern B seed)

**Goal.** Create a single source of truth for surfacing `unknown` errors to the user, collapsing `DemoReadonlyError` stringification, stripping `Error: ` prefixes, and using `toast.info` for expected guards.

**Files (write NEW):**
- `src/lib/toastError.ts`

**Context.** Read `src/auth/assertNotDemo.ts` to confirm the `DemoReadonlyError` class shape and its `.code === 'demo_mode_readonly'`. Read a couple of existing `onError: (err) => toast.error(String(err))` sites (e.g., `app/routes/(app)/_layout/settings/index.tsx:25`, `app/routes/(app)/_layout/detectors/index.tsx:137`) to understand current usage.

**Requirements:**
- Signature: `export function toastError(err: unknown, opts?: { prefix?: string }): void`.
- Behavior:
  - If `err instanceof DemoReadonlyError` (or `(err as { code?: string }).code === 'demo_mode_readonly'`), call `toast.info('Sign in to save changes — you're in demo mode.')` and return.
  - If `err instanceof Error`, build message as `opts?.prefix ? \`${opts.prefix}: ${err.message}\` : err.message` and call `toast.error(message)`.
  - Fallback: `toast.error(opts?.prefix ? \`${opts.prefix}: Something went wrong\` : 'Something went wrong')`.
- Import `toast` from the same package currently used across the app (`sonner`).
- Export is default-import-unfriendly; name the export `toastError` and use a named import everywhere.

**Acceptance criteria:**
- Unit test in `src/lib/toastError.test.ts` covering: DemoReadonlyError → `toast.info`; generic Error → `toast.error` with stripped message; unknown non-Error → fallback; `prefix` option prepends correctly.
- `pnpm typecheck` passes; `pnpm test` passes.
- No call sites migrated yet — Wave 3 T23 handles the rollout.

**Verification commands:**
```
pnpm typecheck
pnpm test src/lib/toastError.test.ts
```

---

### T03 — `globals.css` sweep: focus-visible + contrast tokens (Patterns A + E)

**Goal.** One CSS change fixes six HIGH a11y findings (A-05, A-06, A-07, A-08, A-14, A-15, A-26) by restoring focus rings across interactive classes and raising contrast tokens to WCAG AA.

**Files:**
- `src/styles/globals.css`

**Context.** Read `src/styles/globals.css` in full. Pay attention to the `--fg-faint`, `--fg-subtle`, `--accent`, `--pnl-down` token definitions (around lines 32–33, 74–75, and the `:root` block), and the `.tj-focus:focus-visible` rule (around line 438). Read the contrast check table in `docs/qa/2026-04-24-accessibility-audit.md` — it has the exact target ratios.

**Changes:**

1. **Contrast tokens** (Pattern E; fixes A-05, A-06, A-07, A-08):
   - `--fg-faint: #525252;` → `--fg-faint: #8a8a8a;` (≈ 4.58:1 on bg-base; restores AA for body text usage).
   - `--fg-subtle: #737373;` → `--fg-subtle: #9e9e9e;` (≈ 5.54:1 on bg-elevated; fixes table headers, captions).
   - `--pnl-down: #dc2626;` → `--pnl-down: #f87171;` (≈ 4.5:1 on dark surfaces).
   - Primary button: in `.tj-btn-primary`, change the accent fill so white-on-accent passes 4.5:1. Simplest: keep `--accent: #ea580c` elsewhere (hover state etc.) but darken `.tj-btn-primary { background: #c2410c; }` (≈ 4.57:1 on white). If `--accent` is used as the default button background via `var(--accent)`, add a `--accent-btn: #c2410c` token and reference that in `.tj-btn-primary` rules only.
   - Verify none of the value changes ripple into unrelated components — read grep of `var(--fg-faint)`, `var(--fg-subtle)`, `var(--pnl-down)` usage first.

2. **Focus-visible rules** (Pattern A; fixes A-15, A-14, A-26):
   - Add this block (near the existing `.tj-focus:focus-visible` rule):
     ```css
     .tj-btn:focus-visible,
     .tj-chip:focus-visible,
     .tj-nav-pill:focus-visible,
     .tj-tab:focus-visible,
     .tj-seg button:focus-visible,
     .tj-avatar-menu:focus-visible,
     .tj-input:focus-visible,
     .tj-textarea:focus-visible {
       outline: none;
       box-shadow: 0 0 0 2px var(--focus-ring);
       border-color: var(--accent);
     }
     ```
   - If `--focus-ring` is not defined, add it to `:root` as `--focus-ring: #ea580c;` (or a dedicated accessible ring color with ≥ 3:1 against both `--bg-base` and `--bg-elevated`).

**Do NOT:**
- Touch any `.tsx` file.
- Introduce new class names that would break existing markup.

**Acceptance criteria:**
- Manual check: Tab through TopBar, a form, a list table, a chip — every focus stop must show a visible ring.
- Devtools contrast inspector on `.tj-faint`, `.tj-subtle`, `.tj-down` against `--bg-elevated` — all must read ≥ 4.5:1.
- `pnpm typecheck` passes; `pnpm test` passes; `pnpm build` passes (no CSS syntax errors).

**Verification commands:**
```
pnpm typecheck
pnpm build
```

---

### T04 — `persistDerivation` hardening: transaction wrap + planSnapshot preservation (CRIT-1 + data H-01)

**Goal.** Close two data-integrity findings with one coordinated change in the derivation persistence layer.

**Files:**
- `src/derivation/persist.ts`
- `src/derivation/runner.ts`
- Possibly `src/domain/position.ts` (only if needed to carry the snapshot fields through the Position type — see api M-05 note, but don't chase it; do the minimum).

**Context.** Read `src/derivation/persist.ts` start-to-end; the 12 delete/insert pairs span lines 24–157. Read `src/derivation/runner.ts:61` where plan linkage is re-attached. Read `src/server/trades.ts:200–212` to understand how `planSnapshot*` values are consumed. Read the H-01 and C-01 descriptions in `docs/qa/2026-04-24-data-integrity-audit.md`.

**Changes:**

1. **Transaction wrap (CRIT-1).** Wrap the entire body of `persistDerivation` in `await db.transaction(async (tx) => { ... })`. Replace every `db.delete(...)` / `db.insert(...)` / `db.update(...)` call inside the function with the equivalent `tx.delete(...)` etc. Do not leave any call on the outer `db`.
   - Neon's HTTP adapter supports `transaction`. If the `db` import is the Neon HTTP client, confirm `db.transaction` is available; if not, switch the import site to use the full Neon client (check how existing `hlWalletPullFn` / `composeDigestFn` handle transactions — if nothing in the codebase uses `.transaction`, read Neon docs via the `drizzle-orm/neon-http` reference: `neonConfig` / `neon()` clients and the `db.transaction(callback)` Drizzle method). Goal: all deletes + inserts commit atomically so readers see either the old or new data, never the in-between empty state.

2. **planSnapshot preservation (data H-01).** Before the `DELETE FROM position` step, fetch the existing rows' `planSnapshotEntryPrice`, `planSnapshotStopPrice`, `planSnapshotTargetPrice`, `planSnapshotSize`, and `planSnapshotRationale` columns keyed by `position.id`. Build a `snapshotMap: Map<positionId, snapshotCols>`.
   - In `runner.ts:61` where `planLinkMap` is built, also build `planSnapshotMap` from the old rows so the new rows can carry them through. Or simpler: in `persistDerivation`, fetch the old snapshots inline (inside the transaction) before delete, and re-apply them during insert.
   - When re-inserting positions, for each `position` row about to be inserted, look up its old snapshot (by `position.id`, which is deterministic — same ID across derivation runs when the underlying fills haven't changed) and set the five snapshot columns on the insert payload.
   - If a position is new (no old snapshot), leave the columns NULL.

**Do NOT:**
- Change the derivation version logic.
- Touch `getTradeDetail` in `trades.ts`.
- Introduce a new `position_plan_snapshot` table (alternative suggested in H-01 description — too much scope for this task).

**Acceptance criteria:**
- `pnpm typecheck` passes.
- Add a test in `src/derivation/persist.test.ts` (or extend an existing one): after `persistDerivation` runs, if a position had `planSnapshotStopPrice = '100'` before, it still has `planSnapshotStopPrice = '100'` after.
- Add a test that concurrent reads during `persistDerivation` do not observe empty state. (Easier stub: spy on the transaction callback to confirm it's invoked; check that all deletes + inserts go through the tx handle. Full concurrent-read test is hard without a real DB — if the test harness uses an in-memory / real Postgres, do the read-during-write test; otherwise assert structurally via `tx.delete` being called.)
- `pnpm test` passes.

**Verification commands:**
```
pnpm typecheck
pnpm test src/derivation
```

---

### T05 — Root `errorComponent` (CRIT-2)

**Goal.** Prevent a white screen on any route-component crash.

**Files:**
- `app/routes/__root.tsx`

**Context.** Read `app/routes/__root.tsx` in full. Read how TanStack Router's `createRootRoute` exposes `errorComponent`. Check one sibling route (e.g., `app/routes/(app)/_layout/trades/$positionId.tsx` has a `DetailError` component near line 116–136) for the visual treatment style (`.tj-card`, "Something went wrong" copy, reload link).

**Changes:**
- Add `errorComponent: RootErrorBoundary` to the `createRootRoute(...)` options.
- Define `RootErrorBoundary` as a `function` component that renders a centered `.tj-card` with:
  - Title "Something went wrong"
  - One-line description: "An unexpected error prevented this page from loading."
  - A reload button: `<button type="button" className="tj-btn tj-btn-primary" onClick={() => window.location.reload()}>Reload page</button>`
  - Optionally a `<pre>` with `error.message` inside a `<details>` block for debug; keep it collapsible.
- The component receives `{ error, reset }` from the TanStack Router API. If `reset` is provided, wire a secondary "Try again" button to it.
- Add `role="alert"` on the outer container so screen readers announce it.

**Do NOT:**
- Add error boundaries to every route — root-level is enough.
- Restructure imports.

**Acceptance criteria:**
- Manually force a crash in a route (throw in a component) and confirm the boundary renders instead of a blank page. (Revert the forced crash after verifying.)
- `pnpm typecheck` passes; `pnpm test` passes; `pnpm build` passes.

**Verification commands:**
```
pnpm typecheck
pnpm build
```

---

### T06a — `/plans` list query error card (CRIT-3 half)

**Goal.** Distinguish network failure from "no plans yet" on the plans index.

**Files:**
- `app/routes/(app)/_layout/plans/index.tsx`

**Context.** Read the file in full. The `useQuery` at lines 16–24 only destructures `{ data, isLoading }`. Read the `EmptyState` component usage in the same file for styling reference.

**Changes:**
- Destructure `error` (and `isError` if preferred) from `useQuery`.
- After the loading check and before the empty check, render:
  ```tsx
  if (!isLoading && error) {
    return (
      <div className="tj-card" role="alert" style={{ padding: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Couldn't load plans</div>
        <div style={{ fontSize: 13, color: 'var(--fg-subtle)' }}>
          Something went wrong loading your plans. Try reloading.
        </div>
        <button type="button" className="tj-btn tj-btn-sm" style={{ marginTop: 12 }}
                onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
  ```
  Keep style/copy consistent with the existing empty-state card in this file.

**Do NOT:**
- Touch `detectors/index.tsx` (that's T06b).
- Touch the row-keyboard-access problem (that's Wave 2 T21).

**Acceptance criteria:**
- Force a query error (kill the server fn or block the network in devtools) and confirm the error card renders instead of EmptyState.
- `pnpm typecheck` passes; `pnpm test` passes.

**Verification commands:**
```
pnpm typecheck
```

---

### T06b — `/detectors` list query error card + toggleMut onSuccess (CRIT-3 half + err H-02)

**Goal.** Two small related polish fixes in the same file.

**Files:**
- `app/routes/(app)/_layout/detectors/index.tsx`

**Context.** Read the file in full. The `useQuery` for the detector list lives near the top and suffers the same error-vs-empty confusion as `plans/index.tsx`. The `toggleMut` is defined around lines 165–180.

**Changes:**

1. **Query error card (CRIT-3).** Same pattern as T06a. Destructure `error` from the custom-detector list query; render an error card (matching the `.tj-card` styling used elsewhere in the file) when `!isLoading && error`.

2. **toggleMut onSuccess (err H-02).** Add `onSuccess: (_, vars) => toast.success(vars.enabled ? 'Detector enabled' : 'Detector disabled')` to `toggleMut`. Keep the existing `onError` as-is; T23 will replace it with `toastError` in the sweep.

**Do NOT:**
- Touch the ImportDialog yet (that's Wave 2 T22).
- Touch the row-keyboard-access problem (that's Wave 2 T22).
- Migrate to `toastError` yet (that's Wave 3 T23).

**Acceptance criteria:**
- Force a query error → error card renders.
- Toggle a custom detector → success toast appears.
- `pnpm typecheck` passes; `pnpm test` passes.

**Verification commands:**
```
pnpm typecheck
```

---

### T07 — `/import` polish: keyboard drop-zone + both double-submit guards (CRIT-6 + err H-03 + err H-04)

**Goal.** Make the CSV drop-zone keyboard-accessible and disable both the HL wallet "Fetch trades" and CSV "Import N rows" buttons while their respective mutations are in-flight.

**Files:**
- `app/routes/(app)/_layout/import.tsx`

**Context.** Read the file in full. The drop-zone is around lines 133–170. `HLWalletCard`'s "Fetch trades" is at 322–330 with a plain `onStart` async function. `CsvUploadCard`'s "Import N rows" is at 206–210 inside a `useCallback`-wrapped `onConfirm`.

**Changes:**

1. **Drop-zone (CRIT-6).** Either convert the `<div onClick={() => fileRef.current?.click()}>` to a `<button type="button" onClick={...}>` (preferred — native keyboard + focus), or keep the `<div>` and add:
   - `role="button"`
   - `tabIndex={0}`
   - `aria-label="Upload CSV file — click or press Enter to browse, or drag and drop"`
   - `onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() } }}`
   - A `:focus-visible` outline (or rely on the new `.tj-focus` style from T03 by adding the class).

2. **HL wallet double-submit (err H-03).** Add `const [isStarting, setIsStarting] = useState(false)`. Wrap the `onStart` body in `try { setIsStarting(true); ... } finally { setIsStarting(false) }`. On the button, change `disabled={!address.trim()}` to `disabled={!address.trim() || isStarting}`. Add a pending label: show `"Starting…"` when `isStarting`.

3. **CSV confirm double-submit (err H-04).** Same pattern on `onConfirm`: add a local `isConfirming` state, toggle it around the mutation call, and `disabled={isConfirming}` on the "Import N rows" button. Show `"Importing…"` label while pending.

**Do NOT:**
- Touch `src/server/import.ts` (that's T09).
- Migrate toasts to `toastError` (that's T23).

**Acceptance criteria:**
- Tab to the drop-zone → visible focus → Enter opens file picker.
- Click "Fetch trades" twice fast → only one import kicked off; button shows "Starting…" briefly.
- Click "Import N rows" twice fast → same.
- `pnpm typecheck` passes; `pnpm test` passes.

**Verification commands:**
```
pnpm typecheck
```

---

### T08 — Form labels on detail routes (A-09)

**Goal.** Connect every `<label>` to its input via `htmlFor` / `id` pairs in three form routes.

**Files:**
- `app/routes/(app)/_layout/plans/new.tsx` (lines 81–201 — Symbol, Direction, Entry, Target, Stop, Planned size, Rationale)
- `app/routes/(app)/_layout/plans/$planId.tsx` (lines 299–389 — PlanEditForm)
- `app/routes/(app)/_layout/detectors/$detectorId.tsx` (lines 456–504 — DetectorEditForm)

**Context.** Read each of the three files' form sections. The existing markup uses either inline `style={{}}` labels or styled `<div>`s as labels with no `htmlFor`. Inputs have no `id`.

**Changes:**
- For every `<label>` that currently lacks `htmlFor`, add a unique `id` on its paired `<input>` / `<textarea>` / `<select>` and set `htmlFor` on the label to match. Namespace IDs to avoid collisions: e.g., `plan-new-symbol`, `plan-edit-symbol-${planId}`, `detector-edit-name`.
- If the existing element is a styled `<div>` pretending to be a label, convert it to a `<label htmlFor="...">` (the CSS tokens should still work since `<label>` accepts the same props).
- For the Direction radio/segmented control on plan forms, either (a) wrap the group in a `<fieldset>` with a `<legend>` (preferred), or (b) add `role="radiogroup"` and `aria-label` to the container. Keep existing markup working; do not refactor Segmented here (that's a MEDIUM finding, separate phase).

**Do NOT:**
- Touch `plans/index.tsx` or `detectors/index.tsx` (those are T06a/b).
- Refactor the Segmented component itself (MEDIUM A-16, separate phase).
- Change visual layout.

**Acceptance criteria:**
- Click any `<label>` on these forms → the paired input gains focus.
- Screen reader walkthrough (or devtools accessibility tree): every input has an accessible name.
- `pnpm typecheck` passes; `pnpm test` passes.

**Verification commands:**
```
pnpm typecheck
pnpm build
```

---

### T09 — `import.ts` hardening: csvContent + fileName caps + validateCsvImport demo guard (sec H2 + sec H3 + api H1)

**Goal.** Close three high-severity import-surface findings in one file.

**Files:**
- `src/server/import.ts`

**Context.** Read lines 16–100 of `src/server/import.ts`. `validateCsvInput` is around 16–19; `startCsvImportInput` is around 37–41. `validateCsvImport` handler at 21–35 has a session check but no `assertNotDemo`. `startCsvImport` at 49+ does have `assertNotDemo`.

**Changes:**

1. **csvContent size cap (sec H2 / api H1).** On both `validateCsvInput` and `startCsvImportInput`, change `csvContent: z.string().min(1)` to `csvContent: z.string().min(1).max(50 * 1024 * 1024)`. (50 MB hard cap.)

2. **fileName length cap (sec L3 bonus, cheap).** On `startCsvImportInput`, change `fileName: z.string().optional()` to `fileName: z.string().max(255).optional()`. This is a LOW finding but covered by the same file touch.

3. **validateCsvImport demo guard (sec H3).** In the `validateCsvImport` handler, immediately after the `if (!session?.user) throw new Error('Unauthorized')` line, add `assertNotDemo(session.user)`. Match the import style used in `startCsvImport` below (same file).

**Do NOT:**
- Touch `app/routes/(app)/_layout/import.tsx` (that's T07).
- Change the adapter validation logic.
- Touch `/api/demo` (that's T10).

**Acceptance criteria:**
- Try to POST a 60 MB `csvContent` → Zod rejects with a clear 400.
- Try to call `validateCsvImport` as a demo user → `DemoReadonlyError` is thrown.
- `pnpm typecheck` passes; `pnpm test` passes (update any existing tests that were checking permissive behavior).

**Verification commands:**
```
pnpm typecheck
pnpm test src/server
```

---

### T10 — `/api/demo`: remove GET handler (sec H1)

**Goal.** Close the CSRF-via-GET auth elevation by making `/api/demo` POST-only.

**Files:**
- `app/routes/api/demo.tsx`

**Context.** Read the file in full. Look at line 83 where the `GET` route delegates to the same `mintDemoSession` handler as `POST`. The comment "allow GET for easy anchor-tag linking" is explicitly called out in the security audit.

**Changes:**
- Remove the `GET` export entirely from the route definition. If the framework requires an explicit `Method Not Allowed` for unmatched methods, return a 405 with `{ error: 'Method Not Allowed' }` — otherwise rely on the framework default.
- Grep the codebase (`grep -r '/api/demo' app src`) for any client-side `<a href="/api/demo">` that depended on GET. If any exist, convert them to a small `<button>` that issues `fetch('/api/demo', { method: 'POST' })` and then navigates / reloads. Update the accompanying visual so the action still reads the same way to the user.

**Do NOT:**
- Weaken the `POST` handler.
- Rewrite Better Auth integration or change cookie semantics.

**Acceptance criteria:**
- `curl -X GET http://localhost:3000/api/demo` → 405 or equivalent non-mint response; no cookie set.
- `curl -X POST http://localhost:3000/api/demo` still mints the demo session.
- The demo-enter affordance still works in the UI (click → demo mode).
- `pnpm typecheck` passes; `pnpm test` passes.

**Verification commands:**
```
pnpm typecheck
pnpm build
```

---

### T11 — `autoMatchPlansFn` WHERE guard (data H-02)

**Goal.** Prevent the auto-matcher from overwriting a manual link created between its fetch and apply steps.

**Files:**
- `src/jobs/planMatcher.ts`

**Context.** Read the file, focusing on lines 76–140. The UPDATE at ~line 135 currently has `.where(and(eq(position.id, m.positionId), eq(position.userId, userId)))` — missing the `planId IS NULL` guard.

**Changes:**
- Add `isNull(position.planId)` to the UPDATE WHERE clause:
  ```ts
  .where(and(
    eq(position.id, m.positionId),
    eq(position.userId, userId),
    isNull(position.planId),
  ))
  ```
- Import `isNull` from `drizzle-orm` if not already imported.
- Optionally log a warning when a write ended up matching 0 rows (meaning the plan was linked manually in the window) — use the existing `log.warn` helper if present. Keep this minimal.

**Do NOT:**
- Reduce concurrency settings (that's a separate MEDIUM M-04 concern).
- Change the fetch-phase query.

**Acceptance criteria:**
- Add a unit test that calls the auto-matcher after manually setting `planId` on a position — the manual link must survive.
- `pnpm typecheck` passes; `pnpm test` passes.

**Verification commands:**
```
pnpm typecheck
pnpm test src/jobs
```

---

### T12 — `fillCount` returns-based counting (data H-03)

**Goal.** Stop inflating `fillCount` on re-imports where `onConflictDoNothing` skipped rows.

**Files:**
- `src/ingestion/orchestrator.ts`

**Context.** Read lines 70–110. The loop increments `fillCount++` unconditionally after `db.insert(...).onConflictDoNothing()`.

**Changes:**
- Switch the insert to return only actually-inserted rows and count those:
  ```ts
  const inserted = await db.insert(fill).values(row).onConflictDoNothing().returning({ id: fill.id })
  if (inserted.length > 0) fillCount++
  ```
  Or, if Drizzle's returning doesn't play well with the current shape, use the affected-rowCount pattern available via the driver. Whatever form, only increment when a row actually made it in.
- Apply the same logic to any sibling insert loops in the file that feed `fillCount` (search for `fillCount++` within the file).

**Do NOT:**
- Change the outer import-record lifecycle.
- Add a new DB column.

**Acceptance criteria:**
- Unit test: given 5 fills all already present (unique-constraint collision), a second import run produces `fillCount === 0`.
- `pnpm typecheck` passes; `pnpm test` passes.

**Verification commands:**
```
pnpm typecheck
pnpm test src/ingestion
```

---

### T13 — `getRuleViolationsThisWeek` version filter (data H-04)

**Goal.** Only count findings at the current `DERIVATION_VERSION` when computing weekly rule violations.

**Files:**
- `src/server/rules.ts`

**Context.** Read lines 90–130. `getRuleViolationsThisWeek` fetches findings without a `derivationVersion` filter.

**Changes:**
- Add `eq(finding.derivationVersion, DERIVATION_VERSION)` to the WHERE clause of the finding fetch.
- Import `DERIVATION_VERSION` from the existing constant location (search the file; other server functions in this directory already import it).
- If a sibling `digestFacts.ts:229` has the same issue, leave it — that's inside a separate domain and not in the HIGH list for this batch. Scope check: only modify `src/server/rules.ts`.

**Do NOT:**
- Touch the fact-builder files.
- Migrate to a different FK model.

**Acceptance criteria:**
- Unit test: seed a finding at version N-1 and one at version N, both referencing an active position. `getRuleViolationsThisWeek` must return 1, not 2.
- `pnpm typecheck` passes; `pnpm test` passes.

**Verification commands:**
```
pnpm typecheck
pnpm test src/server
```

---

### T14 — `getDashboardBundle` SQL LIMIT for findings (api H-03)

**Goal.** Push the "top 5 by severity" selection into SQL instead of loading every finding into memory.

**Files:**
- `src/server/dashboard.ts`

**Context.** Read lines 375–460. The current code fetches all findings for `(userId, version)` and then filters + sorts + slices in JS.

**Changes:**
- Replace the unbounded fetch with a query that:
  1. WHERE includes `eq(finding.userId, userId)` and `eq(finding.derivationVersion, version)`.
  2. When `ids.length > 0`, add a PostgreSQL array-overlap filter using Drizzle's `sql` tagged template:
     ```ts
     sql`${finding.referencedPositionIds} && ARRAY[${sql.join(ids.map(id => sql`${id}::text`), sql`,`)}]::text[]`
     ```
  3. ORDER BY severity enum ordering (critical → warning → info) in SQL. Define the ordering in a `CASE` expression if the severity column is a string enum.
  4. LIMIT 25 (a small candidate set; in-JS tiebreak + slice to 5 remains for deterministic ordering within severity).
- Keep the in-JS final slice of 5 as-is — only move the heavy filter/LIMIT into SQL.

**Do NOT:**
- Change the `DashboardFinding` return type (that's api M-06, separate).
- Rewrite the evidence cast (that's api M-06).

**Acceptance criteria:**
- Unit test or integration test: seed 100 findings for a user, call `getDashboardBundle`, confirm the returned `topFindings` has 5 items and the DB received a query with a LIMIT clause.
- `pnpm typecheck` passes; `pnpm test` passes.

**Verification commands:**
```
pnpm typecheck
pnpm test src/server
```

---

### T15 — `getBtcEquityContext` date-range cap (api H-02)

**Goal.** Prevent unbounded Binance fetch loops by capping the allowed date range.

**Files:**
- `src/server/market.ts`

**Context.** Read lines 60–110. The `inputValidator` currently accepts `from: z.string().datetime(), to: z.string().datetime()` with no span refinement.

**Changes:**
- Replace the schema with:
  ```ts
  z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  }).refine((d) => {
    const ms = new Date(d.to).getTime() - new Date(d.from).getTime()
    return ms > 0 && ms <= 365 * 86_400_000
  }, { message: 'Date range must be between 1 day and 365 days' })
  ```
- No handler changes needed — the refine rejects bad input at the validator boundary.

**Do NOT:**
- Change the candle store.
- Change interval defaults.

**Acceptance criteria:**
- Unit test: passing a 2-year range rejects with a validation error; 1-year range passes.
- `pnpm typecheck` passes; `pnpm test` passes.

**Verification commands:**
```
pnpm typecheck
pnpm test src/server
```

---

### T16 — `previewCustomDetector` LIMIT + demo guard (api H-04)

**Goal.** Cap the position fetch and add an `assertNotDemo` guard.

**Files:**
- `src/server/customDetectorsPreview.ts`

**Context.** Read lines 20–80. The handler fetches every position row for the user at the current derivation version, with no limit, and has no demo guard.

**Changes:**
- Add `assertNotDemo(session.user)` after the session check.
- Add `.limit(5000)` to the position query (position rows, plus the tags sub-query if it's per-position).
- In the returned result, set `sample`/`matched`/`total` to reflect the capped set. Add a small `"truncated: true"` flag on the response if total exceeded the limit, so the UI can surface "Preview based on most recent 5,000 positions" if desired. If adding the flag requires a non-trivial UI change, skip the flag and just document the cap as hard; a `console.warn` in dev when truncation happens is sufficient.

**Do NOT:**
- Sample positions differently.
- Change predicate evaluation logic.

**Acceptance criteria:**
- Calling as a demo user → `DemoReadonlyError`.
- Seed > 5,000 positions (or test at small limit first) → response has capped totals.
- `pnpm typecheck` passes; `pnpm test` passes.

**Verification commands:**
```
pnpm typecheck
pnpm test src/server
```

---

### T17 — `Heatmap` keyboard accessibility (A-23)

**Goal.** Make the dashboard heatmap cells keyboard-reachable and screen-reader-labeled.

**Files:**
- `src/components/dashboard/Heatmap.tsx`

**Context.** Read the file in full, focusing on lines 70–110 where each cell is a `<div onMouseEnter onMouseLeave>`.

**Changes:**
- Add to each cell `<div>`:
  - `tabIndex={0}`
  - `role="gridcell"`
  - `aria-label={`${day} ${hour}:00 UTC — ${trades} trades, ${fmtUSD(pnl)}`}` (use the same formatting as the tooltip).
  - `onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showTooltipForCell(...) } }}` — OR, more simply, `onFocus={() => setTooltip(...)}` and `onBlur={() => setTooltip(null)}` so the tooltip shows when a cell is focused via keyboard.
- Wrap the grid container in `<div role="grid" aria-label="Trade heatmap by day of week and hour">`.
- Make sure the new focus ring from T03 is visible on cells — if `.tj-focus` needs to be added explicitly, add it. Or add an inline `:focus-visible` rule local to the component (acceptable one-off).

**Do NOT:**
- Convert the grid to a `<table>` (alternative suggested in A-23 description — too much scope).
- Change the visual layout.

**Acceptance criteria:**
- Tab into the heatmap → focus ring appears on the first cell; arrow-key or Tab navigation between cells works (at minimum Tab — arrow keys are nice-to-have).
- Screen reader announces cell context on focus.
- `pnpm typecheck` passes; `pnpm test` passes.

**Verification commands:**
```
pnpm typecheck
```

---

### T18 — `FindingsSidebar` adopt/archive onError handlers (err H-01)

**Goal.** Surface failures on rule adopt/archive instead of silently no-op-ing.

**Files:**
- `src/components/dashboard/FindingsSidebar.tsx`

**Context.** Read lines 40–60 where `adopt` and `archive` `useMutation`s are declared. Neither has an `onError`.

**Changes:**
- Add `onError: (err) => toast.error('Failed to save rule: ' + String(err))` to both `adopt` and `archive` mutations. (T23 will later migrate this to `toastError(err, { prefix: 'Failed to save rule' })` — leave that for T23 so we don't create a cross-wave dependency; the intermediate state with `String(err)` is acceptable for Wave 1.)
- Ensure the `toast` import is the same `sonner` import used elsewhere.

**Do NOT:**
- Migrate to `toastError` yet (T23).
- Add loading spinners.

**Acceptance criteria:**
- Force an error (e.g., call as demo user, or kill the server fn) → error toast appears.
- `pnpm typecheck` passes; `pnpm test` passes.

**Verification commands:**
```
pnpm typecheck
```

---

## Gate 1 — verify before Wave 2

**Blocking checklist:**
- [ ] All Wave-1 agent subagent returns reviewed; none failed or left TODOs.
- [ ] `pnpm typecheck` — no errors.
- [ ] `pnpm test` — all pass (expect several new test files from T02, T04, T11, T12, T13, T14, T15).
- [ ] `pnpm build` — succeeds.
- [ ] Manual spot-check: load each of `/dashboard`, `/trades`, `/plans`, `/detectors`, `/import`, `/settings`.
- [ ] Tab through TopBar → every focus stop has a visible ring.
- [ ] Force a query error on `/plans` and `/detectors` → error card renders (not EmptyState).
- [ ] On `/import`, Tab to the drop-zone → focus visible → Enter opens file picker.
- [ ] Commit: `git add -A && git commit -m "qa: wave 1 — primitives + atomic fixes (closes 7 CRIT partials + 16 HIGH)"` or split into smaller commits as preferred.

Only if every box above is checked, proceed to Wave 2.

---

## Wave 2 — 3 parallel tasks (consumer migrations)

> Each task owns exactly one list-route file. Dispatch all three in a single message.

---

### T20 — `/trades`: BulkTagDialog → Modal migration + row-kbd verification (CRIT-4 + CRIT-7 trades portion)

**Goal.** Migrate the BulkTagDialog to the `Modal` primitive from T01 and confirm the existing `j/k/Enter` row nav still provides keyboard parity (CRIT-7 says "prefer row-level Link" but the existing nav satisfies the underlying WCAG requirement; this task just verifies and adds `tabIndex={0}` for belt-and-braces).

**Files:**
- `app/routes/(app)/_layout/trades/index.tsx`

**Context.** Read the file in full. `BulkTagDialog` is at 108–250. Row `onClick` handlers are at 524–600. The existing `j/k/Enter` keyboard nav is near the top of the file — search for `useEffect` + `keydown`.

**Changes:**

1. **BulkTagDialog migration (CRIT-4).** Replace the custom backdrop + card markup with:
   ```tsx
   <Modal open={open} onClose={onClose} title="Bulk tag trades">
     {/* existing dialog body */}
   </Modal>
   ```
   - Remove the custom backdrop `<div>` and click-to-close wrapper — `Modal` handles it.
   - Remove any inline focus management in the old dialog — `Modal` handles it.
   - Keep the body content (tag pickers, etc.) exactly as-is.
   - Import `Modal` from `src/components/tj/Modal.tsx`.

2. **Row keyboard parity (CRIT-7 trades portion).** On each `<tr>` that has `onClick`, add `tabIndex={0}` and `onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); navigate(...) } }}`. This complements the bespoke `j/k/Enter` nav — even if j/k isn't used, Tab + Enter now works.

3. **MEDIUM err M-04 (BulkTagDialog tags query):** while in the file, also destructure `isError` from the `tagsData` query inside `BulkTagDialog` (lines 66–71) and render a small "Couldn't load tags. Close and retry." message inside the modal body when `isError` is true. This is a MEDIUM but it's inside the same dialog; opportunistic.

**Do NOT:**
- Migrate any toasts to `toastError` (T23).
- Touch `plans/index.tsx` or `detectors/index.tsx`.

**Acceptance criteria:**
- Open BulkTagDialog → Tab cycles inside, Esc closes, focus returns to trigger.
- Tab to a row → visible focus ring → Enter opens detail.
- `pnpm typecheck` passes; `pnpm test` passes.

**Verification commands:**
```
pnpm typecheck
pnpm build
```

---

### T21 — `/plans`: row keyboard access (CRIT-7 plans portion)

**Goal.** Make each clickable row on `/plans/index.tsx` keyboard-activatable.

**Files:**
- `app/routes/(app)/_layout/plans/index.tsx`

**Context.** Read the file. Clickable rows are at 83–138. T06a has already added an error card; leave that alone.

**Changes:**
- On each `<tr>` with `onClick`, add `tabIndex={0}`, `role="button"` (since `<tr>` is not semantically a button), and `onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); navigate(...) } }}`.
- Preferred alternative: convert the row pattern so the primary cell contains a full-width `<Link>` and drop the row-level `onClick` — but only if the styling survives intact. If that refactor is more than ~10 lines, stick with `tabIndex + onKeyDown`.

**Do NOT:**
- Touch the error card logic (T06a).
- Reshape the table.

**Acceptance criteria:**
- Tab to a plan row → focus ring visible → Enter opens the plan detail.
- `pnpm typecheck` passes; `pnpm test` passes.

**Verification commands:**
```
pnpm typecheck
```

---

### T22 — `/detectors`: ImportDialog → Modal migration + row-kbd access (CRIT-5 + CRIT-7 detectors portion)

**Goal.** Migrate the ImportDialog to the `Modal` primitive and make rows keyboard-activatable.

**Files:**
- `app/routes/(app)/_layout/detectors/index.tsx`

**Context.** Read the file. `ImportDialog` is at 426–504. Clickable rows are at 308–362. T06b has added an error card + toggleMut onSuccess; leave those alone.

**Changes:**

1. **ImportDialog migration (CRIT-5).** Same pattern as T20 — wrap the dialog body in `<Modal open onClose title="Import custom detectors">`. Remove the custom backdrop and focus management. Keep the textarea + preview logic intact.

2. **Row keyboard access (CRIT-7 detectors portion).** Same pattern as T21 on each row `<tr>`.

**Do NOT:**
- Touch `toggleMut` (that was T06b).
- Migrate `window.confirm()` delete confirmations to a new component (that's MEDIUM A-22, separate phase).

**Acceptance criteria:**
- Open ImportDialog → Tab cycles inside, Esc closes.
- Tab to a detector row → focus ring → Enter opens detail.
- `pnpm typecheck` passes; `pnpm test` passes.

**Verification commands:**
```
pnpm typecheck
pnpm build
```

---

## Gate 2 — verify before Wave 3

**Blocking checklist:**
- [ ] All three Wave-2 agents returned clean.
- [ ] `pnpm typecheck` — no errors.
- [ ] `pnpm test` — all pass.
- [ ] `pnpm build` — succeeds.
- [ ] Manual keyboard walkthrough of `/trades`, `/plans`, `/detectors`:
  - Open each modal → Tab stays inside, Esc closes, focus returns to trigger.
  - Tab through rows → focus ring visible → Enter navigates.
- [ ] Commit: `git add -A && git commit -m "qa: wave 2 — modal migrations + row kbd access (closes CRIT-4, CRIT-5, CRIT-7)"`.

Only if every box is checked, proceed to Wave 3.

---

## Wave 3 — 1 task (`toastError` rollout sweep)

> Single agent. Touches many files but the change is a mechanical call-site rewrite; no other wave-3 work runs in parallel, so conflicts are not a concern.

---

### T23 — Roll out `toastError` to every `toast.error(String(err))` call site (err H-05 + Pattern B)

**Goal.** Replace every raw `toast.error(String(err))` / `toast.error('… ' + String(err))` / `toast.error(err.message)` with `toastError(err, { prefix: '...' })` so `DemoReadonlyError` surfaces as a friendly "Sign in to save changes" toast.

**Files (call-sites to update):**
- `app/routes/(app)/_layout/plans/new.tsx:50`
- `app/routes/(app)/_layout/plans/$planId.tsx:44, 278`
- `app/routes/(app)/_layout/trades/$positionId.tsx:176, 184, 597` (the 597 site is err L-01 — autosave)
- `app/routes/(app)/_layout/detectors/new.tsx:442`
- `app/routes/(app)/_layout/detectors/$detectorId.tsx:442, 532, 546`
- `app/routes/(app)/_layout/settings/index.tsx:25`
- `app/routes/(app)/_layout/detectors/index.tsx:137, 157, 178` — NOTE: T06b may have changed line numbers; re-grep.
- `src/components/dashboard/FindingsSidebar.tsx` — the two `onError` handlers added in T18.
- `app/routes/(app)/_layout/digest/index.tsx:114` (MEDIUM err M-06 — opportunistic).
- Any other `toast.error` call sites returned by a repo grep.

**Context.** Read `src/lib/toastError.ts` from T02 to understand the signature. Run `grep -rn "toast.error(" app src` to get the authoritative list (do this first — line numbers drift between waves).

**Changes:**
- For each call site, pick a sensible `prefix` describing the failed action ("Failed to save plan", "Failed to delete detector", "Failed to save note", etc.).
- Replace `toast.error(String(err))` → `toastError(err)`.
- Replace `toast.error('X: ' + String(err))` → `toastError(err, { prefix: 'X' })`.
- Replace `toast.error(err.message)` → `toastError(err)` (`toastError` handles the Error case internally).
- Update imports in each file to include `import { toastError } from '~/lib/toastError'` (or the actual path alias the project uses; see `tsconfig.json` / existing imports for the correct form).
- Remove the now-unused `toast` import **only** if no other call site remains in the file.

**Do NOT:**
- Change success-path `toast.success` or `toast.info` call sites.
- Rewrite the shape of `onError` beyond the stringifier call.
- Touch non-onError contexts.

**Acceptance criteria:**
- `grep -rn "toast.error(String" app src` → returns zero hits.
- `grep -rn "toast.error(err.message)" app src` → returns zero hits.
- Manual walkthrough in demo mode: attempt several mutations (create plan, toggle detector, save note) → each failure toast reads "Sign in to save changes — you're in demo mode." (from the `DemoReadonlyError` branch).
- `pnpm typecheck` passes; `pnpm test` passes; `pnpm build` passes.

**Verification commands:**
```
grep -rn "toast.error(String" app src || echo 'clean'
grep -rn "toast.error(err.message)" app src || echo 'clean'
pnpm typecheck
pnpm build
```

---

## Gate 3 — final verification

**Blocking checklist:**
- [ ] T23 returned clean.
- [ ] `pnpm typecheck` — no errors.
- [ ] `pnpm test` — all pass.
- [ ] `pnpm build` — succeeds.
- [ ] Demo-mode toast walkthrough: every failing mutation produces a friendly message (no raw `"DemoReadonlyError:"`).
- [ ] Commit: `git add -A && git commit -m "qa: wave 3 — toastError rollout (closes err H-05)"`.
- [ ] Open PR: `qa: close 7 CRIT + 23 HIGH from 2026-04-24 audit` — body should reference this plan file and the five source audits.

---

## Parallelism map

```
Wave 1 (18 agents, parallel):
  T01 Modal.tsx (new)           T02 toastError.ts (new)       T03 globals.css
  T04 persist.ts                T05 __root.tsx                T06a plans/index.tsx
  T06b detectors/index.tsx      T07 import.tsx                T08 3 detail-form files
  T09 src/server/import.ts      T10 api/demo.tsx              T11 planMatcher.ts
  T12 orchestrator.ts           T13 rules.ts                  T14 dashboard.ts (server)
  T15 market.ts                 T16 customDetectorsPreview.ts T17 Heatmap.tsx
  T18 FindingsSidebar.tsx

Gate 1: typecheck + test + build + spot-check + commit

Wave 2 (3 agents, parallel):
  T20 trades/index.tsx          T21 plans/index.tsx           T22 detectors/index.tsx

Gate 2: typecheck + test + build + keyboard walkthrough + commit

Wave 3 (1 agent):
  T23 toastError rollout across ~15 files

Gate 3: typecheck + test + build + demo toast walkthrough + commit + PR
```

---

## Appendix — not-yet-addressed items (for later phases, NOT in this plan)

The following are called out in the master punch list but are NOT part of this swarm plan:

- **32 MEDIUM findings** (per-domain details in source audits). Suggested next phase: a second swarm with lighter coordination, or a hand-picked subset addressed during regular feature work.
- **21 LOW findings**: backlog. Address opportunistically.
- **21 INFO observations**: no action unless signals change.
- **Cross-cutting MEDIUM work** that piggy-backs on these waves has been flagged inline (err M-04 in T20, sec L3 `fileName` max in T09, err L-01 autosave toast in T23, err M-06 digest send in T23). Everything else stays out of scope.

**Process note.** If future phases also run through this format, reuse the three-wave structure: primitives + independent fixes → consumer migrations → cross-file sweeps. The first wave is always the biggest and most parallelizable; the last is always the mechanical rollout.
