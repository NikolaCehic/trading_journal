# QA Audit — Master Punch List

**Date:** 2026-04-24
**Method:** 5 parallel code-review subagents, read-only static analysis across security, data integrity, error handling, API contracts, accessibility.
**Source reports:**
- `docs/qa/2026-04-24-security-audit.md`
- `docs/qa/2026-04-24-data-integrity-audit.md`
- `docs/qa/2026-04-24-error-handling-audit.md`
- `docs/qa/2026-04-24-api-contracts-audit.md`
- `docs/qa/2026-04-24-accessibility-audit.md`

---

## Totals

| Domain | CRITICAL | HIGH | MEDIUM | LOW | INFO | Total |
|---|---|---|---|---|---|---|
| Security | 0 | 3 | 4 | 4 | 4 | 15 |
| Data integrity | 1 | 4 | 5 | 4 | 5 | 19 |
| Error handling + UX | 2 | 5 | 7 | 4 | 3 | 21 |
| API contracts | 0 | 4 | 8 | 5 | 5 | 22 |
| Accessibility | 4 | 7 | 8 | 4 | 4 | 27 |
| **Total** | **7** | **23** | **32** | **21** | **21** | **104** |

---

## 7 CRITICAL findings (fix before anything else)

### CRIT-1 · `persistDerivation` is not transactional — concurrent readers see empty data
- **File:** `src/derivation/persist.ts:24–157`
- **Class:** Data integrity (data C-01)
- **Impact:** While a rederive runs, any concurrent `getDashboardBundle` / `buildDigestFacts` / `resolveFilteredPositionIds` call returns zeroed data to the user. They may act on empty KPIs thinking their account was wiped.
- **Fix:** Wrap the full body in `db.transaction(async (tx) => { ... })`. Neon HTTP adapter supports it. All 12 delete/insert pairs must use `tx` instead of `db`.

### CRIT-2 · Root route has no error boundary — white-screen on any component crash
- **File:** `app/routes/__root.tsx:9`
- **Class:** UX (err C-01)
- **Impact:** Any unhandled throw in any route → blank page, no recovery hint.
- **Fix:** Add `errorComponent` to `createRootRoute(...)` rendering a `.tj-card` with a title + reload link. Minimum 10 lines.

### CRIT-3 · `/plans` treats query errors as "no plans" — silent failure
- **File:** `app/routes/(app)/_layout/plans/index.tsx:16–24`
- **Class:** UX (err C-02)
- **Impact:** Network failure is indistinguishable from empty state. User may create duplicate plans thinking the old ones were deleted.
- **Fix:** Destructure `error` from `useQuery` and render a distinct error card. Same check on `/detectors/index.tsx`.

### CRIT-4 · `BulkTagDialog` (/trades) — no focus trap, no Esc handler, no ARIA
- **File:** `app/routes/(app)/_layout/trades/index.tsx:BulkTagDialog`
- **Class:** A11y (A-01)
- **Impact:** Keyboard users Tab past the modal into the obscured page. Screen readers don't announce modal context.
- **Fix:** Add `role="dialog" aria-modal="true" aria-labelledby="..."`; trap focus inside (loop Tab back to first element); handle Escape to close; restore focus to trigger on close.

### CRIT-5 · `ImportDialog` (/detectors) — same modal a11y failures as CRIT-4
- **File:** `app/routes/(app)/_layout/detectors/index.tsx:ImportDialog`
- **Class:** A11y (A-02)
- **Fix:** Same as CRIT-4. Or better — extract a shared `<Modal>` primitive and migrate both dialogs to it.

### CRIT-6 · CSV drop-zone on `/import` is keyboard-inaccessible
- **File:** `app/routes/(app)/_layout/import.tsx`
- **Class:** A11y (A-03)
- **Impact:** A plain `<div onClick>` drop-zone means keyboard-only users cannot import trades at all. The core data-entry path is gated.
- **Fix:** Convert the drop-zone trigger to a real `<button type="button">` that opens the file picker (or keep the div but add `role="button" tabIndex={0}` + keyboard Enter/Space handler + visible focus ring).

### CRIT-7 · Clickable `<tr>` rows unreachable by keyboard on `/trades`, `/plans`, `/detectors`
- **File:** Multiple — `trades/index.tsx`, `plans/index.tsx`, `detectors/index.tsx`
- **Class:** A11y (A-04)
- **Impact:** `/trades` has `j/k/Enter` keyboard nav (Phase 6), but `/plans` and `/detectors` don't. Keyboard users on those pages have no way to enter a row unless they find the "Edit" action button inside it.
- **Fix:** Either add keyboard nav to both (parity with `/trades`) or make each row-level Link explicitly the clickable element (row becomes a flex container with a full-width Link). Prefer the latter — simpler, standard a11y.

---

## Top HIGH findings (23 total)

### Security (3 HIGH)
- **H1 (sec) · `/api/demo` accepts GET** — image/link CSRF can silently log users into demo mode. Fix: POST-only + require a same-origin check.
- **H2 (sec) · `csvContent` unbounded** — authenticated user can POST a multi-GB body and crash Node. Fix: `z.string().max(10 * 1024 * 1024)` (10 MB cap).
- **H3 (sec) · `validateCsvImport` missing `assertNotDemo`** — demo users can probe adapter parse logic. Fix: add the guard.

### Data integrity (4 HIGH)
- **H-01 · `planSnapshot*` wiped on rederive** — `persist.ts` delete/insert cycle NULLs the snapshot columns; `getTradeDetail` silently falls back to live plan values, defeating the snapshot's purpose. Fix: either persist snapshot cols through rederive, OR recompute adherence from denormalized data.
- **H-02 · `autoMatchPlansFn` race with manual link** — UPDATE step lacks `WHERE planId IS NULL` guard; a manual link between fetch and apply is silently overwritten. Fix: add the guard to the UPDATE.
- **H-03 · `fillCount` inflated on re-import** — `orchestrator.ts:85` increments the counter even when `onConflictDoNothing` skipped a duplicate. Fix: check row affected-count.
- **H-04 · `getRuleViolationsThisWeek` missing `derivationVersion` filter** — counts findings from stale versions, skewing the digest rules UI. Fix: add `eq(finding.derivationVersion, DERIVATION_VERSION)`.

### Error handling + UX (5 HIGH)
- **H-01 (err) · `FindingsSidebar` adopt/archive** — `useMutation` has no `onError`. Silent failure.
- **H-02 (err) · Custom detector list toggle** — missing `onSuccess`; optimistic update may desync.
- **H-03 (err) · HL wallet import double-submit** — button not disabled while pending.
- **H-04 (err) · CSV import confirm double-submit** — same.
- **H-05 (err) · `DemoReadonlyError` raw string** — 10+ mutations toast `String(err)` producing ugly "Error: DemoReadonlyError". Fix: wrap in a `toastError(err)` helper that special-cases `DemoReadonlyError` → friendly copy.

### API contracts (4 HIGH)
- **H-01 (api) · `csvContent` unbounded** — duplicate of sec H2 from different angle.
- **H-02 (api) · `getBtcEquityContext` unbounded date range** — enables unbounded Binance fetch loop. Fix: cap to 2 years.
- **H-03 (api) · `getDashboardBundle` loads ALL user findings** before slicing to top 5. O(n) on every dashboard view. Fix: ORDER BY + LIMIT in SQL.
- **H-04 (api) · `previewCustomDetector` loads ALL user positions** into memory per call. Same class. Also missing demo guard. Fix: sample at DB level; add guard.

### Accessibility (7 HIGH)
- **A-05 · `--fg-faint` (#525252) fails WCAG AA** — 2.53:1 contrast ratio. Used throughout for "subtle" text. Fix: bump to `#6e6e6e` (~3.5:1) or restrict to ≥18pt use only.
- **A-06 · White text on accent (#ea580c) fails AA** — 3.56:1. Used on primary buttons. Fix: darken accent to `#c44a0a` (4.5:1) OR use `#0a0a0a` text on the orange button.
- **A-07 · `--pnl-down` (#dc2626) fails AA on elevated bg** — 3.13:1. Breaks loss readability. Fix: bump to `#ef4444`.
- **A-08 · `--fg-subtle` (#737373) fails AA** on elevated bg — used for captions.
- **A-09 · Form labels lack `htmlFor`** in `/plans/new`, `/plans/$planId`, `/detectors/$detectorId`. Inputs are unlabeled to screen readers. Fix: add `htmlFor` + `id` pairs everywhere.
- **A-15 · `.tj-focus` utility class exists but is applied to NOTHING.** Every button/chip/link in the app has an invisible focus ring. Systemic. Fix: change `.tj-btn:focus-visible` (and chip / nav-pill / tab) CSS rules directly in `globals.css`.
- **A-23 · Heatmap cells are mouse-only** — no keyboard inspection on dashboard.

---

## MEDIUM findings (32) — fix after CRIT + HIGH

Summary-only; full detail in source reports.

**Security:** key reuse (auth-secret as HMAC too); raw userId in unsubscribe token; LLM-call TOCTOU gap on budget; demo cookie prefix logic drift.

**Data:** `adoptRule` check-then-insert races (missing unique constraint); missing DB-side transaction on `startCsvImport`; stale FK references in `finding.referencedPositionIds`; coach-note cache never invalidated; LossStreaks rebuilt per detector call.

**UX:** 7 items — raw `String(err)` in trade-detail; plan/detector detail no-404 variant; dead "Sync" button on dashboard; BulkTagDialog query error unhandled; digest send button reachable by demo; settings toggle can double-fire; `FillsChart` subtitle misleading on error.

**API:** 8 items — `listCustomDetectors` passthrough validator; `getDashboardBundle` return type unannotated; `DashboardFinding.evidence` type lie; `CoachFactBundle.rMultiple` hardcoded `null`; several missing batch-size caps; type drift between `Position` domain and schema (`planId`, `rMultiple` added without domain sync); `exportAllData` has no size limit.

**A11y:** 8 items — `Segmented` missing `role="radiogroup"`; `ToggleSwitch` unnamed; `window.confirm()` for destructive actions; SVG charts have no accessible alternative; Sign-out `<a>` should be `<button>` (POST-worthy action); `.tj-*` elements don't apply focus ring class.

---

## LOW (21) — backlog, fix at leisure

Copy quality in error messages, unused nice-to-haves (skip-link, prefers-reduced-motion), minor info leaks (console.warn logging userId), `Math.random()` for importId (use crypto), shell table headers missing `scope`, etc.

---

## INFO (21) — observations, not bugs

Prompt-injection surface via user notes (mitigated by grounding validator), user email in LLM prompt (expected), `<main>` landmark missing (visual-only issue), CoachNarrative silent failure on referenced-positions query is acceptable UX, duplicated predicate-editor code across two routes, etc.

---

## Cross-cutting patterns (fix once, help many)

Multiple findings share a root cause. Fixing these pulls the count down significantly:

### Pattern A: Missing focus ring → A-15, A-14, A-26
One 15-line CSS change in `src/styles/globals.css` wires `:focus-visible` box-shadows onto `.tj-btn`, `.tj-chip`, `.tj-nav-pill`, `.tj-tab`, `.tj-input`, `.tj-textarea`. Fixes 3 findings + improves the overall feel.

### Pattern B: Ugly error toasts → err H-05 + MEDIUMs
One helper `toastError(err: unknown)` in `src/lib/toastError.ts` that:
- Recognizes `DemoReadonlyError` → "Sign in to save changes"
- Recognizes `Error('Not found')` → "Not found"
- Falls through with a sensible `err.message`-stripped prefix

Replace every `toast.error(String(err))` call with `toastError(err)`. ~15 call sites.

### Pattern C: Modal a11y → CRIT-4, CRIT-5, MED `window.confirm`
One `<Modal>` primitive in `src/components/tj/Modal.tsx`:
- `role="dialog"`, `aria-modal`, `aria-labelledby`
- Focus trap via `useFocusTrap` hook (~30 lines inline, no dep)
- Esc to close, backdrop click to close
- Focus restoration on close

Migrate `BulkTagDialog`, `ImportDialog`, and the delete confirmations (replacing `window.confirm`). 3 CRIT/MED findings → 0.

### Pattern D: Unbounded inputs → sec H2, api H1, H2, H3, H4, M batch caps
Add `.max()` to every string input that's stored and every array input that's iterated. One-line zod change per call site. Sec H2 + api H1 collapse into one fix.

### Pattern E: Contrast → A-05, A-06, A-07, A-08
Tune four color tokens in `globals.css` (`--fg-faint`, `--fg-subtle`, `--accent` variant for buttons, `--pnl-down`). ~5 minutes of work fixes 4 findings.

### Pattern F: Query error states → CRIT-3, MED `/detectors` query, MED BulkTagDialog tags query
Every `useQuery` consumer must destructure `error` and render an error card. One codemod: grep every `useQuery` invocation in `app/routes/**/*.tsx` → ensure `error` is handled.

---

## Recommended fix order (3 passes)

### Pass 1 — the 7 CRITICALs + Pattern B + Pattern E
~2–3 hours. Ships the "no one gets stranded" baseline. Converts the accessibility story from "broken" to "passable".

### Pass 2 — 23 HIGH (grouped via Patterns A, C, D, F)
~1 full day. Kills most of the top-severity findings with systemic fixes rather than per-site touch-ups.

### Pass 3 — MEDIUM batch
Probably a focused phase of its own. Not urgent.

### Leave on backlog: LOW + INFO
Document, don't fix. Revisit if/when user feedback surfaces them.
