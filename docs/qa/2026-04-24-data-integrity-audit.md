# Data Integrity Audit — 2026-04-24

**Auditor:** Claude Sonnet 4.6 (subagent, code-review mode)
**Scope:** Migrations 0000–0016, Inngest idempotency, FK cascades, race conditions, decimal precision, transaction boundaries.

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 1 |
| HIGH     | 4 |
| MEDIUM   | 5 |
| LOW      | 4 |
| INFO     | 5 |

---

## CRITICAL

### C-01: `persistDerivation` deletes positions without a transaction — dashboard sees empty data window

- **File:** `src/derivation/persist.ts:24–157`
- **Description:** `persistDerivation` issues 12 separate `DELETE`/`INSERT` pairs, none of which are wrapped in a database transaction. Between the `DELETE FROM position` (line 24) and the subsequent `INSERT INTO position` (line 28), any concurrent read of the `position` table for that `(userId, derivationVersion)` will return zero rows. This affects `getDashboardBundle`, `buildDigestFacts`, `resolveFilteredPositionIds`, and any other reader scoped to `DERIVATION_VERSION`.
- **Repro:** User triggers a re-derivation. While `persistDerivation` is mid-flight (positions deleted, not yet re-inserted), a page load calls `getDashboardBundle`. The equity curve, KPIs, and summary all compute from zero positions and return empty/zeroed data to the user.
- **Fix:** Wrap the entire `persistDerivation` body in a single `db.transaction(async (tx) => { ... })` call, passing `tx` as the DB handle for all operations. Neon HTTP adapter supports transactions via the `transaction()` helper.

---

## HIGH

### H-01: `planSnapshot*` columns erased on every re-derivation

- **File:** `src/derivation/persist.ts:28–46` and `src/server/trades.ts:200–212`
- **Description:** `persistDerivation` inserts new position rows with `planId` re-attached from the `planLinkMap` (runner.ts:61) but does **not** copy the five `planSnapshot*` columns (`planSnapshotEntryPrice`, `planSnapshotStopPrice`, `planSnapshotTargetPrice`, `planSnapshotSize`, `planSnapshotRationale`). These columns are set by `linkPositionToPlan` and `autoMatchPlansFn` on the old position row, then silently NULL'd out when derivation deletes and re-inserts the row. `server/trades.ts:200–212` falls back to the live plan values (which may have been updated since link time), defeating the snapshot's purpose.
- **Repro:** User manually links position to a plan and edits the plan's stop price. A new import triggers re-derivation. The trade detail page now shows the updated stop price instead of the value at link time — the snapshot is gone.
- **Fix:** In `runner.ts`, when re-attaching `planId`, also select and re-attach the five `planSnapshot*` columns from the existing position rows. Then pass those through `Position` domain type and write them in `persistDerivation`. Alternatively, persist snapshots in a separate `position_plan_snapshot` table not subject to delete-then-insert.

### H-02: `autoMatchPlansFn` overwrites manual plan links

- **File:** `src/jobs/planMatcher.ts:125–136`
- **Description:** Step 1 fetches positions where `planId IS NULL`, but the subsequent `UPDATE` at line 135 has no `WHERE planId IS NULL` guard. If the user manually calls `linkPositionToPlan` between when the auto-matcher fetched positions (step `fetch-positions`) and when it applies matches (step `match-${positionId}`), the manual link is silently overwritten with the auto-matcher's choice.
- **Repro:** User opens the trade detail page and clicks "Link to plan" for position P1 while the `plan/auto-match` Inngest function is running (triggered by a concurrent import). The auto-matcher applies its match for P1 after the user's manual link, replacing it.
- **Fix:** Add `isNull(position.planId)` to the `UPDATE` WHERE clause: `.where(and(eq(position.id, m.positionId), eq(position.userId, userId), isNull(position.planId)))`.

### H-03: `fillCount` inflated on re-import — incorrect `import_record.fill_count`

- **File:** `src/ingestion/orchestrator.ts:83–85`
- **Description:** `fillCount++` is incremented unconditionally after the `insert(...).onConflictDoNothing()` call. When fills already exist (re-import of the same wallet or CSV), `onConflictDoNothing` silently skips the insert but `fillCount` is still incremented. The resulting `fill_count` written to `import_record` is inflated, misleading the UI and any import history display.
- **Repro:** User submits the same Hyperliquid wallet address twice. Second pull: all fills already exist, `onConflictDoNothing` skips all 500 rows, but `import_record.fill_count` is set to 500 on the second import record.
- **Fix:** Use Postgres's `RETURNING` or check the `rowCount` from the insert result to count only actually-inserted rows. With Drizzle, switch to `.onConflictDoNothing().returning()` and count the returned array length.

### H-04: `finding.referencedPositionIds` stale after version bump — rule violation count wrong

- **File:** `src/db/schema/derivation.ts:148` and `src/server/rules.ts:95–115`
- **Description:** `finding.referencedPositionIds` is a `text[]` with no FK validation. Position IDs are deterministic hashes (`pos_{userId8}_{symbol}_{openedAtBase36}_{fillId8}`), so they are **stable across derivation versions** as long as fills don't change. However, if a fill is deleted or a position's merge boundary changes (e.g., due to a different `normalizerHint`), the position ID changes, leaving stale IDs in findings from the old version. `getRuleViolationsThisWeek` (rules.ts:97–115) fetches all findings without version filter and cross-references IDs that may no longer exist.
- **Repro:** Admin corrects a fill's `normalizerHint`, bumps `DERIVATION_VERSION` to 5, runs `pnpm rederive`. One position splits into two. Old findings still list the old merged position ID. `getRuleViolationsThisWeek` counts those IDs, returning a non-zero violation count for positions that no longer exist.
- **Fix:** Add `eq(finding.derivationVersion, DERIVATION_VERSION)` to the WHERE clause in `getRuleViolationsThisWeek`. Also consider adding the version filter in `digestFacts.ts:229`.

---

## MEDIUM

### M-01: `adoptRule` has a check-then-insert race (duplicate rules per detector)

- **File:** `src/server/rules.ts:29–56`
- **Description:** `adoptRule` reads the existing rule (line 29–36), then conditionally inserts (line 43). Two concurrent requests for the same `(userId, detectorId)` can both pass the existence check and both attempt `INSERT`. There is no unique constraint on `(userId, detectorId)` in `digest_rule`. Both inserts succeed, creating two active rules for the same detector.
- **Repro:** User double-clicks "Adopt rule" fast enough to dispatch two concurrent server function calls. Both calls read `existing = undefined`, both insert — now two rows exist with the same `(userId, detectorId)`. The digest will render the rule twice.
- **Fix:** Add a unique index on `(user_id, detector_id)` in `digest_rule` (with a migration that filters `archived_at IS NULL` as a partial index, if multiple historical entries per detector are desired). Use `INSERT ... ON CONFLICT DO NOTHING` and then fetch, matching the `composeDigestFn` pattern.

### M-02: `sendPlanReminderFn` — reminder stamp outside `step.run` not idempotent on retry

- **File:** `src/jobs/planReminders.ts:160–168`
- **Description:** The `reminderSentAt` stamp loop at lines 160–168 is executed outside a `step.run()`. On an Inngest retry (e.g., after a network error between `stamp-sent` and function completion), Inngest replays all committed steps. The "find-stale" step returns its cached result (plans that were stale before the email was sent). The "send" step is memoized and won't re-fire. But the stamp loop re-executes, which is fine. The real risk is if Inngest retries the function entirely from scratch (before any step is committed): the "find-stale" step re-queries, plans are no longer stale (reminderSentAt was stamped during the previous partial run only if it got that far), and the function no-ops. This is probably fine but the user load at lines 94–108 is also outside any step, meaning it re-queries the DB on each Inngest execution. If user is deleted between retries, the function throws at line 303 (`not_composed`) in an unrelated function. For planReminders the user-not-found case is actually handled gracefully (line 105). Net assessment: LOW risk but stamp should move inside a step for clarity.
- **Repro:** Inngest times out after sending the email but before the stamp loop completes. On retry, Inngest replays; the "send" step is memoized (no double-send). The stamp re-runs. Net result is benign but brittle.
- **Fix:** Wrap the stamp loop in `await step.run('stamp-reminded', async () => { ... })`.

### M-03: `persistDerivation` — version-filtered deletes not scoped together, old-version data visible during bump window

- **File:** `src/derivation/persist.ts:24–157`
- **Description:** When `DERIVATION_VERSION` bumps from N to N+1 (e.g., 3→4), the runner deletes `(userId, version=4)` rows (which don't exist yet) and inserts new v4 rows. Old v3 rows are never deleted. Dashboard queries filter by `DERIVATION_VERSION` constant so they'll see v4 data once derivation runs. But `digest/compose` and `digest/send` also filter by `DERIVATION_VERSION` — if `buildDigestFacts` is called during a rolling deploy where some instances still have `DERIVATION_VERSION=3` and others have `DERIVATION_VERSION=4`, positions/findings will be fetched at different versions across calls. This is a deploy-window concern, not a steady-state bug.
- **Repro:** Rolling deploy of version bump. Scheduler fires; `digestWeeklyScheduler` runs on a v4 instance, enqueues `digest/compose`. The `composeDigestFn` runs on a v3 instance (old pod), queries `DERIVATION_VERSION=3` data. The `sendDigestFn` runs on a v4 instance, queries v4 data for fact-rebuild (facts are rebuilt, narrative was stored at compose time). Narrative may reference position IDs that don't exist under v4.
- **Fix:** Store `derivationVersion` in the `digest_run` row at compose time and use it for all reads in `sendDigestFn`. This is an INFO-level concern for a single-instance deploy but worth documenting.

### M-04: `autoMatchPlansFn` — `fetch-linked-plan-ids` step races with live links across concurrency window

- **File:** `src/jobs/planMatcher.ts:76–83`
- **Description:** The function uses `concurrency: { limit: 3, key: 'event.data.userId' }`. Up to 3 instances can run concurrently per user. Step `fetch-linked-plan-ids` (line 76) reads which plans are already linked. Two concurrent runs could both see a plan as unlinked, both match it to different positions, and both write `planId` to different positions (each from their own step results, Inngest memoized separately). This creates two positions linked to the same plan. There is no unique constraint preventing `planId` from appearing on multiple positions.
- **Repro:** User has plan P1, positions X1 and X2 both match. Two `plan/auto-match` events fire simultaneously (from two rapid imports). Both fetch the linked-plan list at the same time (plan P1 is free), run the matcher (both select X1→P1), apply: X1 ends up linked to P1 by whichever write wins. Only one concurrent write to position X1 happens because they share the same position ID (the WHERE clause). But if one matches X1→P1 and the other matches X2→P1, both writes succeed and P1 is linked to two positions.
- **Fix:** Reduce `concurrency.limit` to 1 per user for `plan-auto-match`, or add a unique partial index on `position.plan_id WHERE plan_id IS NOT NULL`. The latter enforces at DB level that each plan has at most one linked position.

### M-05: `digestWeeklyScheduler` double-fire at DST "fall-back" for ambiguous hour 22:00

- **File:** `src/jobs/narrator.ts:85–99`
- **Description:** `isSunday22InTz` compares the local wall-clock hour. In timezones that observe DST fall-back at or before 22:00 local time, the hour 22 can appear twice in UTC (once in summer offset, once in winter offset). The cron fires every UTC hour; `isSunday22InTz` would return `true` for both UTC hours that map to local 22:00. The scheduler would enqueue two `digest/compose` events for the same user and `isoWeek`.
- **Repro:** User timezone is `America/Havana` (UTC-5/UTC-4). On the first Sunday after November DST change, 22:00 local maps to two distinct UTC hours. `digestWeeklyScheduler` fires at each UTC hour and both pass `isSunday22InTz`. Two `digest/compose` events are enqueued. The `onConflictDoNothing` in `composeDigestFn` handles the second one gracefully (it fetches the existing row, sees `status=composed`, short-circuits). Net effect: no duplicate digest. But the second compose attempt runs the LLM compose step for a second time if the first hasn't completed yet.
- **Assessment:** The `digest_run_user_week_key` unique constraint and the `status === 'composed'` short-circuit in `composeDigestFn` protect against duplicate digests. Only a wasted LLM call could result. Severity: LOW in practice, documented as MEDIUM because the double-fire scenario is real and costs tokens.
- **Fix:** After inserting/finding the `digest_run` row, return early if `status` is `composed` or `pending` (already in flight). The current check only catches `composed` or `sent`, not `pending`.

---

## LOW

### L-01: `trade_coach_note` rows from old derivation versions accumulate indefinitely

- **File:** `src/db/schema/narrator.ts:52–64`
- **Description:** `trade_coach_note` is keyed on `(positionId, derivationVersion)`. When `DERIVATION_VERSION` bumps, old-version notes are never deleted. The `position` rows at old versions are deleted by `persistDerivation` (cascade deletes `trade_coach_note` via the FK → position). However, `position.id` is deterministic and stable — the new position row has the **same ID** as the old one. So the `ON DELETE CASCADE` on the `position_id` FK does NOT fire when positions are delete-then-reinserted, because the old row is deleted and a new row with the same PK is inserted. The cascade deletes `trade_coach_note` for the old derivation version when the position is deleted. This means old notes ARE cleaned up. But only for the specific derivation version whose positions were deleted. If a position existed in v3 but not in v4 (merged differently), the v3 `trade_coach_note` row would be deleted via cascade when v3 position is deleted. This is actually correct behavior. **The real zombie case:** a position that existed in both v3 and v4 accumulates one note per version, and old-version notes linger until manually cleaned. At DERIVATION_VERSION=4, there could be v1/v2/v3 notes per position. These are orphaned by intent (cache for historical analysis) but consume storage.
- **Fix:** Either document this as intentional (old cached notes are benign), or add a cleanup job that deletes `trade_coach_note WHERE derivation_version < DERIVATION_VERSION`.

### L-02: `import_record` stuck in `pending` after server crash — not resumable

- **File:** `src/server/import.ts:72–100` and `src/ingestion/orchestrator.ts`
- **Description:** For CSV imports, `startCsvImport` creates the `import_record` then immediately runs `orch.runImport` synchronously in the server function. If the server crashes mid-parse, the `import_record` remains in `pending` state forever. There is no retry mechanism, status recovery, or age-based cleanup. The import history UI will show a permanently-pending import.
- **Fix:** Either add a cron job to mark imports older than N hours in `pending`/`parsing`/`normalizing` as `failed`, or move CSV ingestion to an Inngest function (like HL wallet pull) with retry support.

### L-03: `digest_run` rows with `status: 'failed'` never retried or cleaned up

- **File:** `src/db/schema/narrator.ts:17` and `src/jobs/narrator.ts:232–241`
- **Description:** A `digest_run` that fails at the compose step has its status set to `failed`. There is no retry mechanism: the next week's digest scheduler computes a fresh `isoWeek` and would not re-attempt the failed week's digest. Failed rows accumulate in the table with no cleanup.
- **Fix:** Add an admin/ops endpoint to re-trigger compose for failed digest runs, or a cron job that re-enqueues `digest/compose` for failed rows from the current or prior week.

### L-04: Weighted-average entry price uses JavaScript `number` — potential float drift for large positions

- **File:** `src/derivation/merge.ts:214`
- **Description:** The running weighted-average entry calculation at line 214 (`b.currentAvgEntry = (b.currentAvgEntry * b.netSize + price * size) / (b.netSize + size)`) uses native JavaScript `number` (IEEE 754 double). For positions with many add-fills at high prices (e.g., BTC at $100,000+ with many partial adds), cumulative floating-point error can accumulate. The fill table stores prices at `numeric(36,18)` precision, but they are parsed with `parseFloat(s)` (merge.ts:46) before the weighted average is computed.
- **Fix:** Use a library like `decimal.js` or carry the sum as a rational number (numerator + denominator) for the weighted-average computation. Low urgency for typical trading sizes.

---

## INFO

### I-01: `fill.raw_import_row_id` FK is `ON DELETE no action` — prevents raw_import_row deletion

- **File:** `drizzle/0000_sturdy_inhumans.sql:120` and `src/db/schema/canonical.ts:21`
- **Description:** `fill.raw_import_row_id` references `raw_import_row.id` with `ON DELETE no action`. `raw_import_row` cascades from `import` (which cascades from `user`). When a user is deleted, Postgres deletes `fill` first (via `fill.user_id → user.id ON DELETE cascade`), freeing the FK reference before `raw_import_row` is deleted. So user deletion works. However, if someone attempted to delete a `raw_import_row` directly (outside user deletion), any referencing `fill` row would block the delete. There is no app code that does this currently.
- **Assessment:** Not a current bug. Document for future.

### I-02: `import.exchange_account_id` FK is `ON DELETE no action` — bidirectional deletion risk

- **File:** `drizzle/0000_sturdy_inhumans.sql:116`
- **Description:** `import.exchange_account_id → exchange_account.id ON DELETE no action`. Direct deletion of an `exchange_account` row would fail if any `import` references it. User deletion works because `import` rows cascade first. But an admin operation that deletes an `exchange_account` row directly (without deleting the user first) would raise an FK violation.
- **Fix:** Change to `ON DELETE set null` or add cascade. Low urgency since there is no admin "delete exchange account" feature.

### I-03: `digestRun.uniqWeek` constraint protects against duplicate digests — confirmed working

- **File:** `src/db/schema/narrator.ts:26` and `src/jobs/narrator.ts:175–177`
- **Description:** `digest_run_user_week_key UNIQUE(user_id, iso_week)` combined with `INSERT ... ON CONFLICT DO NOTHING` (followed by a SELECT to read the canonical row) correctly prevents duplicate digest runs for the same user/week. On a double-fire (see M-05), the second `composeDigestFn` invocation fetches the existing row and short-circuits if already `composed`. This design is solid.
- **Assessment:** No issue; documenting as working correctly.

### I-04: `market_candle` table has no TTL or row-count cap — unbounded growth

- **File:** `src/market/candleStore.ts:79–91`
- **Description:** `getCandles` persists every fetched candle with `onConflictDoNothing`. There is no retention policy, TTL column, or periodic cleanup. The table will grow proportionally with the number of unique (exchange, symbol, interval) pairs and the historical time range requested. For a small user base this is benign; for a multi-tenant deployment with many symbols, storage growth could become significant.
- **Fix:** Add a periodic cleanup job that deletes candles older than a configurable retention window (e.g., 90 days for 5m/15m intervals, longer for 1h/4h/1d).

### I-05: Position `planSnapshot*` columns preserve live plan values at link time — intended

- **File:** `src/server/plans.ts:237–241` and `src/server/trades.ts:200–212`
- **Description:** `linkPositionToPlan` snapshots plan values at link time into five columns. `server/trades.ts:200–212` reads snapshot values with fallback to live plan values ("for legacy links"). This fallback is intentional for positions linked before migration 0013 added the snapshot columns. No issue — documenting as working correctly.

---

## Migration Review

| Migration | Description | Issues |
|-----------|-------------|--------|
| `0000` | Initial schema (auth, ingestion, fill) | `fill.raw_import_row_id` and `import.exchange_account_id` use `ON DELETE no action` (see I-01, I-02). Both safe for user-deletion path. |
| `0001` | Derivation tables (position, metrics, findings) | `position_fill` FK to both `position` and `fill` cascade correctly. No issues. |
| `0002` | Drop `position_user_id_idx`, add `position_fill_position_id_idx` | Destructive: drops an index. Safe — index was redundant with composite indexes. |
| `0003` | Journal tables (tags, notes, reflections) | All FKs cascade correctly. No issues. |
| `0004` | Narrator tables (digest_run, digest_rule, trade_coach_note) | `trade_coach_note.user_id` and `position_id` both cascade. `digest_run` and `digest_rule` cascade from user. No issues. |
| `0005` | `day_of_week_metric` table | Composite PK, cascades from user. No issues. |
| `0006` | Add `r_multiple`, `max_drawdown_pct` to position | Both nullable — no default required for NOT NULL. No issues. |
| `0007` | Add `user.timezone` with DEFAULT 'UTC' NOT NULL | Correct: new NOT NULL column has a default, safe for existing rows. |
| `0008` | Add `trade_coach_note.referenced_position_ids` with DEFAULT '{}' NOT NULL | Correct: new NOT NULL array column has array default. |
| `0009` | Add enum values 'bybit', 'okx' to `exchange_kind` | `ALTER TYPE ... ADD VALUE` is irreversible but not destructive. |
| `0010` | Add `user.digest_enabled` DEFAULT true NOT NULL | Correct default for existing users. |
| `0011` | Add `trade_plan` table and `position.plan_id` | `position.plan_id → trade_plan.id ON DELETE set null` is correct. `trade_plan.user_id` cascades. |
| `0012` | Add `market_candle` table | No user FK (shared table). PK correctly covers uniqueness. |
| `0013` | Add `planSnapshot*` columns to `position` | All nullable — safe for existing rows. |
| `0014` | Add `trade_plan.reminder_sent_at` | Nullable — safe for existing rows. |
| `0015` | Add `user_detector` table | Cascades from user. No issues. |
| `0016` | Add `user.disabled_builtin_detectors` DEFAULT '{}' NOT NULL | Correct default for existing rows. |

**Overall migration assessment:** All migrations are additive (new tables, new nullable/defaulted columns, enum value additions, index changes). No data-destructive DDL found. The `DROP INDEX` in 0002 is a safe index removal. All NOT NULL columns added to existing tables have appropriate defaults.

---

## Areas Checked — No Issues Found

- `fill_user_exchange_external_id` unique constraint: correctly scoped to `(userId, exchange, externalId)`, preventing duplicate fills from the same exchange across re-imports.
- `composeDigestFn` idempotency: `ON CONFLICT DO NOTHING` + fetch-canonical + status short-circuit is correct. `digest_run_user_week_key` prevents duplicate digest runs.
- `hlWalletPullFn` concurrency: Two simultaneous HL wallet pulls for the same address would both attempt to insert fills; `fill_user_exchange_external_id` unique constraint ensures `onConflictDoNothing` silently skips duplicates. Position derivation runs sequentially per user (concurrency key). Idempotent.
- `rederiveFn` idempotency: `runDerivation` is deterministic given the same fills. `persistDerivation` does delete-then-insert per version. Safe to re-run (modulo the transaction concern in C-01).
- `upsertTradeNote`: Uses `onConflictDoUpdate` on `(userId, positionId)`. Two simultaneous calls result in last-write-wins on `bodyMarkdown`. Safe.
- `deriveOnIngestionCompleteFn`: `concurrency: { limit: 3, key: 'event.data.userId' }` caps concurrent derivations per user. The `mark-deriving` step is idempotent (idempotent UPDATE). Safe.
- FK cascade trace on user deletion: `user` → cascades to `account`, `session`, `exchange_account`, `import`, `raw_import_row`, `fill`, `position`, `positionFill`, `dailyMetric`, `assetMetric`, `sessionMetric`, `dayOfWeekMetric`, `summaryRollup`, `finding`, `tradeNote`, `positionTag`, `positionReflection`, `mistakeTag`, `setupTag`, `tradePlan`, `digestRun`, `digestRule`, `tradeCoachNote`, `userDetector`. All covered. `market_candle` has no user FK (intentionally shared). `verification` has no user FK (also intentional — Better Auth managed).
- `position.planId ON DELETE set null`: When a `tradePlan` is deleted, `position.planId` is set to NULL. `planSnapshot*` columns retain their values (no cascade on those columns). This is correct — the snapshot preserves the plan state at trade execution time even if the plan is later deleted.
- Decimal precision in `persist.ts`: All numeric values are converted via `String(n)` before insert. `Number(r.field)` is used at read time in `dashboard.ts`. This roundtrip preserves precision up to the `float64` mantissa (~15–17 significant digits). Postgres stores at full `numeric(36,18)` precision. Loss only occurs in JS aggregation math, which is acceptable for display purposes.
- `dayOfWeekUtc` convention: ISO 8601 style (Mon=0..Sun=6) is consistently applied in both `derivation/metrics/dayOfWeek.ts` and `server/dashboard.ts` (filtered path, line 297). Fast path reads from the pre-computed table which was populated with the same convention. Consistent.
