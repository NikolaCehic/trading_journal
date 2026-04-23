# Phase 10 — Plan Automation + CI Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`.

**Goal:** Lower the friction of using plans (they're powerful when linked, but manual linking means most positions never get linked), make adherence metrics stable across plan edits, and lock down regression risk with CI. Six tasks.

**Architecture:**
- **Auto-match on ingestion complete** — after derivation runs, a new Inngest function scans for unlinked positions opened within the last 48h and attempts to match each to an unarchived plan with the same symbol + side. One plan can only claim one position (first closed position wins).
- **Plan snapshots** — on link (manual or auto), copy the plan's `entryPrice/stopPrice/targetPrice/plannedSize/rationale` into per-position `plan_snapshot_*` columns. Adherence metrics read the snapshot, not the current plan. User can edit a plan after linking; metrics remain stable.
- **Plan reminders** — daily Inngest scheduler fires emails at local 18:00 (user's timezone) to users with plans older than 7 days with zero links. One email per user per day maximum; tracked via a new `plan_reminder_sent_at` timestamp on `trade_plan`.
- **CI** — GitHub Actions workflow `.github/workflows/ci.yml` runs typecheck, vitest, Playwright on every PR + push to main. Requires `DATABASE_URL` + `BETTER_AUTH_SECRET` as Actions secrets (for the Playwright seed step).
- **CLI env** — separate zod schema with only the vars CLI scripts actually need (`DATABASE_URL` required; everything else optional). `scripts/*.ts` use the CLI schema.

**Tech Stack:** Existing + GitHub Actions.

---

## Task 1 — Plan snapshots

**Files:**
- Modify: `src/db/schema/derivation.ts` — add 5 snapshot columns to `position`
- Modify: `src/server/plans.ts` — `linkPositionToPlan` now also writes the snapshot
- Modify: `src/server/trades.ts` — `TradeDetailBundle.linkedPlan` prefers the snapshot; adherence reads snapshot fields
- Modify: `app/routes/(app)/_layout/trades/$positionId.tsx` — consumes `linkedPlan` unchanged (snapshot is invisible to UI)
- Generate migration

**Columns on `position`:**
```ts
planSnapshotEntryPrice: numeric('plan_snapshot_entry_price', { precision: 20, scale: 8 }),
planSnapshotStopPrice: numeric('plan_snapshot_stop_price', { precision: 20, scale: 8 }),
planSnapshotTargetPrice: numeric('plan_snapshot_target_price', { precision: 20, scale: 8 }),
planSnapshotSize: numeric('plan_snapshot_size', { precision: 20, scale: 8 }),
planSnapshotRationale: text('plan_snapshot_rationale'),
```

**linkPositionToPlan behavior:**
- After setting `position.planId = planId`, read the plan's current values
- Copy into the snapshot columns
- Ownership check on both (already there)

**unlinkPositionFromPlan:** clear snapshot columns too.

**`TradeDetailBundle.linkedPlan` shape unchanged** — but the server fn now returns snapshot values when present, falling back to live plan values only if snapshot is null (e.g., positions linked before this feature shipped). Bridge logic in the handler.

**Steps:**
- [ ] Schema + migration.
- [ ] Server fn logic (link + unlink + snapshot read in getTradeDetail).
- [ ] No UI changes — existing chips continue to render correctly.
- [ ] Unit tests in `tests/unit/server/plans.test.ts`: linking copies snapshot; unlinking clears snapshot; subsequent plan edits don't affect already-linked position's adherence.

## Task 2 — Auto plan-matching on ingestion

**Files:**
- Create: `src/jobs/planMatcher.ts` — Inngest function `autoMatchPlansFn`
- Modify: `src/jobs/events.ts` — add `plan/auto-match` event
- Modify: `src/jobs/functions.ts` — register the new function
- Modify: `src/derivation/runner.ts` — emit `plan/auto-match` after derivation complete

**Match logic:**
- Trigger: `plan/auto-match` event with `{ userId }` data
- For each unlinked closed position belonging to `userId`:
  - Find unarchived plans: same `symbol`, same `intendedSide` as position's `side`, `createdAt >= position.openedAt - 48h` and `createdAt <= position.openedAt + 12h` (the plan had to be made before or slightly around the time the trade was taken), no linked position yet
  - If exactly one candidate → link it (write snapshot too)
  - If zero or multiple → skip (user links manually)
- Log every match with `{ userId, positionId, planId, confidence: 'exact' | 'multiple' | 'none' }`

Emission in `runDerivation`: after persisting all derived rows, fire `sendPlanAutoMatch({ userId })`.

**Steps:**
- [ ] Event type + helper.
- [ ] Function implementation.
- [ ] Emission from runner.
- [ ] Register in functions.ts.
- [ ] No tests for the Inngest function itself (same precedent as other narrator Inngest fns); the match logic could be unit-tested as a pure helper — extract `matchPositionsToPlans(positions, plans): Array<{ positionId, planId }>` and test that.
- [ ] Integration smoke: none (user tests manually by importing fills with an open matching plan).

## Task 3 — Plan reminders

**Files:**
- Modify: `src/db/schema/journal.ts` — add `reminderSentAt timestamp null` to `tradePlan`
- Create: `src/narrator/email/planReminder.ts` — `renderPlanReminderEmail(user, plans): { subject, html, text }`
- Create: `src/jobs/planReminders.ts` — Inngest scheduler + composer + sender functions
- Modify: `src/jobs/events.ts` + `src/jobs/functions.ts`
- Generate migration

**Logic:**
- Daily cron at hourly intervals (`0 * * * *`); handler filters to users whose local time is 18:00 (using same `isLocalHour(user, 18)` helper pattern from digest)
- For each due user, find unarchived plans where `createdAt < now - 7 days` AND no linked positions AND `reminderSentAt IS NULL OR reminderSentAt < now - 7 days`
- If any qualify → render + send the email, stamp `reminderSentAt = now` on each included plan
- Respect `user.digestEnabled` (same opt-out as weekly digest; or introduce a separate `planRemindersEnabled` flag — use `digestEnabled` for simplicity in v1)
- Skip demo users

**Email content:**
- Subject: `TJ · 3 stale plans — take or archive?`
- Body: brief greeting + list of plans (symbol, side, age in days, "take" link to `/plans/:id`, "archive" link)
- Unsubscribe link: reuses existing `signUnsubscribeToken` + `/api/unsubscribe` flow

**Steps:**
- [ ] Schema + migration.
- [ ] Render function + test.
- [ ] Scheduler / composer / sender Inngest functions.
- [ ] Event types + registration.
- [ ] Small unit tests for the render.

## Task 4 — GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `package.json` (if script adjustments needed)

**Workflow:**
```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  checks:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm vitest run
        env:
          CI: 'true'
      - run: pnpm e2e:install
      - run: pnpm e2e
        env:
          CI: 'true'
          DATABASE_URL: ${{ secrets.CI_DATABASE_URL }}
          BETTER_AUTH_SECRET: ${{ secrets.CI_BETTER_AUTH_SECRET }}
          ANTHROPIC_API_KEY: placeholder-ci
          AI_ENABLED: 'off'
          BETTER_AUTH_URL: 'http://localhost:3000'
          GOOGLE_CLIENT_ID: 'ci-placeholder'
          GOOGLE_CLIENT_SECRET: 'ci-placeholder'
          VITE_APP_URL: 'http://localhost:3000'
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

Document required GitHub secrets in a comment at the top of the file:
- `CI_DATABASE_URL` — a separate Neon branch for CI
- `CI_BETTER_AUTH_SECRET` — 32+ char hex string

Note: Playwright tests require a seeded demo user. Add a `pnpm seed:demo` step before `pnpm e2e` in the workflow, OR document that CI's `CI_DATABASE_URL` should be a pre-seeded branch. Go with the pre-seeded approach for now — seeding on every CI run is slow and requires working migrations against the fresh DB first. Document this in the workflow comment.

Actually simpler: **add a pre-seed step** to CI:
```yaml
- run: pnpm drizzle-kit push --force
  env:
    DATABASE_URL: ${{ secrets.CI_DATABASE_URL }}
- run: pnpm seed:demo
  env:
    DATABASE_URL: ${{ secrets.CI_DATABASE_URL }}
    # + other env vars
```

This makes the workflow self-contained but requires the CI DB to allow `drizzle-kit push --force` (drops+recreates may be needed). Safer: use a scratch Neon branch per run. Keep it simple — document that users need to set up the CI Neon branch manually.

**Steps:**
- [ ] Write workflow YAML.
- [ ] Test locally by running `act` (if available) OR just commit and iterate on a PR. For this task: just write the file and commit. User will iterate on real PRs.

## Task 5 — CLI-friendly env schema

**Files:**
- Modify: `src/lib/env.ts` — export a `cliEnv` in addition to `env`
- Modify: `scripts/rederive.ts` and `scripts/seedDemo.ts` — use `cliEnv` instead of `env`
- Modify: `package.json` — remove the `GOOGLE_CLIENT_ID=cli GOOGLE_CLIENT_SECRET=cli` inline workarounds from script commands

**Contract:**
```ts
// src/lib/env.ts — existing `env` stays untouched (used by web app)
// NEW: cliEnv with only the vars scripts actually need.

export const cliEnv = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  },
  runtimeEnv: {
    DATABASE_URL: process.env['DATABASE_URL'],
    ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'],
    NODE_ENV: process.env['NODE_ENV'],
  },
  emptyStringAsUndefined: true,
})
```

Scripts replace `import { env } from '~/lib/env'` → `import { cliEnv as env } from '~/lib/env'`. Or rename references appropriately.

**Migration:** since `~/db/client` imports `env`, `scripts/rederive.ts` also transitively evaluates `env.ts`'s `env` export at import time — but if we only `import { cliEnv }`, the `env` object is also constructed (zod schema evaluated) because it's a top-level export. **Fix:** split into two files or lazy-construct. Simplest:

```ts
// src/lib/env.ts
const sharedRuntimeEnv = { ...process.env }  // snapshot

function buildWebEnv() {
  return createEnv({
    server: { /* all vars */ },
    client: { /* vite vars */ },
    runtimeEnv: { /* ... */ },
    emptyStringAsUndefined: true,
  })
}

function buildCliEnv() {
  return createEnv({
    server: { /* minimal */ },
    runtimeEnv: { /* minimal */ },
    emptyStringAsUndefined: true,
  })
}

export const env = buildWebEnv()
export const cliEnv = buildCliEnv()
```

But `buildWebEnv()` still runs at import time. The issue is `~/db/client.ts` imports `env`. If scripts only need the DB URL, we can:

**Option A:** Have `~/db/client` read directly from `process.env.DATABASE_URL` (bypass the zod schema at DB init). Tiny change. Clean.

**Option B:** `scripts/*.ts` set placeholder env vars inline for the web vars they don't actually need. Current state.

**Option C:** Split `db/client.ts` into `db/client-web.ts` and `db/client-cli.ts` — over-engineered.

Pick **Option A**: `~/db/client.ts` reads `process.env['DATABASE_URL']` directly with a helpful error if missing. Scripts stop needing the full env schema at all. Keep `env` for the web app; add `cliEnv` for scripts that want strongly-typed subset.

**Steps:**
- [ ] Update `~/db/client.ts` to not import from `~/lib/env`.
- [ ] Add `cliEnv` to `src/lib/env.ts`.
- [ ] Update scripts to use `cliEnv`.
- [ ] Remove the `GOOGLE_CLIENT_ID=cli ...` prefix from `rederive` and `seed:demo` npm scripts.
- [ ] Run both scripts locally (user does this manually) to verify they work without the prefix.

## Task 6 — Wiki + changelog

**Files:**
- Modify: `docs/wiki/phases.md` — Phase 10 Shipped section
- Modify: `app/routes/(public)/changelog.tsx` — prepend v0.10 entry

---

## Scope NOT in Phase 10

- **Custom user-defined detectors DSL** — Phase 11+.
- **Dashboard BTC-price overlay / volume pane** — chart polish, separate follow-up.
- **Partial-fill exit slip accuracy** — check if this is even inaccurate today; defer unless validated broken.
- **Mobile UX** — desktop-first remains.
- **Plan reminders: per-plan mute / snooze** — v1 is all-or-nothing via digestEnabled.
- **Auto-match confidence scoring beyond "exact" / "multiple"** — score-based ranking is complex; deferred.
- **CI-triggered preview deploys** — GitHub Actions runs checks only, no deploy.
