# Accessibility + Keyboard Audit — 2026-04-24

**Auditor:** Claude Sonnet 4.6 (subagent, code-review mode)
**Scope:** Focus indicators, semantic HTML, keyboard traps, color contrast, icon labeling, ARIA patterns, reduced motion.

---

## Summary

| Severity | Count |
|---|---|
| CRITICAL | 4 |
| HIGH | 7 |
| MEDIUM | 8 |
| LOW | 4 |
| INFO | 4 |
| **Total** | **27** |

---

## Findings by severity

---

### A-01: BulkTagDialog — no focus trap, no keyboard close, no ARIA dialog role

- **File:** `app/routes/(app)/_layout/trades/index.tsx:108–250`
- **Issue:** The modal backdrop is a plain `<div>` with `onClick={onClose}`. There is no `role="dialog"`, no `aria-modal="true"`, no `aria-labelledby`, no focus trap, and no `Escape` key handler on the dialog itself. A keyboard user who manages to Tab into it can Tab right out into the obscured page behind it. Screen reader users get no dialog announcement.
- **WCAG reference:** 2.1.2 No Keyboard Trap (users cannot escape = CRITICAL); 4.1.2 Name, Role, Value; 2.1.1 Keyboard
- **Fix:**
  ```tsx
  // On the outer backdrop div:
  <div role="dialog" aria-modal="true" aria-labelledby="bulk-tag-title" ...>
    // Add onKeyDown on the dialog card to trap Tab and close on Escape
  ```
  Use `useEffect` to trap focus inside the dialog and restore focus to the trigger button on close. At minimum add `onKeyDown={(e) => e.key === 'Escape' && onClose()}` to the dialog card div.

---

### A-02: ImportDialog (detectors) — same modal a11y failures as A-01

- **File:** `app/routes/(app)/_layout/detectors/index.tsx:426–504`
- **Issue:** Same pattern as A-01 — no `role="dialog"`, no `aria-modal`, no focus trap, no `Escape` handler, no `aria-labelledby`. The `<textarea>` inside the modal can be reached but Tab will escape the modal.
- **WCAG reference:** 2.1.2, 4.1.2, 2.1.1
- **Fix:** Same pattern as A-01. Add `role="dialog" aria-modal="true" aria-labelledby="import-dialog-title"` to the dialog card. Add an `id` to the heading `<div>`. Focus-trap with Tab cycling within the modal.

---

### A-03: CSV drop-zone on /import is keyboard-inaccessible

- **File:** `app/routes/(app)/_layout/import.tsx:133–170`
- **Issue:** The file drop zone is a `<div onClick={() => fileRef.current?.click()}>`. There is no `role`, no `tabIndex`, no `onKeyDown` handler, no `aria-label`. A keyboard user cannot reach or activate it. The hidden `<input type="file">` is `display: none` (not just visually hidden), so it receives no focus either.
- **WCAG reference:** 2.1.1 Keyboard (CRITICAL — file upload is completely blocked for keyboard-only users)
- **Fix:** Either make the `<div>` a `<button>` or add `role="button" tabIndex={0} aria-label="Upload CSV file — click or drag and drop" onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}`. Alternatively use `<label htmlFor="csv-file-input">` wrapping the zone and give the input an accessible name.

---

### A-04: Table rows with `onClick` but no keyboard activation on /trades, /plans, /detectors

- **File:** `app/routes/(app)/_layout/trades/index.tsx:524–600` (each `<tr onClick>`)
- **File:** `app/routes/(app)/_layout/plans/index.tsx:83–138`
- **File:** `app/routes/(app)/_layout/detectors/index.tsx:308–362`
- **Issue:** `<tr onClick={() => navigate(...)}>` is used across three pages to make rows navigate-on-click. Table rows are not focusable by default and cannot be activated by keyboard. The `/trades` page has a bespoke `j/k/Enter` keyboard nav workaround, but `/plans` and `/detectors` have no equivalent — keyboard users are completely stranded on those pages.
- **WCAG reference:** 2.1.1 Keyboard (CRITICAL for /plans and /detectors)
- **Fix for /plans and /detectors:** Either add `tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(...)}` to each `<tr>`, or replace clickable rows with a `<Link>` wrapping the primary cell, giving keyboard users a focusable target. For /trades the bespoke nav covers the gap, but adding `tabIndex={0}` to rows is still correct practice.

---

### A-05: `--fg-faint` (#525252) fails WCAG AA for normal text in all contexts

- **File:** `src/styles/globals.css:75` (`.tj-faint`)
- **Issue:** `--fg-faint: #525252` yields contrast ratios of **2.53:1** on `--bg-base`, **2.29:1** on `--bg-surface`, and **1.94:1** on `--bg-elevated`. WCAG AA requires 4.5:1 for normal text (<= 18px) and 3:1 for large text. This color is used as body text in multiple places: hint text in forms, the "save" status indicator text, fill timestamps, KPI footnotes.
- **WCAG reference:** 1.4.3 Contrast (Minimum) — FAIL
- **Fix:** Replace `--fg-faint: #525252` with at minimum `#6b6b6b` (≈ 3.0:1 on bg-base) for decorative-only uses, or `#737373` (--fg-subtle, 4.18:1) wherever the text conveys information.

---

### A-06: White text on accent primary button fails WCAG AA

- **File:** `src/styles/globals.css:216–221` (`.tj-btn-primary`)
- **Issue:** `color: #fff` on `background: var(--accent)` = `#ea580c` yields **3.56:1** contrast. WCAG AA requires 4.5:1 for the 13px button label text.
- **WCAG reference:** 1.4.3 Contrast (Minimum) — FAIL
- **Fix:** Darken the accent to approximately `#c2410c` (the hover state) for the default state as well — `#ffffff` on `#c2410c` gives ≈ 4.57:1 — or use black text (`#000`) on the current orange.

---

### A-07: `--pnl-down` (#dc2626) on elevated backgrounds fails WCAG AA for normal text

- **File:** `src/styles/globals.css:32–33` (`.tj-down`, `.tj-side-short`, `.tj-chip-down`)
- **Issue:** `#dc2626` on `--bg-elevated` (#262626) = **3.13:1**. On pnl-down-weak composited background it is **3.83:1**. Both fail 4.5:1 for normal-sized text (12–13px). These appear in SidePill chips, tag chips, and the fills table.
- **WCAG reference:** 1.4.3 Contrast (Minimum) — FAIL
- **Fix:** Use `#f87171` (light red, ≈ 4.5:1 on dark surfaces) for text in dark-theme chips, or darken the background sufficiently. Alternatively add `font-size: 14px; font-weight: 600` to the chips so they qualify as "large text" (3:1 threshold applies).

---

### A-08: `--fg-subtle` (#737373) fails WCAG AA for normal text in elevated contexts

- **File:** `src/styles/globals.css:74` (`.tj-subtle`)
- **Issue:** `#737373` on `--bg-elevated` (#262626) = **3.19:1**; on `--bg-surface` = **3.78:1**. Both fail 4.5:1 for normal-sized text. This token is used for table headers, KPI labels, card subtitles, and form hint text — all conveying meaningful information.
- **WCAG reference:** 1.4.3 Contrast (Minimum) — FAIL on elevated + surface backgrounds
- **Fix:** Use `#8a8a8a` or lighter for these contexts (≈ 4.5:1 on `--bg-elevated`). Alternatively restrict `.tj-subtle` to bg-base contexts where it passes (4.18:1 — borderline pass for large/bold text only).

---

### A-09: All `<label>` elements in forms have no `htmlFor` — inputs are unlabeled

- **File:** `app/routes/(app)/_layout/plans/new.tsx:81–201` (Symbol, Direction, Entry, Target, Stop, Planned size, Rationale)
- **File:** `app/routes/(app)/_layout/plans/$planId.tsx:299–389` (PlanEditForm)
- **File:** `app/routes/(app)/_layout/detectors/$detectorId.tsx:456–504` (DetectorEditForm)
- **Issue:** Every `<label>` in these forms is a styled `<div>` or inline style `<label>` element with no `htmlFor` attribute. The adjacent `<input>` elements have no `id`. Screen readers announce these inputs as unlabeled. Clicking the label text does not focus the input.
- **WCAG reference:** 1.3.1 Info and Relationships; 4.1.2 Name, Role, Value — HIGH
- **Fix:** Add matching `id` to each `<input>` / `<textarea>` and `htmlFor` to each `<label>`:
  ```tsx
  <label htmlFor="plan-symbol" ...>Symbol</label>
  <input id="plan-symbol" className="tj-input" ... />
  ```

---

### A-10: `SeverityDot` carries no accessible text — severity is visual-only

- **File:** `src/components/tj/primitives.tsx:118–120`
- **Issue:** `<span className={`tj-dot tj-dot-${level}`} />` renders a 6×6px colored dot with no text content, no `aria-label`, no `title`, no `role`. Screen readers skip it entirely — findings' severity levels are invisible to non-visual users.
- **WCAG reference:** 1.1.1 Non-text Content — MEDIUM
- **Fix:**
  ```tsx
  export function SeverityDot({ level }: { level: 'red' | 'amber' | 'neutral' }) {
    const label = level === 'red' ? 'Critical' : level === 'amber' ? 'Warning' : 'Info'
    return (
      <span className={`tj-dot tj-dot-${level}`} role="img" aria-label={`Severity: ${label}`} />
    )
  }
  ```

---

### A-11: `FindingCard` is a clickable `<div>` with no ARIA role or keyboard activation

- **File:** `src/components/tj/primitives.tsx:122–155`
- **Issue:** `FindingCard` renders a `<div onClick={onClick}>` with `cursor: pointer`. It has no `role`, no `tabIndex`, and no keyboard handler. Keyboard-only users cannot activate findings in the sidebar.
- **WCAG reference:** 2.1.1 Keyboard; 4.1.2 Name, Role, Value — MEDIUM
- **Fix:** Add `role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick?.()}` when `onClick` is provided. Or, if clicking navigates somewhere, wrap content in a `<Link>` / `<a>` instead.

---

### A-12: `TagChip` close button (`tj-chip-close`) is a `<span>` with no keyboard access

- **File:** `src/components/tj/primitives.tsx:158–178`
- **Issue:** The remove button inside `TagChip` is `<span className="tj-chip-close" onClick={onRemove}>`. A `<span>` is not interactive by default — no focus, no keyboard activation, no ARIA role. The same pattern is in `FilterChip` at line 103–113.
- **WCAG reference:** 2.1.1 Keyboard; 4.1.2 Name, Role, Value — MEDIUM
- **Fix:** Replace both `<span className="tj-chip-close" onClick={...}>` instances with:
  ```tsx
  <button
    type="button"
    className="tj-chip-close"
    onClick={(e) => { e.stopPropagation(); onRemove?.() }}
    aria-label="Remove tag"
  >
    <Icon name="x" size={10} />
  </button>
  ```

---

### A-13: Icon-only buttons missing accessible labels throughout

- **File:** `app/routes/(app)/_layout/trades/$positionId.tsx:320–330` — Export JSON button has `title="Export this trade as JSON"` but no `aria-label`. `title` is not announced reliably by all screen readers.
- **File:** `src/components/shell/TopBar.tsx:51–57` — Settings link has `title="Settings"` (same `title` limitation), but no `aria-label`.
- **File:** `app/routes/(app)/_layout/trades/index.tsx:641–650` — Calendar date range button `<Icon name="calendar" /> Apr 16 — 22` has visible text but the button performs no action (it is a dead button with no `onClick`), which is misleading.
- **WCAG reference:** 4.1.2 Name, Role, Value — MEDIUM
- **Fix:** Add `aria-label` to icon-only or title-only interactive elements. Remove or implement the calendar filter button.

---

### A-14: `ToggleSwitch` / `ToggleRow` switches have no visible focus ring

- **File:** `app/routes/(app)/_layout/detectors/index.tsx:61–104` (`ToggleSwitch`)
- **File:** `app/routes/(app)/_layout/settings/index.tsx:165–229` (`ToggleRow`)
- **File:** `app/routes/(app)/_layout/detectors/$detectorId.tsx:359–401` (duplicate `ToggleSwitch`)
- **Issue:** These `<button role="switch">` elements use only inline `style={{}}` and do not include the `.tj-focus` class or any `:focus-visible` rule. The `.tj-btn` class includes no focus-visible styling either. As a result, keyboard focus on these toggles is invisible.
- **WCAG reference:** 2.4.7 Focus Visible — MEDIUM
- **Fix:** Add `className="tj-focus"` to each toggle button (the CSS rule already exists in globals.css at line 438–442 but is not applied). Or add `:focus-visible { outline: 2px solid var(--focus-ring); }` directly to `.tj-btn` in globals.css.

---

### A-15: `.tj-btn`, `.tj-chip`, `.tj-nav-pill`, `.tj-tab` — no `:focus-visible` style

- **File:** `src/styles/globals.css`
- **Issue:** None of the core interactive element classes (`.tj-btn`, `.tj-chip`, `.tj-nav-pill`, `.tj-tab`, `.tj-seg button`, `.tj-avatar-menu`) define a `:focus-visible` rule. The only focus ring is on `.tj-focus:focus-visible` (line 438) — a utility class never applied to any component. Buttons and chips used throughout the app are invisible when focused via keyboard.
- **WCAG reference:** 2.4.7 Focus Visible — MEDIUM
- **Fix:** Add to globals.css:
  ```css
  .tj-btn:focus-visible,
  .tj-chip:focus-visible,
  .tj-nav-pill:focus-visible,
  .tj-tab:focus-visible,
  .tj-seg button:focus-visible,
  .tj-avatar-menu:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--focus-ring);
    border-color: var(--accent);
  }
  ```

---

### A-16: `Segmented` control has no ARIA group/radio pattern

- **File:** `src/components/tj/primitives.tsx:223–246`
- **Issue:** The `Segmented` control renders a `<div className="tj-seg">` containing plain `<button>` elements with `is-active` class. There is no `role="group"`, no `aria-label` on the container, and no indication to screen readers that these buttons form a mutually exclusive selection. Screen readers announce each as an independent button with no relationship.
- **WCAG reference:** 4.1.2 Name, Role, Value — MEDIUM
- **Fix:** Use `role="group"` on the wrapper `<div>` with `aria-label` describing the group, and `aria-pressed` on each button:
  ```tsx
  <div className="tj-seg" role="group" aria-label={/* e.g. "Instrument filter" passed as prop */}>
    {options.map((opt) => (
      <button aria-pressed={value === opt.value} ...>
  ```

---

### A-17: Notes autosave status dot — no live region announcement

- **File:** `app/routes/(app)/_layout/trades/$positionId.tsx:759–765`
- **Issue:** The save status indicator `<span className="tj-dot" .../>` + text `"Saving…"` / `"Saved 2m ago"` updates dynamically but has no `aria-live` region. Screen reader users get no notification when their note saves or fails.
- **WCAG reference:** 4.1.3 Status Messages — MEDIUM
- **Fix:**
  ```tsx
  <div aria-live="polite" aria-atomic="true" style={{ display: 'flex', ... }}>
    <span className="tj-dot" ... />
    {saving ? 'Saving…' : savedAt ? `Saved ${relativeTime(savedAt)}` : 'Not saved yet'}
  </div>
  ```

---

### A-18: No skip-to-content link

- **File:** `app/routes/(app)/_layout.tsx` / `src/components/shell/TopBar.tsx`
- **Issue:** There is no "skip to main content" link. Keyboard users must Tab through the entire TopBar navigation (wordmark link + 5 nav links + settings + sign-out = 8 stops) before reaching any page content on every page load.
- **WCAG reference:** 2.4.1 Bypass Blocks — LOW
- **Fix:** Add a visually hidden skip link as the first focusable element in the layout, revealed on focus:
  ```tsx
  <a href="#main-content" className="sr-only focus:not-sr-only">Skip to content</a>
  <div id="main-content" className="tj-main">...</div>
  ```
  Add `.sr-only` class to globals.css (position absolute, 1×1px clip).

---

### A-19: No `<main>` landmark — content area uses only `<div>`

- **File:** `app/routes/(app)/_layout.tsx:38–42`; all route pages using `<div className="tj-main">`
- **Issue:** The app layout wraps page content in `<div style={{ minHeight: '100vh' }}>` and each page uses `<div className="tj-main">`. There is no `<main>`, `<header>`, or `<footer>` landmark. Screen reader users cannot jump directly to main content using landmark navigation.
- **WCAG reference:** 1.3.6 Identify Purpose; best practice — LOW
- **Fix:** Change the `<div className="tj-main">` wrapper in each page to `<main className="tj-main">`. Change the `.tj-topbar` container in TopBar to `<header className="tj-topbar">`.

---

### A-20: No `@media (prefers-reduced-motion)` — all transitions fire unconditionally

- **File:** `src/styles/globals.css` — multiple `transition:` declarations
- **Issue:** The CSS contains at least 15 `transition:` rules across buttons, chips, cards, nav pills, tabs, progress bar, and the heatmap (`transition: transform 120ms`). None are wrapped in a `prefers-reduced-motion: no-preference` query. Users with vestibular disorders who set "reduce motion" will still see all animations.
- **WCAG reference:** 2.3.3 Animation from Interactions (AAA); best practice under 2.3 — LOW
- **Fix:** Wrap all or most transitions in globals.css:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      transition-duration: 0.01ms !important;
      animation-duration: 0.01ms !important;
    }
  }
  ```

---

### A-21: `<table>` headers lack `scope` attribute

- **File:** `app/routes/(app)/_layout/trades/index.tsx:490–506` (trades table `<th>` elements)
- **File:** `app/routes/(app)/_layout/plans/index.tsx:70–81`
- **File:** `app/routes/(app)/_layout/detectors/index.tsx:298–306`
- **File:** `app/routes/(app)/_layout/import.tsx:424–430`
- **Issue:** All `<th>` elements lack `scope="col"`. Screen readers may not correctly associate header cells with data cells, especially in the fills grid (which uses CSS grid, not a real `<table>`).
- **WCAG reference:** 1.3.1 Info and Relationships — LOW
- **Fix:** Add `scope="col"` to all column headers: `<th scope="col">Symbol</th>`.

---

### A-22: `window.confirm()` for delete confirmations — not accessible

- **File:** `app/routes/(app)/_layout/detectors/index.tsx:183–185`
- **File:** `app/routes/(app)/_layout/detectors/$detectorId.tsx:549–551`
- **Issue:** Deletion uses `window.confirm(...)` which is a native browser dialog. While technically keyboard-accessible, it is not styled to match the design system and may be suppressed by some screen reader / browser combinations. It also provides no way to undo.
- **WCAG reference:** INFO — not a WCAG violation but a UX + a11y concern
- **Fix:** Replace with an inline confirmation state or a proper confirmation dialog component with `role="alertdialog"`.

---

### A-23: `Heatmap` cells are mouse-only interactive divs with no keyboard access

- **File:** `src/components/dashboard/Heatmap.tsx:85–99`
- **Issue:** Each heatmap cell is a `<div onMouseEnter onMouseLeave>` with `cursor: pointer`. There is no `tabIndex`, no `role`, no `aria-label`, and no keyboard handler. The tooltip information (day, hour, P&L, trade count) is entirely inaccessible to keyboard and screen reader users.
- **WCAG reference:** 2.1.1 Keyboard; 1.3.1 Info and Relationships — INFO (data visualization, lower priority)
- **Fix:** Add `role="gridcell"` to each cell with `aria-label={`${day} ${hour}:00 UTC — ${trades} trades, ${fmtUSD(pnl)}`}`. Consider exposing the full data as a `<table>` with a `visually-hidden` CSS class as an alternative representation.

---

### A-24: SVG chart elements (`FillsSvgOnly`, `CandlesAndFills`) have no accessible alternative

- **File:** `app/routes/(app)/_layout/trades/$positionId.tsx:925–994` and `1012–1195`
- **Issue:** The fills timeline SVG has no `<title>`, no `role="img"`, no `aria-label`, and no fallback text content. Screen readers skip it entirely. The chart contains actionable trade price information.
- **WCAG reference:** 1.1.1 Non-text Content — INFO
- **Fix:** At minimum add `role="img" aria-label="Fills timeline chart"` to the `<svg>`. For full accessibility, provide the same data in the `FillsList` table below (already present — this partially satisfies the requirement).

---

### A-25: Sign-out link vs. button misuse

- **File:** `src/components/shell/TopBar.tsx:59–63`
- **Issue:** The sign-out is `<a href="/api/auth/sign-out">` — an anchor tag that triggers a POST-like auth action. This is correct for GET-based sign-out but it navigates away rather than performing an in-page action. The element looks like a button (it contains user info and an avatar) but behaves as a link. It lacks `aria-label` describing its purpose — screen readers would announce the user's email address with no clear action label.
- **WCAG reference:** 4.1.2 Name, Role, Value — INFO
- **Fix:** Add `aria-label="Sign out"` to the anchor, or separate it into a visible "Sign out" text link.

---

### A-26: `plans/$planId.tsx` breadcrumb `<Link>` styled as plain text — no focus ring

- **File:** `app/routes/(app)/_layout/plans/$planId.tsx:63–68`
- **Issue:** The breadcrumb link `<Link to="/plans" style={{ color: 'var(--fg-muted)', textDecoration: 'none' }}>Plans</Link>` has no focus style. Similar unstyled links appear in the detectors breadcrumb at `detectors/$detectorId.tsx:569`.
- **WCAG reference:** 2.4.7 Focus Visible — MEDIUM (grouped into A-15 pattern but file-specific)
- **Fix:** Add `.tj-focus` class or an inline `&:focus-visible` style rule.

---

### A-27: `aria-checked` on `ToggleSwitch` missing `aria-label` — unnamed switch

- **File:** `app/routes/(app)/_layout/detectors/index.tsx:218–240` (built-in detector list)
- **Issue:** Each `ToggleSwitch` has `role="switch" aria-checked` but no `aria-label` or `aria-labelledby`. Screen readers announce "switch, checked/unchecked" with no indication of *which* detector is being toggled. The label text is in a sibling `<div>` with no programmatic connection.
- **WCAG reference:** 4.1.2 Name, Role, Value — MEDIUM
- **Fix:** Pass `aria-labelledby` referencing the detector label `<div>` (add an `id`), or pass `aria-label={m.label}` to each `ToggleSwitch`:
  ```tsx
  <ToggleSwitch
    checked={enabled}
    ariaLabel={m.label}
    onChange={(v) => toggleBuiltin.mutate({ detectorId: m.id, enabled: v })}
  />
  ```

---

## Contrast check table

All ratios computed against `--bg-base: #0a0a0a` unless stated otherwise. WCAG AA requires 4.5:1 for normal text (< 18px / non-bold < 24px), 3:1 for large text or UI components.

| Token | Color | vs bg-base | vs bg-surface (#171717) | vs bg-elevated (#262626) | WCAG AA (normal text) | Use |
|---|---|---|---|---|---|---|
| `--fg` | `#ededed` | **16.91:1** | 15.30:1 | 12.27:1 | Pass | Primary text |
| `--fg-muted` | `#a3a3a3` | **7.85:1** | 7.11:1 | 5.70:1 | Pass | Secondary text |
| `--fg-subtle` | `#737373` | **4.18:1** | 3.78:1 | 3.19:1 | Pass on bg-base only | Tertiary / labels |
| `--fg-faint` | `#525252` | **2.53:1** | 2.29:1 | 1.94:1 | **FAIL all contexts** | Dim / hint text |
| `--accent` | `#ea580c` | **5.56:1** | 5.03:1 | 4.03:1 | Pass on bg-base; fail on elevated | CTAs, active nav |
| `--accent` (as bg, white text) | `#ea580c` | White: **3.56:1** | — | — | **FAIL** | Primary buttons |
| `--pnl-up` | `#16a34a` | **6.01:1** | 5.44:1 | 4.59:1 | Pass on base/surface; borderline on elevated | Win text |
| `--pnl-down` | `#dc2626` | **4.10:1** | 3.71:1 | 3.13:1 | **FAIL all contexts** | Loss text |
| `--pnl-down` on pnl-down-weak | `#dc2626` on `#230d0d` | **3.83:1** | — | Composited: **2.90:1** | **FAIL** | Loss chips |
| `--pnl-up` on pnl-up-weak | `#16a34a` on `#0b1c12` | **5.36:1** | — | Composited: **3.94:1** | Pass on base; fail on elevated | Win chips |
| `#fbbf24` (amber chip) | `#fbbf24` | **11.86:1** | — | — | Pass | Amber / warning chips |
| `#fdba74` (accent-chip text) | `#fdba74` | **11.74:1** | — | — | Pass | Accent chip text |

**Key failures:**
- `--fg-faint` fails in every context — HIGH priority fix.
- `--pnl-down` (dc2626) fails on all dark backgrounds — HIGH priority fix.
- White on accent (primary button) fails — HIGH priority fix.
- `--fg-subtle` fails on bg-surface and bg-elevated — fix needed for elevated table/card contexts.

---

## Modals audit

| Modal | Has `role="dialog"` | `aria-modal` | `aria-labelledby` | Focus trap | Esc closes | Backdrop click closes | Focus restored on close |
|---|---|---|---|---|---|---|---|
| `BulkTagDialog` (`/trades`) | No | No | No | No | No | Yes (onClick) | No |
| `ImportDialog` (`/detectors`) | No | No | No | No | No | Yes (onClick) | No |

Both modals have critical accessibility gaps. Neither traps focus, neither announces itself to screen readers as a dialog, and neither restores focus to the trigger button on close.

---

## Keyboard nav audit

| Route | Documented keys | Coverage | Gaps |
|---|---|---|---|
| `/trades` | `/` search, `j`/`k` navigate, `Enter` open, `x`/`Space` select, `Esc` clear | Good | BulkTagDialog not keyboard-escapable; row Tab focus invisible (no focus ring) |
| `/trades/$positionId` | Toolbar shortcuts `Cmd+B/I/K` in textarea | Partial | Tab bar buttons have no focus ring; Plan chip selects not keyboard-accessible |
| `/plans` | None | **No keyboard nav** | Clickable rows not focusable; keyboard users stranded |
| `/plans/$planId` | Native form only | Minimal | Forms not labeled; breadcrumb link no focus ring |
| `/plans/new` | Native form only | Minimal | Labels not connected to inputs; Segmented has no keyboard group role |
| `/detectors` | None | **No keyboard nav** | Clickable rows not focusable; ToggleSwitch accessible (role=switch) but no label |
| `/detectors/$detectorId` | None beyond native form | Minimal | Same form label issues as plans |
| `/detectors/new` | Native form only | Minimal | Same issues |
| `/import` | None | **No keyboard nav** | CSV drop zone completely keyboard-inaccessible |
| `/dashboard` | None | No custom nav | All Segmented controls keyboard-reachable but no group roles; heatmap inaccessible |
| `/settings` | None | Minimal | ToggleRow switch accessible but unlabeled |
| `/login` | None | Minimal | Single button, keyboard-reachable |

**Stranded routes:** `/plans`, `/detectors`, `/import` — keyboard users cannot perform primary actions on these pages.
