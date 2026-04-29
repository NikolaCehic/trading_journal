# UX audit findings — 2026-04-25

Captured against demo user at http://localhost:3000 via headless Chromium.

## Console errors
_None._

## HTTP errors
_None._

## Findings

### MED
- [/import] post-import flow guidance copy (only shows after a real import): 0
- [/signout] no clear sign-out affordance — only the avatar dropdown?

### INFO
- [/landing] landing has a "Try demo" button — visible without scroll
- [/dashboard] findings sidebar visible=true
- [/trades] columns:  | Symbol | Side | Opened | Closed | Hold | Size | Entry | Exit | P&L $ | P&L % | Tags / Findings
- [/trades] rows showing a per-row finding/detector chip: 1/12
- [/trades] "flagged trades" / "with finding" filter present: true
- [/trades/$id] breadcrumb / back-to-list link visible: true
- [/trades/$id] tabs/sections in detail page: 0
- [/trades/$id] detector-finding section in trade detail: true
- [/plans] plans empty-state copy: "No plans yet."
- [/plans/new] plans/new required field markers: 1
- [/detectors] detector-explanation copy occurrences: 7
- [/detectors] built-in detectors visible
- [/detectors/new] predicate examples / templates on /detectors/new: 1
- [/import] import-history row → trades CTA (role=button or tabindex=0 or view text): true
- [/import] CSV source tabs visible: 5
- [/digest] digest-explanation copy: 2 matches
- [/settings] settings section headings: 4
- [/landing-public] public landing CTAs: 7