# AI Surfacing Design — 2026-04-25

**Origin:** Follow-on to the 2026-04-25 UX audit (`docs/qa/2026-04-25-ux-audit.md`). The audit's Pattern A — "the value loop is unnarrated" — confirmed the AI features (Coach, Digest) work but are buried behind a tab and a dedicated route. This spec promotes them so users see AI insight at the natural moments they're looking for it: when reading a single trade, and when scanning the dashboard.

**Goal:** Two new UI surfaces, both reusing existing AI machinery. Zero new prompts. Zero new LLM calls beyond what the existing Coach + Digest pipelines already make.

**Non-goal:** Range-adaptive AI synthesis (Option B.2 from brainstorming), AI-suggested plan templates (Option C), per-detector AI explanations.

---

## Architecture

### Surface 1 — Trade-detail Coach card (eager-loaded)

`<CoachCard positionId>` renders above the existing tab bar on `/trades/$positionId`. Eager-loaded via the existing `useQuery(['tradeCoach', positionId])` hook — promoted from the `Coach` tab to the page level so it fires on mount instead of waiting for the user to click the tab.

The narrative is already cached in `trade_coach_note` keyed on `(positionId, derivationVersion)`. First visit per (trade, derivation version) costs one LLM call (~$0.01–$0.03) and ~5–15s; every subsequent visit is instant. Per-user weekly token budget (`src/narrator/budget.ts`) already gates the cost ceiling.

The existing Coach tab is **kept** — it still owns the full markdown render and any future regenerate UI. The new card is a summary promoter, not a replacement.

### Surface 2 — Dashboard Insight card

`<InsightCard latestDigestSummary>` renders on `/dashboard` between the existing setup checklist (which hides for users with data) and the KPI tiles. Pulls a 2–3 sentence extract from the most recent composed `digest_run` for the user.

No new server fn. `getDashboardBundle` is extended with a single `latestDigestSummary` field — one extra DB read on dashboard load, no LLM call. The summary updates implicitly when the existing weekly compose pipeline fires (Sundays at 22:00 user-local).

**Note on schema:** `digest_run` (per `src/db/schema/narrator.ts`) has columns `(id, userId, isoWeek, periodStart, periodEnd, status, narrative, emailMessageId, tokensIn, tokensOut, errorMessage, createdAt, sentAt)`. There is **no** `derivationVersion` column on `digest_run` — the unique key is `(userId, isoWeek)`. Filtering by `status='composed'` is sufficient; ordering uses `createdAt DESC`.

---

## Data flow

```
Trade detail page
  └─ <CoachCard positionId={p.id} />
      └─ useQuery(['tradeCoach', positionId], () => getTradeCoach({ data: { positionId } }))
          └─ getTradeCoach (existing server fn, src/server/coach.ts)
              ├─ cache hit on (positionId, DERIVATION_VERSION) → return narrative immediately
              └─ cache miss → compose → store in trade_coach_note → return

Dashboard page
  └─ getDashboardBundle (existing server fn, src/server/dashboard.ts)
      ├─ existing logic (KPIs, equity curve, findings, etc.) [unchanged]
      └─ NEW: latestDigestSummary
          └─ SELECT narrative, isoWeek, composedAt
             FROM digest_run
             WHERE user_id=? AND status='composed' AND derivation_version=DERIVATION_VERSION
             ORDER BY composed_at DESC LIMIT 1
          └─ extractSummary(narrative) → { isoWeek, summary, composedAt } | null
  └─ <InsightCard summary={bundle.latestDigestSummary} />
      ├─ has summary → render summary + "View full digest →" link
      ├─ no summary, user has trades → "Your first weekly digest composes Sunday 22:00 in your timezone" + /settings link
      └─ no trades → don't render (setup checklist owns empty state)
```

---

## Component contracts

### `<CoachCard positionId={string} />`

**Location:** `src/components/trades/CoachCard.tsx` (NEW)

**Props:**
- `positionId: string` — required.

**States and rendering:**
- **Loading** (cache miss, first compose in flight, ~5–15s): renders the existing card chrome (`.tj-card` + `✦ AI insight` header) with a skeleton paragraph and the subtitle "Composing your insight…".
- **Success — full narrative**: renders a grade badge (e.g., `B` in a colored pill) plus the first paragraph of `coach.narrativeMarkdown` (split on `\n\n`, take first non-empty block — the field has already been stripped of the grade line by `getTradeCoach`'s server-side `stripGradeLine`). Followed by a small "Read full →" link that switches the trade-detail page's tab state to `Coach` and scrolls to the tab content. Grade badge color follows letter: A → green-weak, B → accent-weak, C → amber-weak, D → pnl-down-weak with subdued text, F → pnl-down with white text. Note: `getTradeCoach` returns `TradeCoachResult` (`{ gradeLetter, narrativeMarkdown, referencedPositionIds, ... }`) — the structured `CoachNarrativeSchema` shape (`prose`/`gradeLetter`/etc.) is the LLM's intermediate output, not the client-side return.
- **Success — fallback narrative** (LLM grounding failed; `coach.failed === true`): card hides itself entirely. Tab bar still has the Coach tab; user can click through if they want the fallback markdown. We don't promote a fallback to the top of the page because the value of "AI insight" depends on the LLM actually saying something useful.
- **Error** (network/auth/budget exceeded): renders the chrome with copy "Couldn't load the AI insight." and a small Retry button calling `query.refetch()`. No-op for demo users — Coach is a read, not a write.
- **No-data** (no fills produce a narrative): card hides. The existing fallback already short-circuits when the position has zero fills.

**Visual:**
```
┌────────────────────────────────────────────────────┐
│ ✦ AI insight                  ⓒ Grade   Read full →│
├────────────────────────────────────────────────────┤
│ This DOGEUSDT long was opened 12 minutes after a  │
│ losing close on the same symbol — a revenge-      │
│ trading pattern your detectors flagged. The trade  │
│ exited at -15.86% R-multiple.                      │
└────────────────────────────────────────────────────┘
```
(Where ⓒ is the grade badge — color-coded per letter.)

### `<InsightCard latestDigestSummary={LatestDigestSummary | null} userHasTrades={boolean} />`

**Location:** `src/components/dashboard/InsightCard.tsx` (NEW)

**Props:**
- `latestDigestSummary: { isoWeek: string; summary: string; composedAt: Date } | null`
- `userHasTrades: boolean` — drives the no-summary fallback copy.

**States and rendering:**
- **Has summary**: renders the summary paragraph followed by a small footer line `Week of {isoWeek} · View full digest →` (link to `/digest`).
- **No summary, user has trades**: renders the chrome with copy "Your first weekly digest composes Sunday at 22:00 in your timezone — toggle delivery in [Settings](/settings)."
- **No summary, no trades**: returns `null` (the existing setup checklist on dashboard owns the empty state).

**Visual:**
```
┌────────────────────────────────────────────────────┐
│ ✦ AI insight                                       │
├────────────────────────────────────────────────────┤
│ This week you took 11 trades. The 2 biggest losses │
│ both fired after a previous loss within 15 min —   │
│ the same revenge-trading pattern. Your win rate on │
│ first-of-day trades was 60% vs 18% on subsequent.  │
│                                                    │
│ Week of 2026-W17 · View full digest →              │
└────────────────────────────────────────────────────┘
```

---

## Server changes

**File:** `src/server/dashboard.ts` (`getDashboardBundle`).

**Type extension** to `DashboardBundle`:
```ts
latestDigestSummary: {
  isoWeek: string
  summary: string  // 2–3 sentence plain-text extract
  composedAt: Date  // sourced from digest_run.createdAt
} | null
```

**Implementation:** in `getDashboardBundle`'s body, after the existing aggregations:
```ts
const latestDigest = await db
  .select({
    isoWeek: digestRun.isoWeek,
    narrative: digestRun.narrative,
    createdAt: digestRun.createdAt,
  })
  .from(digestRun)
  .where(and(
    eq(digestRun.userId, userId),
    eq(digestRun.status, 'composed'),
  ))
  .orderBy(desc(digestRun.createdAt))
  .limit(1)

const summary = latestDigest[0] ? extractDigestSummary(latestDigest[0].narrative) : null
const latestDigestSummary = (latestDigest[0] && summary)
  ? {
      isoWeek: latestDigest[0].isoWeek,
      summary,
      composedAt: latestDigest[0].createdAt,
    }
  : null
```

If `extractDigestSummary` returns null (defensive — every priority field empty), the bundle field also resolves to null so the InsightCard hides.

**`extractDigestSummary` helper** (new) lives in `src/narrator/extract.ts`. The digest narrative schema (per `src/narrator/schemas.ts`) is `{ greeting, biggestWin, biggestLoss, topFinding, oneThingToTry, suggestedRule }`. The helper picks the most actionable single string for a 2–3 sentence dashboard summary, in this priority order:

1. `topFinding.prose` (most actionable; up to 500 chars, capped to ~280 here for layout).
2. `oneThingToTry` (already capped at 280 chars).
3. `greeting` (always present; 240 chars max).

Falls back through the priority list when a higher-priority field is null. Returns the chosen string trimmed and capped at 280 chars (period-split if longer to avoid mid-sentence cut). Returns null only if every field is empty/null — which shouldn't happen for `status='composed'`, but defensive.

**No new table, no new index, no new migration.** `digest_run` already has the columns we read.

---

## Cost & rate-limit posture

**LLM calls added by this work: zero.**

- Coach: the existing `useQuery(['tradeCoach', positionId])` hook stays the same. Promoting it to the page level only changes WHEN the call fires (on mount instead of on tab click). Per-trade cache + per-user weekly budget unchanged.
- Digest: read-only. We pull the existing `digest_run` row that the Sunday cron already composed.

**One worth-noting behavior change:** users who open trade detail pages now trigger Coach composes earlier in their session than before. For a user who never clicked the Coach tab, this DOES surface LLM cost they wouldn't have paid before. The per-user weekly budget (`getNarratorBudgetStatus`) already caps that ceiling — once exceeded, `getTradeCoach` throws and the card renders the error state.

---

## Edge cases

- **New user, no positions**: trade detail surface doesn't apply (no trade pages to view). Dashboard Insight card returns null because the setup checklist is showing.
- **User with positions but no digest yet** (signed up mid-week, weekly cron hasn't fired): Insight card shows the "first digest composes Sunday" copy with `/settings` link.
- **Demo user**: Coach is a read (`assertNotDemo` is correctly absent). Card works. Digest is a read. Card works.
- **LLM fallback fired on a Coach compose** (`failed: true`): Coach card hides; the tab still works via existing logic.
- **Stale derivation version**: `trade_coach_note` is keyed on `(positionId, DERIVATION_VERSION)`. After a `pnpm rederive` to bump the version, cache is effectively invalidated; next view triggers a fresh compose. Same for `digest_run` (the where-clause includes `derivation_version=DERIVATION_VERSION`).
- **Week boundary**: when the Sunday cron composes a new digest, the dashboard's `latestDigestSummary` automatically reflects it on next page load. No client-side cache invalidation needed (TanStack Query refetches on focus by default).
- **Token budget exceeded**: `getTradeCoach` throws `BudgetExceededError`. Coach card surfaces the error state. Existing Coach tab behavior unchanged.

---

## Testing

- **Unit:** `src/narrator/extract.test.ts` — `extractDigestSummary` correctly handles the structured narrative shape, falls back gracefully on missing sections, caps at 280 chars.
- **Unit:** `src/server/dashboard.test.ts` (extend existing) — `getDashboardBundle` includes `latestDigestSummary` field; null when no composed digest exists; populated when one does.
- **Component:** `src/components/trades/CoachCard.test.tsx` — renders skeleton on loading, narrative summary on success, error+retry on failure, hides on `failed: true`.
- **Component:** `src/components/dashboard/InsightCard.test.tsx` — renders summary when provided, "first digest composes" copy when null and `userHasTrades`, returns null when no summary and no trades.
- **Smoke:** extend `scripts/smoke-ui.ts` to verify the Coach card is present on a trade-detail visit and the Insight card is present on dashboard for the demo user (who has 12 positions but no composed digest — so it'll show the "first digest composes" copy).

---

## Files changed

**New:**
- `src/components/trades/CoachCard.tsx`
- `src/components/trades/CoachCard.test.tsx`
- `src/components/dashboard/InsightCard.tsx`
- `src/components/dashboard/InsightCard.test.tsx`
- `src/narrator/extract.ts`
- `src/narrator/extract.test.ts`

**Modified:**
- `app/routes/(app)/_layout/trades/$positionId.tsx` — render `<CoachCard>` above the tab bar; promote the existing Coach `useQuery` to page level (or re-use the same hook in two places — TanStack dedupes).
- `app/routes/(app)/_layout/dashboard.tsx` — render `<InsightCard>` between the setup checklist and the KPI tiles.
- `src/server/dashboard.ts` — extend `getDashboardBundle` return + `DashboardBundle` type with `latestDigestSummary`.
- `src/server/dashboard.test.ts` — extend tests.
- `scripts/smoke-ui.ts` — verify both cards.

---

## What this is not

- **Not a redesign of the Coach experience**. The Coach tab still owns the full markdown / regenerate UX. The card is purely a promoter.
- **Not range-adaptive on the dashboard.** The Insight card always reflects the latest weekly digest, regardless of the 7d/30d/90d filter. (User can ask for range-adaptive synthesis later — that's option B.2 from brainstorming.)
- **Not changing the digest pipeline.** Sundays at 22:00 cron is unchanged. Compose / send / fallback unchanged.
- **Not introducing AI-generated plans, AI-suggested rules, or any new prompts.** Those are options C and beyond — separate specs.

---

## Open questions resolved during brainstorming

- **Eager-load Coach (A.1) vs lazy with prominent affordance (A.2)?** A.1, because the cache makes the steady-state cost zero and "useful AI" is the default behavior the user wants when they open a trade.
- **Reuse digest narrative (B.1) vs new per-range prompt (B.2)?** B.1, because reusing is free and the digest is already the canonical "what happened this week" surface.
- **Show fallback narratives in the new card?** No — only promote real LLM output. Fallbacks stay in the existing Coach tab where they're already visible.
- **Persist a separate "summary" field on `trade_coach_note`?** No — extract from existing markdown. Simpler. Falls out of the schema if we add an explicit summary later.

---

## Success criteria

After this ships:
1. A demo user opening a trade detail page sees a Coach narrative card above the fold within 15s of cold-loading the page.
2. A user with at least one composed weekly digest sees an Insight card on the dashboard the next time they load it.
3. The smoke-ui script verifies both cards render in their expected states.
4. Zero regression in token-budget tests; zero regression in existing Coach / Digest behavior.
5. The UX-audit script's heuristics on `/trades/$id` and `/dashboard` improve from "no inline AI insight" to "AI insight visible."
