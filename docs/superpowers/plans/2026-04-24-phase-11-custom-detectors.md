# Phase 11 — User-Defined Custom Detectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`.

**Goal:** Let users define their own behavioral detectors without writing code. A declarative predicate language over closed positions + their fills + tags. No eval, no sandbox — just JSON rules evaluated in-process. Custom detectors run as part of every derivation and emit findings with stable IDs, so the AI coach and dashboard surface them alongside the 12 built-ins.

**Architecture:**
- **Declarative predicate language, not a DSL.** Vocabulary: `symbol`, `instrumentType`, `side`, `dayOfWeekUtc`, `hourOfDayUtc`, `pnl`, `pnlPct`, `holdDurationMins`, `hasTag`, `minLossStreak`. Comparison operators: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`. Composition: `all` (AND), `any` (OR), `not`. Stored as JSONB. Zod-validated on write.
- **Evaluation is a pure function** over `Position[]` + `Finding[]` (for streak context) + `positionTag[]` (for `hasTag`). No DB inside; runner threads the data in.
- **One new table:** `user_detector` (id, userId, name, title, severity, predicateJson, enabled, derivationVersion_lastRun). Builtins + user detectors emit findings through the same persist path; findings use `detectorId: 'custom:<userDetectorId>'`.
- **DetectorId type broadens** to `BuiltinDetectorId | \`custom:${string}\`` — existing enum stays for the 12 built-ins; custom IDs are a separate template-literal branch. `DETECTOR_LABELS` map + AI grounding validator + findings UI adapt.
- **Admin UI** at `/detectors/custom` — list existing detectors; create via a guided form (pick field → pick operator → pick value); no raw-JSON editor in v1.
- **Bump `DERIVATION_VERSION` to 4.** Users must `pnpm rederive` once; existing built-in findings migrate unchanged.

**Tech Stack:** Existing. No new deps.

---

## Task 1 — Predicate schema + evaluator

**Files:**
- Create: `src/domain/userDetector.ts` — types + zod schema
- Create: `src/derivation/customEvaluator.ts` — pure predicate evaluator
- Test: `tests/unit/derivation/customEvaluator.test.ts`

**Zod schema** for `PositionPredicate`:
```ts
// Value comparison operators
const numComp = z.object({
  eq: z.number().optional(),
  ne: z.number().optional(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
}).refine(v => Object.keys(v).length > 0, 'at least one op')

const strComp = z.object({
  eq: z.string().optional(),
  in: z.array(z.string()).optional(),
}).refine(v => v.eq !== undefined || v.in !== undefined, 'at least one op')

// Leaf predicates (all optional — unset means "don't filter on this dimension")
const LeafPredicate = z.object({
  symbol: strComp.optional(),
  instrumentType: z.enum(['spot', 'perp']).optional(),
  side: z.enum(['long', 'short']).optional(),
  dayOfWeekUtc: numComp.optional(),              // 0..6 where 0=Sun
  hourOfDayUtc: numComp.optional(),              // 0..23
  pnl: numComp.optional(),                       // USD
  pnlPct: numComp.optional(),                    // e.g., -0.02 = -2%
  holdDurationMins: numComp.optional(),
  hasTag: z.string().optional(),                 // mistake-tag label or id
  minLossStreak: z.number().int().positive().optional(),  // previous N trades all lost
})

// Recursive composition
type PositionPredicate = z.infer<typeof LeafPredicate> & {
  all?: PositionPredicate[]
  any?: PositionPredicate[]
  not?: PositionPredicate
}

export const PositionPredicateSchema: z.ZodType<PositionPredicate> = z.lazy(() =>
  LeafPredicate.extend({
    all: z.array(PositionPredicateSchema).optional(),
    any: z.array(PositionPredicateSchema).optional(),
    not: PositionPredicateSchema.optional(),
  }),
)
```

**`UserDetectorDefinition`:**
```ts
export type UserDetectorDefinition = {
  id: string
  userId: string
  name: string                           // internal, e.g. "btc-friday-losses"
  title: string                          // user-facing, e.g. "You lose on BTC Fridays"
  severity: 'info' | 'warning' | 'critical'
  predicate: PositionPredicate
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}
```

**Evaluator:**
```ts
export type EvalContext = {
  positions: Position[]
  positionTags: Array<{ positionId: string; tagId: string; label: string; kind: 'setup' | 'mistake' }>
  // Optional, for minLossStreak — ordered by closedAt asc
  lossStreaks?: Map<string, number>      // positionId → # of consecutive losses ending at this position
}

export function evaluatePredicate(pos: Position, pred: PositionPredicate, ctx: EvalContext): boolean {
  // 1. Check composition operators first
  if (pred.all) return pred.all.every(p => evaluatePredicate(pos, p, ctx))
  if (pred.any) return pred.any.some(p => evaluatePredicate(pos, p, ctx))
  if (pred.not) return !evaluatePredicate(pos, pred.not, ctx)

  // 2. Check each leaf condition present
  if (pred.symbol && !checkStr(pos.symbol, pred.symbol)) return false
  if (pred.instrumentType && pos.instrumentType !== pred.instrumentType) return false
  if (pred.side && pos.side !== pred.side) return false
  if (pred.dayOfWeekUtc && !checkNum(pos.closedAt ? pos.closedAt.getUTCDay() : pos.openedAt.getUTCDay(), pred.dayOfWeekUtc)) return false
  if (pred.hourOfDayUtc && !checkNum(pos.openedAt.getUTCHours(), pred.hourOfDayUtc)) return false
  if (pred.pnl && !checkNum(pos.realizedPnl, pred.pnl)) return false
  if (pred.pnlPct && pos.notionalUsd > 0 && !checkNum(pos.realizedPnl / pos.notionalUsd, pred.pnlPct)) return false
  if (pred.holdDurationMins && pos.closedAt && !checkNum((pos.closedAt.getTime() - pos.openedAt.getTime()) / 60000, pred.holdDurationMins)) return false
  if (pred.hasTag) {
    const tagged = ctx.positionTags.some(t => t.positionId === pos.id && (t.label === pred.hasTag || t.tagId === pred.hasTag))
    if (!tagged) return false
  }
  if (pred.minLossStreak && ctx.lossStreaks) {
    const streak = ctx.lossStreaks.get(pos.id) ?? 0
    if (streak < pred.minLossStreak) return false
  }
  return true
}

function checkNum(v: number, op: NumComp): boolean {
  if (op.eq !== undefined && v !== op.eq) return false
  if (op.ne !== undefined && v === op.ne) return false
  if (op.lt !== undefined && !(v < op.lt)) return false
  if (op.lte !== undefined && !(v <= op.lte)) return false
  if (op.gt !== undefined && !(v > op.gt)) return false
  if (op.gte !== undefined && !(v >= op.gte)) return false
  return true
}

function checkStr(v: string, op: StrComp): boolean {
  if (op.eq !== undefined && v !== op.eq) return false
  if (op.in !== undefined && !op.in.includes(v)) return false
  return true
}
```

Helper: `computeLossStreaks(positions)` sorts by closedAt asc and walks, incrementing a counter when `realizedPnl < 0` and resetting otherwise; returns a Map keyed by positionId.

**Tests (~10):**
- Leaf: symbol exact match, symbol `in`, pnl lt 0, pnlPct gte 0.02, side long, day-of-week
- Composition: `all` narrows; `any` widens; `not` inverts
- `hasTag`: matches by label or tag id
- `minLossStreak`: 3rd consecutive loss flags
- Empty predicate matches everything

## Task 2 — `user_detector` schema + CRUD server fns

**Files:**
- Modify: `src/db/schema/derivation.ts` OR create `src/db/schema/customDetectors.ts`
- Create: `src/server/customDetectors.ts` — `createCustomDetector`, `listCustomDetectors`, `getCustomDetector`, `updateCustomDetector`, `toggleCustomDetector`, `deleteCustomDetector`
- Generate migration
- Test: `tests/unit/server/customDetectors.test.ts`

**Schema:**
```ts
export const detectorSeverityEnum = pgEnum('detector_severity', ['info', 'warning', 'critical'])

export const userDetector = pgTable('user_detector', {
  id: text('id').primaryKey(),              // 'det_' + randomBytes
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  title: text('title').notNull(),
  severity: detectorSeverityEnum('severity').notNull(),
  predicate: jsonb('predicate').$type<PositionPredicate>().notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index('user_detector_user_idx').on(t.userId),
}))
```

**Server fns** — all mutations guarded by `assertNotDemo`:
- `createCustomDetector({ name, title, severity, predicate })` — validate predicate via zod schema; insert
- `listCustomDetectors()` — all user's detectors, ordered by createdAt desc
- `getCustomDetector({ id })` — single + ownership check
- `updateCustomDetector({ id, ...fields })` — partial update; re-validate predicate if changed
- `toggleCustomDetector({ id, enabled })` — dedicated fn for quick on/off
- `deleteCustomDetector({ id })` — hard delete (findings stay referenced by stale detectorId, acceptable)

**Tests:** 6–8 happy-path + ownership + validation-rejection tests.

## Task 3 — Wire into derivation runner

**Files:**
- Modify: `src/derivation/runner.ts` — load user detectors, evaluate, emit findings
- Modify: `src/derivation/detectors/types.ts` — the existing `DerivationContext` already has positions + tags; no change expected
- Modify: `src/domain/finding.ts` — broaden `DetectorId` union
- Modify: `src/derivation/version.ts` — `DERIVATION_VERSION = 4`

**DetectorId type:**
```ts
export type BuiltinDetectorId =
  | 'revenge_trading' | 'oversized_positions' | ... | 'plan_adherence'

export type CustomDetectorId = `custom:${string}`

export type DetectorId = BuiltinDetectorId | CustomDetectorId
```

**Runner flow** — after built-in detectors run, load `userDetector` rows where `userId` and `enabled=true`:
```ts
const userDetectors = await db.select().from(userDetector)
  .where(and(eq(userDetector.userId, userId), eq(userDetector.enabled, true)))

const positionTags = await db.select(...).from(positionTag)...  // with joined tag labels
const lossStreaks = computeLossStreaks(positions)
const ctx: EvalContext = { positions, positionTags, lossStreaks }

for (const det of userDetectors) {
  const matched = positions.filter(p => evaluatePredicate(p, det.predicate, ctx))
  for (const p of matched) {
    findings.push({
      id: `custom_${det.id}_${p.id}`,
      userId,
      detectorId: `custom:${det.id}`,
      severity: det.severity,
      title: det.title,
      bodyMarkdown: `${p.symbol} ${p.side} closed ${p.realizedPnl >= 0 ? '+' : ''}$${p.realizedPnl.toFixed(2)} on ${p.closedAt?.toISOString().slice(0, 10)}.`,
      evidence: { userDetectorId: det.id, detectorName: det.name },
      referencedPositionIds: [p.id],
      periodStart: p.openedAt,
      periodEnd: p.closedAt ?? null,
      derivationVersion: DERIVATION_VERSION,
    })
  }
}
```

**`DERIVATION_VERSION = 4`** — document the bump in the version file; user must `pnpm rederive`.

**Update persist / query paths** — the existing `finding` table stores `detectorId` as text already; no schema change needed. But the `DetectorId` zod enum used in any input validators must widen.

## Task 4 — `/detectors/custom` admin UI

**Files:**
- Create: `app/routes/(app)/_layout/detectors/index.tsx` — list view
- Create: `app/routes/(app)/_layout/detectors/new.tsx` — create form
- Create: `app/routes/(app)/_layout/detectors/$detectorId.tsx` — edit form
- Modify: `src/components/shell/TopBar.tsx` — OR: link from Settings? List → Settings is cleaner since detectors are power-user territory
- Actually add as a TopBar entry or sub-section — decide: nest under `/settings/detectors` to keep the TopBar clean

**Decision:** nest under Settings as a separate route. Add a "Custom detectors" card on the `/settings` page that links to `/settings/detectors`. Three sub-routes: list + new + edit. Settings TopBar gear icon already exists.

Actually simpler: create top-level `/detectors` routes but link from Settings. Matches the existing `/plans` pattern.

**List page `/detectors`:**
- Table: Name, Title, Severity, Enabled toggle, Created, Actions (Edit / Delete)
- "New detector" button → `/detectors/new`
- Empty state: "You haven't defined any custom detectors yet. The 12 built-ins cover most common patterns — add your own when you spot something they miss."

**New / edit form:**
- Fields: name (internal, slug-case), title (user-facing), severity (segmented), enabled (toggle)
- **Predicate builder** — the tricky part:
  - A stack of "condition rows," each picks:
    - Field (dropdown: symbol / instrument / side / day of week / hour / pnl / pnl % / hold duration / has tag / min loss streak)
    - Operator (dropdown depends on field type)
    - Value (input depending on operator — text / number / multi-select for `in`)
  - "Add condition" button → new row
  - "Delete" button per row
  - Radio: "Match ALL conditions" (AND) vs "Match ANY condition" (OR) at the top — v1 omits nested composition and `not`; editable only as a flat list
- "Preview matches" button shows N positions currently matching — useful sanity check (server fn: `previewCustomDetector({ predicate })`)
- Save calls `createCustomDetector` / `updateCustomDetector`

Keep the UI constrained to flat all/any composition — nested composition is a power feature for a later phase.

**Settings page link:**
- Add a new Card on `/settings`: "Custom detectors — define your own patterns. View and manage."
- Button links to `/detectors`.

## Task 5 — Findings surface user detector findings

**Files:**
- Modify: `src/components/dashboard/FindingsSidebar.tsx` — render user-detector findings with the user's title
- Modify: `src/narrator/prompts/digest.ts` + `src/narrator/validate.ts` — AI prompt + grounding validator tolerate `custom:<id>` detectorId format
- Modify: `src/narrator/facts/digestFacts.ts` — topFinding selection includes user detectors
- Modify: `src/components/trades/CoachNarrative.tsx` — no change expected (already renders bodyMarkdown)

**Key change**: `DETECTOR_LABELS` map handles the `custom:` prefix:
```ts
function resolveDetectorLabel(detectorId: string, finding: DashboardFinding): string {
  if (detectorId.startsWith('custom:')) {
    // bodyMarkdown starts with the user's title via the runner logic above
    return finding.title
  }
  return DETECTOR_LABELS[detectorId] ?? detectorId
}
```

Grounding validator accepts any `custom:<id>` format in `detectorId` fields.

## Task 6 — Wiki + changelog + landing detector count

**Files:**
- Modify: `docs/wiki/phases.md`
- Modify: `app/routes/(public)/changelog.tsx` — v0.11 entry
- Modify: `app/routes/(public)/index.tsx` — the "12 behavioral detectors" stat becomes "12 built-ins + unlimited custom" (or similar)

---

## Scope NOT in Phase 11

- **Nested composition** (all of, any of, not of — beyond flat AND/OR). Defer.
- **Cross-position predicates** (e.g., "5 positions within 1 hour"). Requires a different evaluator.
- **Time-of-day heatmap patterns** with thresholds beyond a single hour. Defer.
- **Per-detector email notifications.** Findings surface in the weekly digest; dedicated alerts are a future feature.
- **Sharing detectors** with other users. Private-only in v1.
- **Detector library / marketplace.** Out of scope.
- **Testing predicates against a specific date range** (beyond the current all-positions preview). Minor polish.
- **Built-in detector toggles.** Users can't disable the 12 built-ins yet. Consider for a future phase.
