# API Contracts Audit — 2026-04-24

**Auditor:** Claude Sonnet 4.6 (subagent, code-review mode)
**Scope:** Every `createServerFn` input validator, return shape, serialization safety, batch caps, pagination, domain/DB drift, fact bundle alignment.
**Date reviewed:** 2026-04-22 (files as at commit `2488536`)

---

## Summary

| Severity | Count |
|----------|-------|
| HIGH     | 4     |
| MEDIUM   | 8     |
| LOW      | 5     |
| INFO     | 5     |
| **Total** | **22** |

---

## Server fn inventory

### `src/server/dashboard.ts`

| Name | Method | Input schema | Return type | Ownership check | Demo guard | Notes |
|------|--------|-------------|-------------|-----------------|------------|-------|
| `getDashboardBundle` | GET | `z.object({ range, from, to, sym, inst, tag })` — all `string.optional()`, no max-length | Inferred (no explicit `Promise<DashboardBundle>`) | ✓ (userId from session) | ✗ | No length limits on filter strings; findings loaded unbounded before JS slice |

### `src/server/trades.ts`

| Name | Method | Input schema | Return type | Ownership check | Demo guard | Notes |
|------|--------|-------------|-------------|-----------------|------------|-------|
| `getTradeList` | GET | `z.object({...})` — `limit` max 500, `offset` min 0, `symbols` array no max size | `Promise<{ rows: TradeListRow[]; total: number }>` ✓ | ✓ | ✗ | `symbols` array unbounded |
| `getTradeDetail` | GET | `z.object({ positionId: z.string().min(1) })` | `Promise<TradeDetailBundle>` ✓ | ✓ | ✗ | — |
| `getPositionsByIds` | POST | `z.object({ ids: z.array(z.string().min(1)).min(1).max(10) })` | `Promise<PositionRef[]>` ✓ | ✓ (inArray filtered by userId) | ✗ | — |

### `src/server/journal.ts`

| Name | Method | Input schema | Return type | Ownership check | Demo guard | Notes |
|------|--------|-------------|-------------|-----------------|------------|-------|
| `upsertTradeNote` | POST | `z.object({ positionId: min(1), bodyMarkdown: max(20_000) })` | `{ ok: true }` (inferred) | ✓ | ✓ | — |
| `applyPositionTag` | POST | `z.object({ positionIds: array.min(1).max(200), kind, setupTagId?, mistakeTagId? })` + refine | `{ applied: number }` (inferred) | ✓ (batch ownership verified) | ✓ | — |
| `removePositionTag` | POST | `z.object({ positionId: min(1), kind, setupTagId?: string, mistakeTagId?: string })` | `{ ok: true }` (inferred) | ✓ (via eq userId) | ✓ | `setupTagId`/`mistakeTagId` optional strings have no `.min(1)` |
| `createTag` | POST | `z.object({ kind, label: min(1).max(60), color: regex hex? })` | `{ id, kind, label, color }` (inferred) | ✓ | ✓ | — |
| `upsertReflection` | POST | `z.object({ positionId, confidence: int.min(1).max(5).nullable(), emotionalState: enum.nullable(), reflectionMarkdown: max(5_000).nullable() })` | `{ ok: true }` (inferred) | ✓ | ✓ | — |
| `listTags` | GET | None (no `.inputValidator()`) | `{ setup, mistake }` (inferred) | ✓ | ✗ | No inputValidator; GET with no input is fine, but no demo guard |

### `src/server/plans.ts`

| Name | Method | Input schema | Return type | Ownership check | Demo guard | Notes |
|------|--------|-------------|-------------|-----------------|------------|-------|
| `createPlan` | POST | `z.object({ symbol: min(1).max(64), intendedSide: enum, entryPrice?: positive, stopPrice?: positive, targetPrice?: positive, plannedSize?: positive, rationale?: max(4000) })` | `Promise<{ id: string }>` ✓ | ✓ | ✓ | — |
| `listPlans` | GET | `z.object({ includeArchived?: bool, symbol?: string })` — no max on symbol | `Promise<TradePlan[]>` ✓ | ✓ | ✗ | Unbounded list (no pagination) |
| `getPlan` | GET | `z.object({ id: min(1) })` | `Promise<TradePlan & { linkedPositionIds }>` ✓ | ✓ | ✗ | — |
| `updatePlan` | POST | `z.object({ id, symbol?, intendedSide?, entryPrice?, stopPrice?, targetPrice?, plannedSize?, rationale? })` | `{ ok: true }` (inferred) | ✓ (WHERE includes userId) | ✓ | — |
| `archivePlan` | POST | `z.object({ id: min(1), archived: bool })` | `{ ok: true, archived }` (inferred) | ✓ | ✓ | — |
| `linkPositionToPlan` | POST | `z.object({ positionId: min(1), planId: min(1) })` | `{ ok: true }` (inferred) | ✓ | ✓ | — |
| `unlinkPositionFromPlan` | POST | `z.object({ positionId: min(1) })` | `{ ok: true }` (inferred) | ✓ | ✓ | — |

### `src/server/rules.ts`

| Name | Method | Input schema | Return type | Ownership check | Demo guard | Notes |
|------|--------|-------------|-------------|-----------------|------------|-------|
| `adoptRule` | POST | `z.object({ detectorId: min(1), ruleText: min(1).max(180) })` | `{ ruleId, ruleText, createdAt: string }` (inferred) | ✓ | ✓ | — |
| `archiveRule` | POST | `z.object({ ruleId: min(1) })` | `{ ruleId, archived }` (inferred) | ✓ (WHERE includes userId) | ✓ | — |
| `getRuleViolationsThisWeek` | GET | `z.object({ ruleId: min(1) })` | `{ violations: number, ruleId }` (inferred) | ✓ | ✗ | — |

### `src/server/coach.ts`

| Name | Method | Input schema | Return type | Ownership check | Demo guard | Notes |
|------|--------|-------------|-------------|-----------------|------------|-------|
| `getTradeCoach` | POST | `z.object({ positionId: min(1) })` | `TradeCoachResult` via `satisfies` ✓ | ✓ | ✗ | No rate-limit guard; each call may invoke LLM |

### `src/server/customDetectors.ts`

| Name | Method | Input schema | Return type | Ownership check | Demo guard | Notes |
|------|--------|-------------|-------------|-----------------|------------|-------|
| `createCustomDetector` | POST | `z.object({ name: slug/max(64), title: min(1).max(200), severity: enum, predicate: PositionPredicateSchema })` | `Promise<{ id: string }>` ✓ | ✓ | ✓ | — |
| `listCustomDetectors` | GET | `.inputValidator((d) => d)` — passthrough, no schema | `Promise<UserDetectorDefinition[]>` ✓ | ✓ | ✗ | Passthrough validator; unbounded list |
| `getCustomDetector` | GET | `z.object({ id: min(1) })` | `Promise<UserDetectorDefinition>` ✓ | ✓ | ✗ | — |
| `updateCustomDetector` | POST | `z.object({ id, name?, title?, severity?, predicate? })` | `{ ok: true }` (inferred) | ✓ | ✓ | — |
| `toggleCustomDetector` | POST | `z.object({ id: min(1), enabled: bool })` | `{ ok: true, enabled }` (inferred) | ✓ | ✓ | — |
| `deleteCustomDetector` | POST | `z.object({ id: min(1) })` | `{ ok: true }` (inferred) | ✓ | ✓ | — |
| `importCustomDetectors` | POST | `z.object({ detectors: array.max(100) })` | `Promise<{ imported, skipped, errors }>` ✓ | ✓ | ✓ | — |

### `src/server/customDetectorsPreview.ts`

| Name | Method | Input schema | Return type | Ownership check | Demo guard | Notes |
|------|--------|-------------|-------------|-----------------|------------|-------|
| `previewCustomDetector` | POST | `PositionPredicateSchema` (z.lazy recursive) | `Promise<{ matched, total, sample }>` ✓ | ✓ | ✗ | Loads ALL user positions in memory; no demo guard |

### `src/server/digestPreview.ts`

| Name | Method | Input schema | Return type | Ownership check | Demo guard | Notes |
|------|--------|-------------|-------------|-----------------|------------|-------|
| `previewDigest` | GET | None (no `.inputValidator()`) | `DigestPreview` via `satisfies` ✓ | ✓ | ✗ | No inputValidator; always hits LLM |
| `sendDigestNow` | POST | None (no `.inputValidator()`) | `{ digestRunId, enqueued }` (inferred) | ✓ | ✓ | No inputValidator |

### `src/server/exportData.ts`

| Name | Method | Input schema | Return type | Ownership check | Demo guard | Notes |
|------|--------|-------------|-------------|-----------------|------------|-------|
| `exportAllData` | GET | None (no `.inputValidator()`) | `ExportBundle` (inferred, fields typed `unknown[]`) | ✓ | ✗ | Return type uses `unknown[]` for most arrays; no demo guard |

### `src/server/import.ts`

| Name | Method | Input schema | Return type | Ownership check | Demo guard | Notes |
|------|--------|-------------|-------------|-----------------|------------|-------|
| `validateCsvImport` | POST | `z.object({ csvContent: min(1), source: enum })` — no max on csvContent | Inferred (adapter `ValidationReport`) | ✓ | ✗ | No CSV size cap; no demo guard |
| `startCsvImport` | POST | `z.object({ csvContent: min(1), source: enum, fileName?: string })` — no max on csvContent or fileName | `{ importId, ...result }` (inferred) | ✓ | ✓ | No CSV size cap |
| `startWalletImport` | POST | `z.object({ walletAddress: regex /^0x[0-9a-fA-F]{40}$/ })` | `{ importId }` (inferred) | ✓ | ✓ | — |
| `getImportHistory` | GET | None (no `.inputValidator()`) | `SerializedImportRecord[]` via cast | ✓ | ✗ | No inputValidator; list bounded at 50 |
| `getImportStatus` | GET | `z.object({ importId: z.string() })` — no `.min(1)` | `SerializedImportRecord \| null` via cast | ✓ (WHERE includes userId) | ✗ | `importId` can be empty string |

### `src/server/market.ts`

| Name | Method | Input schema | Return type | Ownership check | Demo guard | Notes |
|------|--------|-------------|-------------|-----------------|------------|-------|
| `getCandlesForPosition` | POST | `z.object({ positionId: min(1) })` | `Promise<CandlesForPosition>` ✓ | ✓ | ✗ | Candle range derived from position — no upper bound |
| `getBtcEquityContext` | POST | `z.object({ from: datetime(), to: datetime() })` — no max range | `Promise<Array<{ date, priceUsd }>>` ✓ | ✓ | ✗ | Arbitrary date range; can trigger many Binance fetches |

### `src/server/userPrefs.ts`

| Name | Method | Input schema | Return type | Ownership check | Demo guard | Notes |
|------|--------|-------------|-------------|-----------------|------------|-------|
| `setTimezone` | POST | `z.object({ timezone: min(1).max(64) })` + runtime IANA validation | `{ ok, timezone }` (inferred) | ✓ | ✗ | No demo guard |
| `setDigestEnabled` | POST | `z.object({ enabled: bool })` | `{ ok, enabled }` (inferred) | ✓ | ✓ | — |
| `setBuiltinDetectorEnabled` | POST | `z.object({ detectorId: z.enum(BUILTIN_DETECTOR_IDS), enabled: bool })` | `{ ok, enabled, disabled }` (inferred) | ✓ | ✓ | — |
| `getBuiltinDetectorSettings` | GET | None (no `.inputValidator()`) | `Promise<{ disabled: string[] }>` ✓ | ✓ | ✗ | — |

### `src/server/seedJournal.ts`

No `createServerFn` — exports a plain async helper `ensureDefaultMistakeTags`. Not a server fn.

### `src/server/demoSeed.ts`

No `createServerFn` — exports a plain async helper `seedDemoUser`. Not a server fn.

---

## Findings by severity

---

### H-01: `startCsvImport` and `validateCsvImport` accept unbounded CSV bodies

- **File:** `src/server/import.ts:17` and `src/server/import.ts:38`
- **Issue:** Both `csvContent` fields use `z.string().min(1)` with no upper bound. A client can POST an arbitrarily large string (e.g. 100 MB), consuming server memory and CPU during parsing.
- **Impact:** DoS vector — memory exhaustion in the serverless function or long-running parse blocks other requests. `validateCsvImport` lacks even a demo guard, so unauthenticated-but-authed demo users can also trigger this.
- **Fix:**
  ```ts
  csvContent: z.string().min(1).max(50_000_000), // ~50 MB hard cap
  fileName: z.string().max(255).optional(),
  ```
  Additionally, add `assertNotDemo` to `validateCsvImport` if demo users should not trigger import pre-validation at all.

---

### H-02: `getBtcEquityContext` accepts an arbitrary date range, triggering unbounded external Binance fetches

- **File:** `src/server/market.ts:74–101`
- **Issue:** The input schema only validates that `from` and `to` are ISO datetime strings. There is no cap on the span between them. `candleStore.getCandles` will loop fetching 1000-bar chunks from Binance until the entire range is covered, store them all, and return them as a single array to the client.
- **Impact:** A request spanning years at `1d` interval = ~1–4 years × 365 bars — one fetch. At `5m` interval equivalent it would be thousands. Even with the `'1d'` interval hardcoded in `getBtcEquityContext`, a range of 10 years yields 3,650 rows. More critically, if the symbol+interval is not already cached, this makes live Binance API calls serially — rate-limit risk and latency spike. Return payload is also large (3,650+ JSON objects per request).
- **Fix:**
  ```ts
  z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  }).refine(d => {
    const rangeMs = new Date(d.to).getTime() - new Date(d.from).getTime()
    return rangeMs > 0 && rangeMs <= 365 * 86_400_000 // max 1 year
  }, 'Date range must be 1–365 days')
  ```

---

### H-03: `getDashboardBundle` loads ALL findings for the user into memory before filtering

- **File:** `src/server/dashboard.ts:382–396`
- **Issue:** When `ids.length > 0`, the handler fetches every finding row for `(userId, version)` without any `LIMIT`, then filters in JS to those referencing filtered positions, sorts by severity, and slices to 5. A power user with thousands of findings (each with a `referencedPositionIds` array) will cause a very large DB result set and a potentially slow in-memory join on every dashboard load.
- **Impact:** Latency and memory spike proportional to the total finding count — a user with 5,000 findings pays the full scan cost every page view.
- **Fix:** Push the filter into the DB using a PostgreSQL array overlap operator:
  ```ts
  .where(and(
    eq(finding.userId, userId),
    eq(finding.derivationVersion, version),
    sql`${finding.referencedPositionIds} && ARRAY[${sql.join(ids.map(id => sql`${id}::text`))}]`,
  ))
  .orderBy(...)
  .limit(25) // fetch a small candidate set, then sort in JS
  ```

---

### H-04: `previewCustomDetector` loads ALL positions in memory and has no demo guard

- **File:** `src/server/customDetectorsPreview.ts:23–76`
- **Issue:** The handler fetches every position row for the user at the current derivation version, plus all their tags, with no limit. This is a heavy read for power users. Additionally, there is no `assertNotDemo` guard — the demo user can trigger the same full position scan.
- **Impact:** Heavy DB read on every predicate preview call; demo user can trigger it too.
- **Fix:** Add `assertNotDemo`. Consider adding a hard `LIMIT` (e.g. 5,000 rows) to the position query and documenting that the preview is sampled for very large datasets.

---

### M-01: `listCustomDetectors` uses a passthrough input validator `(d) => d`

- **File:** `src/server/customDetectors.ts:68`
- **Issue:** The `inputValidator` is `(d: unknown) => d`, which accepts and forwards any input without validation or type narrowing. While this particular handler uses no input data, the pattern defeats the purpose of the validator and may silently accept unexpected query parameters.
- **Impact:** No immediate security impact (handler ignores `data`), but it disables TanStack's input typing and prevents future maintainers from noticing the gap.
- **Fix:**
  ```ts
  export const listCustomDetectors = createServerFn({ method: 'GET' })
    .inputValidator((d: unknown) => z.object({}).parse(d))
    .handler(...)
  ```

---

### M-02: `getDashboardBundle` handler has no explicit return type annotation

- **File:** `src/server/dashboard.ts:180`
- **Issue:** The handler is `async ({ data }) => { ... }` with no `Promise<DashboardBundle>` annotation or `satisfies DashboardBundle` assertion. The return type is fully inferred from the literal object returned. Any accidental field rename or addition will silently change the API contract without a compiler error.
- **Impact:** Type drift goes undetected at compile time; consumers relying on `DashboardBundle` could silently break.
- **Fix:**
  ```ts
  .handler(async ({ data }): Promise<DashboardBundle> => {
  ```

---

### M-03: `ExportBundle` return fields typed as `unknown[]`

- **File:** `src/server/exportData.ts:25–32`
- **Issue:** `positions`, `fills`, `notes`, `tags.setup`, `tags.mistake`, `positionTags`, `reflections`, `findings`, `rules`, and `imports` are all typed as `unknown[]`. The actual values are Drizzle row types containing `Date` objects and `numeric` (string) fields. TanStack Start's `ValidateSerializableMapped` will serialize `Date` values as ISO strings, which is correct, but calling code receives `unknown[]` and must cast for any use. Additionally, the raw DB rows for `positions` contain `numeric`-typed strings (not `number`) that are returned as-is — diverging from all other endpoints which convert via `Number()`.
- **Impact:** Consumers of this export cannot type-check; the raw numeric strings in `positions` are inconsistent with the number types in `TradeListRow` / `TradeDetailBundle`.
- **Fix:** Define a proper `PositionExport` type that mirrors the row with Decimals converted to strings (or numbers), and use `satisfies ExportBundle` on the return.

---

### M-04: `TradePlan` domain type missing `reminderSentAt` field present in DB schema

- **File:** `src/domain/plan.ts` vs `src/db/schema/journal.ts:87`
- **Issue:** The `tradePlan` table has a `reminderSentAt: timestamp` column that is not reflected in the `TradePlan` domain type. `listPlans` and `getPlan` map from DB rows using `r.id`, `r.symbol`, etc., but do not expose `reminderSentAt`. If a future feature reads this field from a typed `TradePlan`, it will appear as `undefined`.
- **Impact:** Low immediate impact (field is unused in current UI), but the domain type is stale — a documentation and drift issue.
- **Fix:** Either add `reminderSentAt: Date | null` to `TradePlan`, or explicitly strip it in the DB schema type comment.

---

### M-05: `Position` domain type missing `planSnapshot*` and `rMultiplePlanned` fields

- **File:** `src/domain/position.ts` vs `src/db/schema/derivation.ts:33–37`
- **Issue:** The `position` table has five `planSnapshot*` columns (`planSnapshotEntryPrice`, `planSnapshotStopPrice`, `planSnapshotTargetPrice`, `planSnapshotSize`, `planSnapshotRationale`) and they are used by `getTradeDetail` (trades.ts:200–212) to populate `linkedPlan`. The `Position` domain type has no snapshot fields. `previewCustomDetector` maps DB rows to `Position` objects but omits all snapshot fields (they are irrelevant to the predicate evaluator). However, code that uses `Position` as a full representation of a position row will be unaware of the snapshot state.
- **Impact:** The domain type is not a complete model of the DB entity. Any code reasoning about plan linkage using `Position` will miss snapshot values.
- **Fix:** Add the snapshot fields (nullable) to `Position`, or create a separate `PositionRow` type for the full DB representation.

---

### M-06: `getDashboardBundle` returns `DashboardFinding.evidence` via an unsafe cast

- **File:** `src/server/dashboard.ts:452`
- **Issue:** `f.evidence as DashboardFinding['evidence']` casts the raw `jsonb` value (which can be arbitrarily nested JSON) to `Record<string, string | number | boolean | null | Array<string | number | boolean | null>>`. The actual evidence objects (e.g. `RevengeTradingEvidence`) contain nested arrays of objects (`instances: Array<{...}>`). The cast silently lies about the shape — the nested object arrays will not conform to `Array<string | number | boolean | null>`.
- **Impact:** TypeScript consumers of `DashboardFinding.evidence` using array element access will get the wrong type assertion. At runtime TanStack serializes the actual JSON fine, but any code doing `evidence.instances[0].minutesBetween` will have a TypeScript type error hidden by the cast.
- **Fix:** Widen `DashboardFinding.evidence` to a recursive `JsonValue` type matching the actual evidence shapes, or use the per-detector evidence union type:
  ```ts
  evidence: JsonValue // where JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }
  ```

---

### M-07: `getImportStatus` accepts empty `importId`

- **File:** `src/server/import.ts:184`
- **Issue:** `z.object({ importId: z.string() })` — no `.min(1)`. An empty-string `importId` passes validation and executes a DB query `WHERE id = ''`, returning `null` (a valid and allowed response), but reveals that the empty ID was accepted.
- **Fix:** `importId: z.string().min(1)`

---

### M-08: `CoachFactBundle.position.rMultiple` always hardcoded to `null` in `buildCoachFacts`

- **File:** `src/narrator/facts/coachFacts.ts:157`
- **Issue:** `rMultiple: null` is hardcoded even though `pos.rMultiple` is available from the DB row and could be `number | null`. The `CoachFactBundle` type correctly declares `rMultiple: number | null`, but the builder always sends `null`, so the LLM never has access to the actual R-multiple of the coached trade.
- **Impact:** The coach prompt is missing a key grounding fact. The LLM cannot reference R-multiple when it is defined.
- **Fix:**
  ```ts
  rMultiple: pos.rMultiple != null ? Number(pos.rMultiple) : null,
  ```

---

### L-01: `removePositionTag` optional tag ID fields have no `.min(1)` constraint

- **File:** `src/server/journal.ts:81–82`
- **Issue:** `setupTagId: z.string().optional()` and `mistakeTagId: z.string().optional()` will accept an empty string `""`, which could produce unexpected `WHERE setup_tag_id = ''` conditions in the delete query.
- **Fix:**
  ```ts
  setupTagId: z.string().min(1).optional(),
  mistakeTagId: z.string().min(1).optional(),
  ```

---

### L-02: `listPlans` is unbounded — no pagination

- **File:** `src/server/plans.ts:75–115`
- **Issue:** `listPlans` returns all non-archived plans for the user with no `LIMIT`. A user with hundreds of plans triggers a large DB read and a full payload on every plan list render. Additionally, the handler cross-joins with `position` to count linked positions (`inArray(position.planId, ids)`) — another potentially large in-memory pass.
- **Impact:** At scale (>500 plans), this becomes slow. Not an immediate DoS risk since plans are user-created, but a latency concern.
- **Fix:** Add `limit`/`offset` pagination, or a hard cap (e.g. 500 rows) with a `hasMore` flag. The linked-position count query already handles large `ids` arrays via `inArray`.

---

### L-03: `getDashboardBundle` input filter strings have no max-length

- **File:** `src/server/dashboard.ts:22–29`
- **Issue:** `sym`, `from`, `to`, `inst`, `tag`, and `range` are all `z.string().optional()` without `.max()`. A very long `sym` string will propagate into `parseFilters`, be split on commas, and each element passed to `inArray(position.symbol, ...)` — valid SQL but wasteful. A very long `tag` string similarly results in a large `setupTagIds` array.
- **Fix:** Add `.max(500)` to `sym` and `tag`, and `.max(10)` to `from`, `to`, `inst`, `range`.

---

### L-04: `setTimezone` lacks a demo guard

- **File:** `src/server/userPrefs.ts:15`
- **Issue:** The demo user can call `setTimezone` and permanently change the timezone of the shared `demo-user-0001` row. The other `setDigestEnabled` and `setBuiltinDetectorEnabled` mutations are correctly guarded with `assertNotDemo`, but `setTimezone` is not.
- **Fix:** Add `assertNotDemo(session.user)` after the session check.

---

### L-05: `listTags` and `getBuiltinDetectorSettings` have no `inputValidator`

- **File:** `src/server/journal.ts:164`; `src/server/userPrefs.ts:65`
- **Issue:** Both are GET handlers with no input, defined without `.inputValidator()`. This is not a runtime risk but is inconsistent with the rest of the codebase and means TanStack cannot type the input parameter.
- **Fix:** Add `.inputValidator((d: unknown) => z.object({}).parse(d))` for consistency.

---

### INFO-01: `getTradeList` `symbols` array has no upper-bound cap

- **File:** `src/server/trades.ts:13`
- **Issue:** `symbols: z.array(z.string()).optional()` — no `.max()`. A request with 10,000 symbols produces `WHERE symbol = ANY(...)` with 10,000 elements. Contrasted with `getPositionsByIds` which caps at 10.
- **Recommendation:** Add `.max(100)` or similar.

---

### INFO-02: `PositionPredicateSchema` uses `z.lazy()` — serialization is safe but depth is uncapped

- **File:** `src/domain/userDetector.ts:54–61`
- **Issue:** `z.lazy(() => z.object({ ...leafPredicateFields, all: z.array(PositionPredicateSchema).optional(), any: ..., not: ... }))` allows arbitrarily deep nesting. The predicate is stored as `jsonb` and re-validated on each `createCustomDetector`/`updateCustomDetector` call, so it round-trips through TanStack Start cleanly (plain object). However, a deeply nested predicate (e.g., 1,000 levels of `not: { not: { not: ... } }`) could cause stack overflow in `evaluatePredicate` and extremely slow Zod validation.
- **Recommendation:** Add a max nesting depth check (e.g., a recursive counter in the evaluator) or a Zod `.superRefine` that rejects depth > 10.

---

### INFO-03: `previewDigest` always invokes the LLM — no cooldown or rate limit

- **File:** `src/server/digestPreview.ts:27`
- **Issue:** `previewDigest` is a GET handler with no throttle. Every call composes a full digest (two LLM calls on retry), consuming tokens. The budget guard exists (`getNarratorBudgetStatus`) but it is only a soft fallback, not a hard rate limit. A user refreshing the preview page rapidly will consume tokens proportional to their refresh rate.
- **Recommendation:** Cache the preview result (e.g., in a `digestRun` row marked `preview`) for at least 10 minutes to avoid redundant LLM calls.

---

### INFO-04: Dashboard `topFindings` includes `userId` in each finding row

- **File:** `src/server/dashboard.ts:446–457`
- **Issue:** Each finding in `topFindings` includes `userId: f.userId`. Since `userId` is already known to the client (via the session), this is not a security leak, but it's unnecessary bloat in the payload and not included in the `DashboardFinding` domain type (which has `userId`). This is consistent with the domain type, so no type drift, but the field could be dropped to reduce payload size.
- **Recommendation:** Omit `userId` from `topFindings` entries since it is redundant and adds ~30 bytes per finding.

---

### INFO-05: `DigestFactBundle.biggestWin` and `biggestLoss` always have `rMultiple: null`

- **File:** `src/narrator/facts/digestFacts.ts:186–191`
- **Issue:** Both `biggestWin` and `biggestLoss` hardcode `rMultiple: null` even though `pos.rMultiple` is available from the DB row. The `DigestFactBundle` type correctly declares `rMultiple: number | null`. This means the digest narrator never receives R-multiple context for the featured trades.
- **Recommendation:** Populate `rMultiple: topWin.rMultiple != null ? Number(topWin.rMultiple) : null` (same for loss).

---

## Type drift summary

| Domain type | DB table | Drift |
|---|---|---|
| `TradePlan` (`src/domain/plan.ts`) | `trade_plan` (`src/db/schema/journal.ts`) | Missing `reminderSentAt` field |
| `Position` (`src/domain/position.ts`) | `position` (`src/db/schema/derivation.ts`) | Missing 5 `planSnapshot*` columns and `rMultiplePlanned` (latter is computed, not stored) |
| `ExportBundle` (`src/server/exportData.ts`) | multiple | Most array fields typed `unknown[]` — no structural typing |

## Serialization safety summary

| Handler | Contains `Date` in return | TanStack-safe? | Notes |
|---|---|---|---|
| `getDashboardBundle` | Yes (`periodStart`, `periodEnd` in `topFindings`; `lastDerivationAt: null`) | Yes — TanStack serializes `Date` → ISO string | `evidence` cast is unsound but serializes fine at runtime |
| `getTradeDetail` | Yes (`openedAt`, `closedAt`, `executedAt`, `updatedAt`) | Yes | |
| `exportAllData` | Yes (many `Date` fields in raw rows) | Yes | Raw position rows contain `numeric` as strings — inconsistent with other endpoints |
| `listPlans` / `getPlan` | Yes (`createdAt`, `archivedAt`) | Yes | |
| `listCustomDetectors` | Yes (`createdAt`, `updatedAt`) | Yes | |
| `previewDigest` | No (`DigestPreview` uses ISO strings throughout) | Yes | |
| `getTradeCoach` | No (`cachedAt` is `string`) | Yes | |
| `UserDetectorDefinition.predicate` | No (plain object, `z.lazy` validated) | Yes — plain JSON object round-trips cleanly | |
