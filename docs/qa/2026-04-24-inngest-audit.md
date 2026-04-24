# Inngest Scope Audit — 2026-04-24

**Context.** User reported: HL wallet import creates a `pending` import_record but never progresses. Root cause was a 500 on `/api/inngest` preventing Inngest dev server from registering functions, so events sit in a queue nothing consumes. This doc captures the fix plus every other Inngest-adjacent scope that could bite us.

**For the QA agent picking this up:** Issues are tagged `[FIXED]`, `[FIX]`, or `[VERIFY]`. Work through `[FIX]` items in order; `[VERIFY]` items are observations — confirm they still apply before touching anything.

---

## Inventory — all Inngest touchpoints

| File | Role |
|---|---|
| `app/routes/api/inngest.tsx` | HTTP serve handler (what Inngest dev server calls to discover functions + deliver events) |
| `src/jobs/client.ts` | `new Inngest({...})` — event-send client + function factory |
| `src/jobs/functions.ts` | Registry: exports `functions[]` wired into the serve handler |
| `src/jobs/events.ts` | Typed event-payload shapes + thin `inngest.send(...)` wrappers |
| `src/jobs/ingestion.ts` | `hlWalletPullFn` — triggered by `ingestion/hl-wallet-pull` |
| `src/jobs/derivation.ts` | `deriveOnIngestionCompleteFn`, `rederiveFn` |
| `src/jobs/narrator.ts` | `digestWeeklyScheduler` (cron), `composeDigestFn`, `sendDigestFn` |
| `src/jobs/planMatcher.ts` | `autoMatchPlansFn` — triggered after derivation |
| `src/jobs/planReminders.ts` | `planReminderScheduler` (cron), `sendPlanReminderFn` |
| `src/server/import.ts` | `startWalletImport` server fn → calls `sendHLWalletPull()` after creating `import_record` |
| `src/lib/env.ts` | Env schema (`INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`) |

---

## Findings

### I-01 · [FIXED] `/api/inngest` used Cloudflare adapter but app runs on Node — 500 on all requests

- **File:** `app/routes/api/inngest.tsx`
- **Before:** `import { serve } from 'inngest/cloudflare'`. The Cloudflare handler signature is positional `(req, env, ctx) => Promise<Response>`, but the route called it as `handler({ request, env: {} })` — an object argument. The `as` cast hid the mismatch at compile time; at runtime the handler received an undefined `request` and threw, producing 500.
- **Symptom:** `GET /api/inngest` returned 500 → Inngest dev server couldn't discover registered functions → events sent via `inngest.send(...)` sat in the dev server's queue unconsumed → `import_record.status` stayed `'pending'` forever.
- **Fix applied:** switched to `inngest/remix`, whose handler signature is `(ctx: { request: Request; context?: unknown }) => Promise<Response>` — exact match for TanStack Start's server-route handler shape. `inngest/cloudflare` is removed; the `as` cast is gone.
- **Verification for QA:**
  1. `pnpm dev` and `pnpm inngest:dev` in two terminals.
  2. Open `http://localhost:3000/api/inngest` — should return JSON listing `~10` registered functions including `hl-wallet-pull`, `derive-on-ingestion-complete`, `auto-match-plans`, etc.
  3. Inngest dev UI at `http://localhost:8288` → **Apps** → `trade-journal` with green status.
  4. Kick off a fresh wallet import → `/runs` tab in the dev UI shows the run, import_record progresses `pending → parsing → normalizing → complete`.

---

### I-02 · [FIX] `startWalletImport` orphans `import_record` if `inngest.send()` throws

- **File:** `src/server/import.ts:111–148`
- **Observation:** The handler inserts the `import_record` (line 131) BEFORE calling `sendHLWalletPull(...)` (line 140). If the Inngest send throws (event key rejected, network error, dev server down, payload too large), the record is left with `status: 'pending'` and no retry mechanism. No try/catch wraps the send.
- **Impact:** User sees a pending row that never progresses and can't be retried through the UI. Manual DB cleanup required.
- **Fix:** Wrap `sendHLWalletPull(...)` in a try/catch. On failure, UPDATE the record to `status: 'failed'` with `errorMessage: 'Failed to enqueue import job: ' + String(err)` before rethrowing. Return a clear error to the client so the UI can surface it.
- **Alternative fix (structural):** move the `import_record` insert INTO `hlWalletPullFn` — the server fn would just send the event and the job would own record lifecycle. More invasive; defer to later.

---

### I-03 · [FIX] `hlWalletPullFn` concurrency is GLOBAL, not per-user

- **File:** `src/jobs/ingestion.ts:14–17`
- **Observation:** `concurrency: { limit: 5 }` with no `key`. Inngest interprets this as global concurrency — system-wide cap of 5 in-flight wallet pulls. A single spamming user can saturate the cap for everyone else.
- **Fix:** `concurrency: { limit: 5, key: 'event.data.userId' }` — caps 5 simultaneous pulls per user, unbounded total.
- **Ripple check:** Verify no other function relies on the global-cap behavior. `autoMatchPlansFn` and `rederiveFn` already use per-user keys.

---

### I-04 · [FIX] `inngest.send()` failures in `events.ts` are silent

- **File:** `src/jobs/events.ts` (all 8 `sendXxx` helpers)
- **Observation:** Every helper awaits `inngest.send(...)` with no try/catch. If the send fails, the exception propagates up to whatever called the helper. That's fine for Inngest-function contexts (Inngest retries the step), but for server-fn call sites like `startWalletImport`, a swallowed-ish failure leaves the DB state inconsistent (see I-02).
- **Fix:** At minimum, add a shared log line: `try { await inngest.send(...) } catch (err) { log.error('inngest.send failed', { name, err: String(err) }); throw err }`. The rethrow preserves existing behavior; the log gives operators a paper trail.
- **Scope:** Apply to all 8 `send*` helpers in `events.ts`. Don't swallow — just log.

---

### I-05 · [FIX] `startCsvImport` runs the full ingestion pipeline synchronously inside the request

- **File:** `src/server/import.ts:44–105`
- **Observation:** Unlike `startWalletImport` (which dispatches to `hlWalletPullFn`), `startCsvImport` calls `orch.runImport(...)` inline at line 90. For a 50 MB CSV (the cap added in Wave 1 T09), parse + normalize + persist can take tens of seconds, during which the HTTP request is held open. Nitro/TanStack Start server timeouts will truncate long requests.
- **Also covers data-integrity audit L-02** (import_record stuck in `pending` after server crash — for CSV, the synchronous execution means a crash mid-parse leaves the record pending).
- **Fix (symmetric with HL):**
  1. Add a new event type `ingestion/csv-import` in `src/jobs/events.ts` with payload `{ importId, userId, csvContent, source }`.
  2. Add `csvImportFn` in a new file (or in `ingestion.ts`) that runs the orchestrator. Mirror `hlWalletPullFn` structure — `mark-parsing`, `run-import`, `emit-complete`.
  3. In `startCsvImport`, after inserting the record, `await sendCsvImport({...})` instead of `orch.runImport(...)`. Return `{ importId }` immediately.
  4. UI change: the Import page already polls `getImportStatus` so no front-end changes needed, but verify the loading copy makes sense for async import.
- **Concern:** `csvContent` in the event payload can be up to 50 MB. Inngest dev server handles large payloads, but Inngest Cloud has event-size limits (I think 128 KB or 4 MB depending on plan). Store the CSV to R2/disk and pass a reference if Cloud is in the deploy story. For now (dev only), inline is fine.
- **Priority:** MEDIUM — dev/demo works fine synchronously. Flag for production readiness.

---

### I-06 · [FIXED] SDK's dev-mode auto-detection was unreliable — `inngest.send()` threw "couldn't find an event key"

- **Files:** `src/jobs/client.ts`, `src/lib/env.ts:11–12`
- **Original assumption (wrong):** Inngest v4 SDK auto-detects dev mode when no event key is provided and targets `http://localhost:8288`.
- **Actual behavior:** SDK v4 validates the event key presence before sending regardless of dev/prod inference. With `INNGEST_EVENT_KEY=` empty (→ `undefined` via `emptyStringAsUndefined: true`), `inngest.send()` threw: `"Your event or events were not sent to Inngest. We couldn't find an event key..."`. HL wallet import failed at the `sendHLWalletPull(...)` step.
- **Fix applied (in `src/jobs/client.ts`):** Pass `isDev: env.NODE_ENV !== 'production'` to the client, and default missing keys to local-dev placeholder strings when `isDev` is true. In production, missing keys still resolve to `undefined` as before (fail-loud).
  ```ts
  const isDev = env.NODE_ENV !== 'production'
  export const inngest = new Inngest({
    id: 'trade-journal',
    eventKey: env.INNGEST_EVENT_KEY ?? (isDev ? 'local-dev-event-key' : undefined),
    signingKey: env.INNGEST_SIGNING_KEY ?? (isDev ? 'signkey-local-dev-0000…' : undefined),
    isDev,
  })
  ```
- **Why placeholder strings work:** the Inngest dev server accepts any non-empty string for both keys. In dev, the placeholders satisfy the SDK's presence check; `isDev: true` redirects the event-send target to `http://localhost:8288`.
- **Verification for QA:** after restarting `pnpm dev` with the change, a wallet import progresses past `pending`, a run appears in the Inngest dev UI at `/runs`.

---

### I-07 · [VERIFY] `autoMatchPlansFn` per-user concurrency race (data-integrity M-04)

- **File:** `src/jobs/planMatcher.ts`
- **Status:** Wave 1 T11 already closed the UPDATE-side race (data H-02) by adding `isNull(position.planId)` to the WHERE guard. The broader race described in data-integrity audit **M-04** — two concurrent `plan/auto-match` runs for the same user both pick the same plan and race — is **not** fully closed by T11. T11 prevents manual-vs-auto races; M-04 is auto-vs-auto.
- **Verify:** re-read `docs/qa/2026-04-24-data-integrity-audit.md` M-04. If the race is still reachable under `concurrency: { limit: 3, key: 'event.data.userId' }`, reduce to `limit: 1` per user OR add a unique partial index on `position.plan_id WHERE plan_id IS NOT NULL` so the DB rejects the second write. Either fix is acceptable; the index is more defensive.
- **Priority:** LOW — rare in practice; deferred to MEDIUM-phase QA.

---

### I-08 · [VERIFY] `heartbeat` cron fires hourly and does nothing substantive

- **File:** `src/jobs/functions.ts:9–12`
- **Observation:** `heartbeat` is a `cron('0 * * * *')` function that runs `step.run('ping', () => ({ ok: true, ts: ... }))` — essentially a no-op. It costs one Inngest run per hour forever.
- **Verify:** is this used for uptime monitoring (e.g., Inngest Cloud shows "last run" on it)? If yes, keep it. If no — remove, or repurpose (e.g., to clean up orphaned `import_record` rows older than 24h in status `pending`, which would address data-integrity audit L-02 at the same time).
- **Priority:** LOW. No impact on correctness.

---

### I-09 · [VERIFY] No `serveHost` / `servePath` set on `serve({...})`

- **File:** `app/routes/api/inngest.tsx`
- **Observation:** The `serve(...)` call passes only `{ client, functions }`. Inngest infers the serve URL from the incoming request. In most setups (local dev, single-origin deploy) this works fine. Behind a reverse proxy, tunnel (ngrok, Cloudflare Tunnel), or with a path prefix, inference can get the URL wrong and the dev server's registration handshake fails.
- **Verify:** once I-01 fix is validated, hit `POST /api/inngest` with a syncing payload (the dev UI's "Sync app" action) — if the sync succeeds, inference is fine. If the dev UI shows the app as registered with a wrong URL (e.g., `127.0.0.1` vs `localhost`, or `http://` vs `https://`), set `serveHost: env.VITE_APP_URL` and `servePath: '/api/inngest'` explicitly.
- **Priority:** LOW unless actually hit. Deploy-time concern, not dev.

---

### I-10 · [VERIFY] `inngest/cloudflare` still listed in imports anywhere?

- **Files:** grep-wide.
- **Observation:** I-01 fix removed the one known `inngest/cloudflare` import. Sanity check: `grep -rn "inngest/cloudflare" app src` should return zero hits. If any other file imports the Cloudflare adapter, it'll hit the same runtime mismatch.
- **Verify:** run the grep; if clean, mark DONE.
- **Priority:** LOW — defensive check.

---

## What's intentionally NOT in this audit

- **Hyperliquid adapter correctness** (`src/ingestion/adapters/hyperliquid-wallet.ts`) — separate scope; if the user's fills don't look right post-run, that's a different investigation.
- **`validateCsvImport` / `startCsvImport` security hardening** — already closed by Wave 1 T09 in `docs/qa/2026-04-24-swarm-plan.md`.
- **`getBtcEquityContext` date cap, Dashboard SQL LIMIT** — Wave 1 T14/T15; unrelated to Inngest.
- **Cron scheduler drift at DST** (data-integrity M-05) — documented elsewhere, low-frequency, deferred.

---

## Recommended fix order for the QA agent

1. **I-01** — already fixed; verify steps in the Verification section above.
2. **I-06** — already fixed; verify an event actually makes it to the dev server (`/runs` tab).
3. **I-02** — small, contained, closes a real UX papercut (stuck pending row on send failure).
4. **I-04** — small helper change, improves operator visibility.
5. **I-03** — one-line concurrency config change.
6. **I-10** — one grep; strictly defensive.
7. **I-05** — larger refactor; do last or defer to a separate phase.
8. **I-07, I-08, I-09** — `[VERIFY]` only; read, confirm current state, act only if the described failure mode is reproducible.

**After each fix:** run `pnpm typecheck && pnpm test && pnpm build`. Commit atomically per finding with a message referencing the finding ID (e.g., `fix(qa): I-02 — orphan import_record on inngest.send failure`).

**Don't touch:** anything under `tests/`, anything in `docs/qa/2026-04-24-swarm-plan.md`, and the Wave-1/2/3 deliverables (`src/lib/toastError.ts`, `src/components/tj/Modal.tsx`, the globals.css contrast tokens, etc.).
