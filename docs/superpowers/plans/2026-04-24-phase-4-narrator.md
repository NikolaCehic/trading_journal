# Phase 4 — AI Narrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Ship the "coach that is not your friend" — AI-composed weekly email digest + per-trade post-mortem + pattern-of-the-week opt-in rule — grounded in Phase 2/3 deterministic data, never hallucinating numbers or trades.

**Architecture:**
- **Anthropic API** (`@anthropic-ai/sdk`) composes prose only; all numbers/trades/symbols/dates come from our derived data. The prompt receives a JSON fact bundle + strict output schema. Zod validates the response. On validation failure → one retry, then fall back to a deterministic template.
- **Resend** (`resend` SDK) delivers the weekly email. Fallback to logging-only for beta without email.
- **Inngest** schedules the digest: a daily 22:00-UTC fan-out function queries users whose local 22:00 is now and enqueues per-user `digest/compose` events. Idempotency key = `(userId, isoWeek)`.
- **Three new tables:** `digest_run` (audit + narrative), `digest_rule` (user opt-in rules + violations), `trade_coach_note` (per-trade AI cache).
- **Grounded prompts:** Every AI call receives a `facts` JSON with allowed position IDs, allowed finding IDs, and numeric metrics. Output schema forbids fields outside that set. Post-hoc validator rejects any mention of a symbol/number/ID not in the input.

**Tech Stack:** `@anthropic-ai/sdk`, `resend`, `inngest` (already present), `drizzle-orm`, `zod`, `react-markdown` (already present).

---

## Task 1 — Env + SDKs

**Files:**
- Modify: `package.json`
- Modify: `src/lib/env.ts`
- Modify: `.env.example`

**Steps:**
- [ ] Add deps: `pnpm add @anthropic-ai/sdk resend`
- [ ] `env.ts`: promote `ANTHROPIC_API_KEY` from optional to required. Add `RESEND_API_KEY` (optional — if missing, digest runs in log-only mode), `DIGEST_FROM_EMAIL` (required once Resend is active), `AI_ENABLED` (`z.enum(['on','off']).default('on')` — kill switch).
- [ ] `.env.example`: document the three new keys.

## Task 2 — Database schema

**Files:**
- Create: `src/db/schema/narrator.ts`
- Modify: `src/db/schema/index.ts`
- Generate: `drizzle/0004_*.sql`

**Tables (all with `user_id text not null references user(id) on delete cascade`):**

```ts
// digest_run — one row per composed digest
export const digestRun = pgTable('digest_run', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  isoWeek: text('iso_week').notNull(),                    // '2026-W17'
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  status: text('status').$type<'pending'|'composed'|'sent'|'failed'>().notNull(),
  narrative: jsonb('narrative').$type<DigestNarrative>(),  // the composed JSON (see Task 5)
  emailMessageId: text('email_message_id'),                // Resend id
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
}, (t) => ({
  uniqWeek: unique('digest_run_user_week_key').on(t.userId, t.isoWeek),
}))

// digest_rule — user-opt-in behavioral rule (e.g., "no trade within 30min of a loss")
export const digestRule = pgTable('digest_rule', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  detectorId: text('detector_id').notNull(),               // matches DetectorId enum
  ruleText: text('rule_text').notNull(),                   // the one-sentence rule
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (t) => ({
  userDetector: uniqueIndex('digest_rule_user_detector_idx').on(t.userId, t.detectorId),
}))

// trade_coach_note — AI commentary on a single position
export const tradeCoachNote = pgTable('trade_coach_note', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  positionId: uuid('position_id').notNull().references(() => position.id, { onDelete: 'cascade' }),
  derivationVersion: integer('derivation_version').notNull(),
  narrativeMarkdown: text('narrative_markdown').notNull(),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqPosVer: unique('trade_coach_note_pos_ver_key').on(t.positionId, t.derivationVersion),
}))
```

**Steps:**
- [ ] Create schema file with the three tables above.
- [ ] Re-export from `src/db/schema/index.ts`.
- [ ] `pnpm drizzle-kit generate` → commit the migration.
- [ ] `pnpm drizzle-kit push` (user runs against Neon).

## Task 3 — Fact bundle builders (pure, no AI)

**Files:**
- Create: `src/narrator/facts/digestFacts.ts`
- Create: `src/narrator/facts/coachFacts.ts`
- Create: `src/narrator/facts/types.ts`
- Test: `tests/unit/narrator/facts.test.ts`

**Contract:** Each builder reads from derived tables only. Returns a JSON-serializable fact bundle that the LLM prompt will consume. Zero free-form strings; everything is an ID, a number, or a known enum.

```ts
// types.ts
export type DigestFactBundle = {
  user: { email: string; timezone: string }
  isoWeek: string
  period: { start: string; end: string }      // ISO dates
  summary: SummaryRollupValue                   // from phase-2
  priorSummary: SummaryRollupValue | null       // week-before for deltas
  biggestWin: { positionId: string; symbol: string; side: 'long'|'short'; realizedPnl: number; rMultiple: number | null } | null
  biggestLoss: { positionId: string; symbol: string; side: 'long'|'short'; realizedPnl: number; rMultiple: number | null } | null
  topFinding: { findingId: string; detectorId: DetectorId; severity: FindingSeverity; evidence: Record<string, JsonValue>; referencedPositionIds: string[] } | null
  activeRules: Array<{ ruleId: string; detectorId: DetectorId; ruleText: string; violationsThisWeek: number }>
}

export type CoachFactBundle = {
  position: { id: string; symbol: string; side: 'long'|'short'; instrumentType: 'spot'|'perp'; entryAvg: number; exitAvg: number; size: number; realizedPnl: number; rMultiple: number | null; durationMinutes: number }
  fills: Array<{ id: string; side: 'buy'|'sell'; price: number; size: number; fee: number; executedAt: string }>
  thisPositionFindings: Array<{ findingId: string; detectorId: DetectorId; severity: FindingSeverity }>
  recentPatternMatches: Array<{ positionId: string; symbol: string; detectorId: DetectorId; realizedPnl: number; executedAt: string }>  // last 90d
  userBaselines: { medianR: number; winRate: number; avgDurationMinutes: number }
}
```

**Steps:**
- [ ] Write `digestFacts.ts` — input `(db, userId, isoWeek)` → output `DigestFactBundle`. Pulls from `summary_rollup`, `position`, `finding`, `digest_rule`. Biggest-win/loss = top by `|realizedPnl|` in the period. Top-finding = highest severity in the period.
- [ ] Write `coachFacts.ts` — input `(db, userId, positionId)` → output `CoachFactBundle`. `recentPatternMatches` = other positions from last 90 days where the same detectorId fired.
- [ ] Unit tests with fixture data; both builders must be deterministic.

## Task 4 — LLM output schemas + prompts (still no AI call)

**Files:**
- Create: `src/narrator/prompts/digest.ts`
- Create: `src/narrator/prompts/coach.ts`
- Create: `src/narrator/schemas.ts`
- Test: `tests/unit/narrator/schemas.test.ts`

**Schemas (strict zod):**
```ts
// Every string field capped; every ID must be from the input bundle.
export const DigestNarrativeSchema = z.object({
  greeting: z.string().max(240),                 // 2 sentences max
  biggestWin: z.object({
    positionId: z.string().uuid(),
    prose: z.string().max(360),                  // 2 sentences max
  }).nullable(),
  biggestLoss: z.object({
    positionId: z.string().uuid(),
    prose: z.string().max(360),
  }).nullable(),
  topFinding: z.object({
    findingId: z.string().uuid(),
    prose: z.string().max(500),                  // 3 sentences max
  }).nullable(),
  oneThingToTry: z.string().max(280).nullable(),  // if a rule-suggestion fits
  suggestedRule: z.object({
    detectorId: z.string(),
    ruleText: z.string().max(180),
  }).nullable(),
})
export type DigestNarrative = z.infer<typeof DigestNarrativeSchema>

export const CoachNarrativeSchema = z.object({
  gradeLetter: z.enum(['A','B','C','D','F']),
  prose: z.string().max(1200),                    // 4–6 short paragraphs
  referencedPositionIds: z.array(z.string().uuid()).max(5),
  referencedFindingIds: z.array(z.string().uuid()).max(5),
})
export type CoachNarrative = z.infer<typeof CoachNarrativeSchema>
```

**Prompt files:**
- `digest.ts` exports `buildDigestPrompt(facts: DigestFactBundle)` — returns `{ system, user }` strings. System prompt encodes voice: direct, honest, no emoji, no "great work", and an explicit instruction to only reference IDs from the input.
- `coach.ts` exports `buildCoachPrompt(facts: CoachFactBundle)`.

**Grounding rules enforced in system prompt:**
1. You may only reference `positionId`s listed under `facts.allowedPositionIds`.
2. Every number in your prose must appear in `facts` verbatim.
3. No words from the banned-voice list: ["great", "amazing", "congrats", "keep it up", "streak", "nice work", emojis].
4. Output **only** JSON matching the schema. No prose outside JSON.

**Post-hoc validator** (`src/narrator/validate.ts`):
- Parses against zod schema.
- Extracts every `$N`, `$%`, ticker symbol, and ID from the prose using regex; each must appear in the input facts.
- If validation fails → fire one retry with a shorter prompt. If still fails → mark run as `failed` and use the deterministic fallback template.

**Steps:**
- [ ] Write both prompt builders.
- [ ] Write zod schemas.
- [ ] Write `validate.ts` with the numeric-grounding check.
- [ ] Unit test: valid narrative passes; narrative with a fabricated `$2,999` fails.

## Task 5 — LLM client + deterministic fallback

**Files:**
- Create: `src/narrator/client.ts`
- Create: `src/narrator/compose.ts`
- Create: `src/narrator/fallback.ts`
- Test: `tests/unit/narrator/compose.test.ts` (mocks the anthropic SDK)

**`client.ts`:** thin wrapper around `@anthropic-ai/sdk` with:
- Model: `claude-sonnet-4-6` (latest stable; per CLAUDE.md defaults). Override via `NARRATOR_MODEL` env if we need to downshift to Haiku for cost.
- Request shape: system + user + JSON response forcing via prompt instruction (Anthropic native structured output is beta; stick with schema + validation).
- Timeout: 20s per call. Max tokens: 1024 (digest) / 1500 (coach).
- Returns `{ content: string, usage: { in, out } }`.

**`compose.ts`:** `composeDigest(facts)` and `composeCoach(facts)`:
1. Build prompt
2. Call client
3. Parse + validate
4. On failure: single retry with `temperature=0.3` and "Return only JSON matching schema exactly."
5. On second failure: return `fallback.ts` output + `{ failed: true }`

**`fallback.ts`:** deterministic templates — readable, dry, stripped. Used when AI fails or `AI_ENABLED=off`.

**Steps:**
- [ ] Implement `client.ts` with a narrow interface (easy to mock in tests).
- [ ] Implement `compose.ts` with retry + fallback path.
- [ ] Unit test composeDigest → mock SDK returns valid JSON → assert narrative shape. Then mock returns fabricated number → assert retry + fallback path.

## Task 6 — Email rendering + sending

**Files:**
- Create: `src/narrator/email/render.tsx`
- Create: `src/narrator/email/send.ts`
- Test: `tests/unit/narrator/email.test.ts`

**`render.tsx`:** pure function `renderDigestEmail(facts, narrative): { subject: string, html: string, text: string }`. Builds server-side HTML using inline styles (email-safe — no external CSS), mirroring the landing's "Weekly digest" preview card layout. `text` is the plain-text fallback. No React components in the email runtime — just template strings.

**`send.ts`:** wraps the Resend SDK. If `RESEND_API_KEY` missing → logs + returns `{ skipped: true }`. Otherwise sends and returns `messageId`.

**Subject line formula:** `"TJ · Apr 19 — +$1,897 · 1 thing to try"` — period end date + P&L + suggestion count.

**Steps:**
- [ ] Render function with inline styles matching the landing mock.
- [ ] Resend wrapper with log-only fallback.
- [ ] Snapshot test of the rendered HTML.

## Task 7 — Inngest functions + scheduling

**Files:**
- Modify: `src/jobs/events.ts`
- Create: `src/jobs/narrator.ts`
- Modify: `src/jobs/functions.ts`

**Three new functions:**
1. `digestWeeklyScheduler` — cron `0 22 * * *` (daily 22:00 UTC). Queries users whose local offset + 22:00 == now-UTC. For each, send `digest/compose` event.
2. `composeDigest` — event: `digest/compose`. Reads data, composes narrative, writes `digest_run`, sends `digest/send` event.
3. `sendDigest` — event: `digest/send`. Loads `digest_run`, renders email, calls Resend, stamps `sent_at` + `emailMessageId`.

**Idempotency:** `digest_run.uniqWeek` unique constraint ensures one row per `(userId, isoWeek)`. The scheduler uses `insertOnConflictDoNothing` so re-runs are safe.

**User timezone:** new `user.timezone text` column (default `'UTC'`) set from the client on first sign-in via a short `POST /api/user/timezone` — deferred to follow-up if heavy; v1 uses UTC for everyone and shifts the cron rule.

**Events (`events.ts`):**
```ts
export type DigestComposePayload = { name: 'digest/compose'; data: { userId: string; isoWeek: string } }
export type DigestSendPayload    = { name: 'digest/send';    data: { userId: string; digestRunId: string } }
```

**Steps:**
- [ ] Add event types + send helpers.
- [ ] Write the three Inngest functions.
- [ ] Register them in `functions.ts`.

## Task 8 — Coach tab server fn + UI

**Files:**
- Create: `src/server/coach.ts`
- Modify: `app/routes/(app)/_layout/trades/$positionId.tsx`
- Create: `src/components/trades/CoachNarrative.tsx`

**Server fn:** `getTradeCoach({ positionId })`:
1. Auth check.
2. Ownership check (position.userId === user.id).
3. Read cached `trade_coach_note` where `(positionId, derivationVersion=current)`. If hit, return.
4. Miss: build facts → compose → write cache → return.

**UI:** replace the existing "Phase 4" stub in the Coach tab with the real component.
- Shows a grade chip (A-F) + markdown body.
- Cited positions render as `<Link to="/trades/$positionId">`.
- Loading state: skeleton 4 lines.
- Error state: "Couldn't generate a coach note for this trade."

**Steps:**
- [ ] Write server fn with caching.
- [ ] Write `CoachNarrative.tsx` using `react-markdown` + `rehype-sanitize`.
- [ ] Hook up in `$positionId.tsx` Coach tab with `useQuery({ enabled: tab === 'Coach' })`.

## Task 9 — Pattern-of-the-week + rule opt-in

**Files:**
- Modify: `src/server/dashboard.ts`
- Create: `src/server/rules.ts`
- Modify: `src/components/dashboard/FindingsSidebar.tsx`
- Modify: `app/routes/(app)/_layout/dashboard.tsx`

**Behavior:**
- Dashboard shows the top finding as "pattern of the week" with an **"Adopt this rule"** button.
- Clicking the button creates a `digest_rule` row (if missing) and the finding card swaps to "Rule active · N violations this week" — computed on-the-fly from positions in the current week that match the detector's signal.

**Server fns (`rules.ts`):**
- `adoptRule({ detectorId, ruleText })` — idempotent insert.
- `archiveRule({ ruleId })` — stamps `archived_at`.
- `getRuleViolationsThisWeek({ ruleId })` — counts matching positions in current ISO week.

**Steps:**
- [ ] Add the three server fns.
- [ ] Extend `FindingsSidebar` with adopt button + violation badge.
- [ ] Wire into dashboard.

## Task 10 — Digest preview route (admin-only)

**Files:**
- Create: `app/routes/(app)/_layout/digest/preview.tsx`
- Create: `src/server/digestPreview.ts`

**Goal:** let the user view what their digest *would* look like right now, without waiting for Sunday.

**Server fn:** `previewDigest()` — builds facts for the current week, composes via `compose.ts` (does NOT write `digest_run` or send email), returns `{ facts, narrative }`.

**UI:** renders the same `renderDigestEmail` HTML into an iframe + a markdown-rendered preview side-by-side. "Send me this now" button fires `digest/send` with a one-off run.

**Steps:**
- [ ] Preview server fn.
- [ ] Route + component.
- [ ] Replace the Digest placeholder page's CTA with a link to `/digest/preview`.

## Task 11 — Cost caps + observability

**Files:**
- Create: `src/narrator/budget.ts`
- Modify: `src/narrator/compose.ts`

**Budget:** hard cap of `NARRATOR_USD_PER_USER_WEEK = 0.10`. `budget.ts` tracks spend per `(userId, isoWeek)` in a small KV-backed counter (or compute from `digest_run.tokensIn/tokensOut * rate`). Over-budget → return fallback without calling the API.

**Log lines:** every compose emits a structured log: `{ userId, fn, tokensIn, tokensOut, latencyMs, validated, retried, failed }`. Eventually feeds a metrics dashboard.

**Steps:**
- [ ] Implement budget check in `compose.ts` pre-call.
- [ ] Wire structured logs.

## Task 12 — Wiki + ship

**Files:**
- Modify: `docs/wiki/phases.md`

**Steps:**
- [ ] Add Phase 4 "Shipped" section: scope, commits, decisions, gotchas, deferred items.
- [ ] Flip the landing's "Phase 4" badges on the Coach tab + "Pattern-of-the-week" card to "Live".
- [ ] Test state: target 105+ passing.

---

## Scope not in Phase 4

- Bybit / OKX ingestion (Phase 5)
- Demo-data mode (Phase 5)
- Per-user timezone capture + DST handling (follow-up)
- Custom user-defined detectors (Pro plan feature — separate later phase)
- Email unsubscribe + preferences UI (follow-up; MVP uses a per-digest archive link)
