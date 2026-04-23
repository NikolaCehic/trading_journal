# Error Handling + UX Audit — 2026-04-24

**Auditor:** Claude Sonnet 4.6 (subagent, code-review mode)
**Scope:** useMutation/useQuery handlers, empty states, loading skeletons, copy quality, double-submit, error boundaries, demo-mode UX, accessibility of error states.

---

## Summary

| Severity | Count |
|---|---|
| CRITICAL | 2 |
| HIGH | 5 |
| MEDIUM | 7 |
| LOW | 4 |
| INFO | 3 |
| **Total** | **21** |

---

## CRITICAL

### C-01: No error boundary in `__root.tsx` — component crashes produce a white screen

- **File:** `app/routes/__root.tsx:9`
- **Observation:** `createRootRoute` has no `errorComponent` defined and no React ErrorBoundary wrapping the `children` render. If any route component throws synchronously (e.g. a `!bundle` access lands on null unexpectedly, or a library throws), the entire app crashes to a blank white page.
- **User impact:** User sees nothing; no message, no recovery path.
- **Fix:** Add an `errorComponent` to `createRootRoute`, or wrap `{children}` in a React ErrorBoundary that renders a "Something went wrong — reload" card.

---

### C-02: `/plans` — `useQuery` error state never rendered; data access silently proceeds

- **File:** `app/routes/(app)/_layout/plans/index.tsx:16-24`
- **Observation:** The query destructures only `{ data, isLoading }` — `error` is not destructured. When the query fails, `isLoading` becomes `false`, `data` is `undefined`, and `rows` falls to `[]` (via `?? []`). The component then renders the EmptyState "No plans yet" — indistinguishable from genuinely having no plans. There is no error path.
  ```tsx
  const { data, isLoading } = useQuery({ ... })  // error not destructured
  const rows = data?.filter(...) ?? []            // silently []  on error
  ```
- **User impact:** A network failure looks identical to having no plans. User may create duplicate plans believing existing ones were lost.
- **Fix:** Destructure `error` and render a distinct error card when `!isLoading && error`.

---

## HIGH

### H-01: `FindingsSidebar` — `adopt` and `archive` mutations have no `onError` handler

- **File:** `src/components/dashboard/FindingsSidebar.tsx:47-56`
- **Observation:** Both `adopt` and `archive` mutations are declared without `onError`. If the server call fails (network, demo guard, etc.), the UI silently stays in the previous state with no feedback.
  ```tsx
  const adopt = useMutation({
    mutationFn: () => adoptRule(...),
    onSuccess: (res) => setAdoptedRuleId(res.ruleId),
    // ← no onError
  })
  const archive = useMutation({
    mutationFn: (ruleId) => archiveRule(...),
    onSuccess: () => setAdoptedRuleId(null),
    // ← no onError
  })
  ```
- **User impact:** Silent failure. In demo mode this will throw `DemoReadonlyError` and nothing happens visually — user clicks "Adopt this rule" repeatedly.
- **Fix:** Add `onError: (err) => toast.error('Failed to save rule: ' + String(err))` to both mutations.

---

### H-02: `/detectors` — `toggleMut` (custom detector list toggle) has no `onSuccess` feedback

- **File:** `app/routes/(app)/_layout/detectors/index.tsx:165-180`
- **Observation:** `toggleMut` uses optimistic updates and has `onError` (good), but has no `onSuccess`. The toggle flips visually before the server confirms, but if the request succeeds there is no confirmation. More importantly, a failed toggle with `onError` rolls back silently with only `toast.error(String(err))`, which for a `DemoReadonlyError` would display the raw error name/message.
- **User impact:** No success feedback; raw internal error string on demo-mode block.
- **Fix:** Add `onSuccess: () => toast.success(enabled ? 'Detector enabled' : 'Detector disabled')`. For demo errors, use the human-readable message from the error (see H-05).

---

### H-03: `/import` — `HLWalletCard` — "Fetch trades" button is not disabled while `onStart` is in-flight

- **File:** `app/routes/(app)/_layout/import.tsx:322-330`
- **Observation:** `onStart` is a plain `async` function (not a `useMutation`). The button is only `disabled={!address.trim()}`. If the user clicks quickly a second time while `startWalletImport` is awaiting, a second import job is started for the same address.
  ```tsx
  <button
    type="button"
    className="tj-btn tj-btn-primary"
    onClick={onStart}
    disabled={!address.trim()}   // ← no in-flight guard
  >
  ```
- **User impact:** Duplicate import jobs; duplicate fills may be ingested (depends on server-side idempotency).
- **Fix:** Add an `isStarting` state flag, set it during `onStart`, and add `disabled={!address.trim() || isStarting}`.

---

### H-04: `/import` — `CsvUploadCard` — "Import N rows" button not disabled while `onConfirm` is in-flight

- **File:** `app/routes/(app)/_layout/import.tsx:206-210`
- **Observation:** `onConfirm` is a `useCallback` async function. While `step === 'confirming'`, clicking "Import N rows" multiple times before the step transitions to `'importing'` can send multiple `startCsvImport` calls. The button shows no pending state.
  ```tsx
  {validation.valid && (
    <button type="button" className="tj-btn tj-btn-primary tj-btn-sm" onClick={onConfirm}>
      Import {validation.rowCount} rows  {/* ← no disabled guard */}
    </button>
  )}
  ```
- **User impact:** Double-submission risk; fills imported twice.
- **Fix:** Add a local `isConfirming` boolean and set `disabled={isConfirming}` on this button.

---

### H-05: Demo-mode errors surface as raw `DemoReadonlyError` string across all mutations

- **File:** Multiple — all mutations using `onError: (err) => toast.error(String(err))`:
  - `app/routes/(app)/_layout/plans/new.tsx:50`
  - `app/routes/(app)/_layout/plans/$planId.tsx:44, 278`
  - `app/routes/(app)/_layout/trades/$positionId.tsx:176, 184`
  - `app/routes/(app)/_layout/detectors/new.tsx:442`
  - `app/routes/(app)/_layout/detectors/$detectorId.tsx:442, 532, 546`
  - `app/routes/(app)/_layout/settings/index.tsx:25`
  - `app/routes/(app)/_layout/detectors/index.tsx:137, 157, 178`
- **Observation:** `String(err)` produces `"DemoReadonlyError: Writes are disabled in demo mode. Sign in with your own account to save changes."` — the class name prefix makes it look like an internal crash rather than an expected guard. The actual message text is good (`src/auth/assertNotDemo.ts:4`), but the prefix ruins it.
- **User impact:** Demo users see "DemoReadonlyError: …" which reads as a bug report, not a helpful notice.
- **Fix:** In all `onError` handlers, check for `DemoReadonlyError.code === 'demo_mode_readonly'` (or `err instanceof DemoReadonlyError`) and show `toast.info('Sign in to save changes — you're in demo mode.')` instead of `toast.error(String(err))`.

---

## MEDIUM

### M-01: `/trades/$positionId` — generic error message shows raw `String(error)` to the user

- **File:** `app/routes/(app)/_layout/trades/$positionId.tsx:136`
- **Observation:** When `isNotFound` is false (any error other than "Not found"), the fallback renders `String(error)` directly:
  ```tsx
  <div style={{ fontSize: 13, color: 'var(--fg-subtle)' }}>{String(error)}</div>
  ```
  This exposes stack traces, internal server error descriptions, or `Error: ...` prefixes.
- **User impact:** User sees "Error: Internal Server Error" or similar cryptic messages.
- **Fix:** Replace with a static message like "Something went wrong loading this trade. Try reloading." and log the actual error to the console.

---

### M-02: `/plans/$planId` and `/detectors/$detectorId` — error state has no not-found variant

- **File:** `app/routes/(app)/_layout/plans/$planId.tsx:48-56`, `app/routes/(app)/_layout/detectors/$detectorId.tsx:554-563`
- **Observation:** Both error states render "Could not load plan." / "Could not load detector." regardless of whether the error is a 404 (resource deleted) or a network failure. Compare to the excellent not-found handling in `/trades/$positionId` (lines 116-129).
- **User impact:** Navigating to a deleted plan's URL shows "Could not load plan" with no back link and no explanation.
- **Fix:** Mirror the `DetailError` pattern from `/trades/$positionId.tsx` — detect "Not found" in the error string and render a proper "Plan not found" card with a "Back to plans" CTA.

---

### M-03: `/detectors/$detectorId` — `save` mutation (`updateCustomDetector`) invalidates only the single-detector query, not the list

- **File:** `app/routes/(app)/_layout/detectors/$detectorId.tsx:436-440`
- **Observation:** After saving edits, `queryClient.invalidateQueries({ queryKey: ['detector', detector.id] })` and `queryClient.invalidateQueries({ queryKey: ['detectors'] })` are both called. This is fine. However, the `onSaved` callback in `DetectorDetailPage` just calls `setEditing(false)` — the view switches back to read-only without the fresh query data being re-fetched until the staleTime expires (30s). Since the page's `data` variable comes from the `['detector', detectorId]` query, the invalidation should trigger a re-fetch. This is fine — but the user gets no visual indication the save succeeded (the toast fires, the form closes) which in aggregate is acceptable. Flagging for completeness.
- **User impact:** Minor — toast fires, edit form closes, data refreshes within 30s.
- **Fix:** No action required; already good.

---

### M-04: `/trades/index` — `tagsData` query in `BulkTagDialog` has no error handling

- **File:** `app/routes/(app)/_layout/trades/index.tsx:66-71`
- **Observation:** The tags query in `BulkTagDialog` only destructures `{ data: tagsData, isLoading: tagsLoading }`. If the tag list fails to load, the dialog renders nothing in the tag lists (because `tagsData?.setup ?? []` evaluates to `[]`) and the user sees only "None" — no indication of failure.
- **User impact:** User thinks there are no tags; may create duplicates.
- **Fix:** Destructure `isError` from the query and render "Couldn't load tags. Close and retry." if `isError` is true.

---

### M-05: `Sync` button on dashboard is a dead button (no click handler)

- **File:** `app/routes/(app)/_layout/dashboard.tsx:127-129`
- **Observation:** The "Sync" button has no `onClick` handler:
  ```tsx
  <button type="button" className="tj-btn tj-btn-sm">
    <Icon name="refresh" size={12} /> Sync
  </button>
  ```
- **User impact:** User clicks "Sync" expecting a refresh; nothing happens. No spinner, no feedback.
- **Fix:** Either wire it to `queryClient.invalidateQueries({ queryKey: ['dashboard'] })` (and show a brief loading state), or remove the button if the feature is not yet implemented and add it back when ready.

---

### M-06: `/digest` — `sendDigestNow` error message is generic

- **File:** `app/routes/(app)/_layout/digest/index.tsx:114`
- **Observation:** `onError: (err) => toast.error('Could not send: ' + String(err))`. When a demo user clicks "Send this to me now", they will see `"Could not send: DemoReadonlyError: Writes are disabled in demo mode..."`. The button is not disabled for demo users explicitly (only when `data.failed`).
- **User impact:** Demo user sees a confusing error when trying to send.
- **Fix:** Disable the send button when `u?.isDemo` is true, with a tooltip "Sign in to receive real digests."

---

### M-07: `/settings` — `toggleDigest` fires immediately on toggle click; no pending state disables the switch

- **File:** `app/routes/(app)/_layout/settings/index.tsx:20-25, 82`
- **Observation:** `toggleDigest.mutate(v)` is called directly from `onChange`. The `ToggleRow` component has a `disabled` prop but it's only set to `u?.isDemo`. The `toggleDigest.isPending` state is never passed to `disabled`, so clicking the toggle rapidly fires multiple mutations.
- **User impact:** Double-submit race; the final state may not match the user's intent.
- **Fix:** Pass `disabled={u?.isDemo || toggleDigest.isPending}` to `ToggleRow`.

---

## LOW

### L-01: Notes tab autosave — error copy includes raw `String(err)` suffix

- **File:** `app/routes/(app)/_layout/trades/$positionId.tsx:597`
- **Observation:** `onError: (err) => { setSaving(false); toast.error('Failed to save note: ' + String(err)) }`. The `String(err)` suffix is useful for debugging but potentially leaks internals. In demo mode this fires: "Failed to save note: DemoReadonlyError: Writes are disabled...".
- **User impact:** Minor — demo users see the full error chain instead of "Writes are disabled in demo mode."
- **Fix:** Strip the `DemoReadonlyError` prefix using the same pattern as H-05.

---

### L-02: `/trades/index` — error card copy is terse and has no retry affordance

- **File:** `app/routes/(app)/_layout/trades/index.tsx:439-448`
- **Observation:** On query error, the component renders "Couldn't load trades." with no retry button and no further context.
- **User impact:** User has no obvious recovery action besides a full page reload.
- **Fix:** Add a "Retry" button that calls `queryClient.invalidateQueries({ queryKey: ['tradeList', ...] })` or a page reload link.

---

### L-03: `/plans/index` — loading skeleton for `PlansSkeleton` uses fixed rows without a header row

- **File:** `app/routes/(app)/_layout/plans/index.tsx:144-152`
- **Observation:** `PlansSkeleton` renders 4 rectangle rows inside a card — no column header skeletons. When loading, the layout abruptly shifts from skeleton to a table with headers. Minor jank.
- **User impact:** Minor layout jank on load.
- **Fix:** Include a header skeleton row matching the real table's column layout.

---

### L-04: `/trades/$positionId` — `FillsChart` query has no `isError` branch

- **File:** `app/routes/(app)/_layout/trades/$positionId.tsx:1207-1232`
- **Observation:** `FillsChart` destructures `{ data, isLoading }` from the candles query but not `error`. If the candles fetch fails (non-null error, `data` undefined), the `!data || !data.supported` branch renders `FillsSvgOnly` — which is acceptable fallback behavior. However, the subtitle still says "Loading candles…" (set in `useEffect` when `isLoading` is true, never updated on error since `data` remains undefined and `data?.supported` is falsy — so it falls through to "Price candles unavailable"). Acceptable but could be clearer.
- **User impact:** On error, user sees the fills-only view with "Price candles unavailable" — slightly misleading.
- **Fix:** In the `useEffect`, add an `isError` check and set `onSubtitle('Could not load price candles — falls back to fills-only view')`.

---

## INFO

### I-01: No `errorComponent` on any individual route — TanStack Router's default behavior applies

- **File:** All route files in `app/routes/(app)/`
- **Observation:** No route defines `errorComponent`. TanStack Router's default behavior when an error is thrown during a route's loader or server function is to propagate upward. Without an `errorComponent` on the root route (C-01 above), this will cause a white screen.
- **Fix:** At minimum fix C-01. Optionally, add route-level `errorComponent` definitions for finer-grained recovery.

---

### I-02: `CoachNarrative` — `getPositionsByIds` query has no `isError` or `isLoading` feedback

- **File:** `src/components/trades/CoachNarrative.tsx:14-19`
- **Observation:** Referenced position query uses `{ data: refs = [] }` — errors silently fall to an empty array, which simply hides the "Referenced" section. This is acceptable product behavior (referenced positions are supplementary), but worth noting for consistency.
- **User impact:** Minimal — if referenced positions fail to load, the section just disappears rather than showing a partial error.
- **Fix:** No action required.

---

### I-03: `LeafEditor` / `PredicateGroupEditor` — identical code duplicated across `detectors/new.tsx` and `detectors/$detectorId.tsx`

- **File:** `app/routes/(app)/_layout/detectors/new.tsx:31-199`, `app/routes/(app)/_layout/detectors/$detectorId.tsx:52-248`
- **Observation:** Both files contain full copies of `LeafEditor`, `PredicateGroupEditor`, `LeafReadOnly`, `GroupReadOnly`, and the `usePreview` hook. Any future bug fix or UX improvement must be applied in two places.
- **User impact:** None currently — but a future discrepancy will cause inconsistent behavior.
- **Fix:** Extract shared components into `src/components/detectors/PredicateEditor.tsx`.

---

## Route-by-route empty-state matrix

| Route | Loading | Error | Empty | Not-found |
|---|---|---|---|---|
| `/dashboard` | ✓ skeleton (KPI tiles + chart placeholder) | ✓ inline error card | ✓ `EmptyState` with Import CTA | N/A |
| `/trades` | ✓ skeleton table rows | ✓ terse card "Couldn't load trades." (no retry) | ✓ `EmptyState` no-trades + filter-zero case | N/A |
| `/trades/$positionId` | ✓ `DetailSkeleton` | ✓ not-found + generic variants | N/A (single item) | ✓ "Position not found" card with back link |
| `/plans` | ✓ `PlansSkeleton` | **✗ missing** — shows EmptyState "No plans yet" on error (C-02) | ✓ `EmptyState` per filter | N/A |
| `/plans/$planId` | ✓ `PlanSkeleton` | ✓ "Could not load plan." (no not-found variant — M-02) | N/A | ✗ no distinct not-found message |
| `/plans/new` | N/A | N/A (mutation-only) | N/A | N/A |
| `/detectors` | ✓ `DetectorsSkeleton` | **✗ missing** — `isLoading: false, data: undefined` renders `rows = []`, shows EmptyState "No custom detectors" | ✓ `EmptyState` | N/A |
| `/detectors/$detectorId` | ✓ `Skeleton` | ✓ "Could not load detector." (no not-found variant — M-02) | N/A | ✗ no distinct not-found message |
| `/detectors/new` | N/A | N/A (mutation-only) | N/A | N/A |
| `/import` | N/A (no full-page useQuery) | HL wallet: inline error string ✓; CSV: inline error string ✓ | ✓ "No imports yet." text in history card | N/A |
| `/digest` | ✓ `PreviewSkeleton` | ✓ `PreviewError` card | ✓ `PreviewNoData` — "No closed trades this week yet" | N/A |
| `/settings` | N/A (reads from session synchronously) | N/A | N/A | N/A |

**Legend:** ✓ = handled, ✗ = gap, N/A = not applicable

---

## Accessibility of error states

No error message anywhere in the codebase uses `role="alert"` or `aria-live`. Errors rendered in the DOM (inline error divs, error cards) are purely visual — screen readers will not announce them unless focus moves to the element. The Sonner toast library (`<Toaster />`) does add ARIA live-region markup internally, so toast-based errors are announced. Inline error text added to the DOM without focus management is not.

**Affected areas:** All inline error `<div>` elements in import cards, trade detail `DetailError`, plan/detector error cards.

**Fix:** Add `role="alert"` to any error `<div>` that appears without user focus (i.e., the container that changes from a non-error to an error state). This is especially important for:
- `app/routes/(app)/_layout/import.tsx:171` (CSV error div)
- `app/routes/(app)/_layout/import.tsx:332` (HL wallet error div)
- `app/routes/(app)/_layout/dashboard.tsx:168-181` (dashboard error card)
