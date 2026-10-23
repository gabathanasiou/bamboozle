# Security Review — F-03 to F-07 hardening batch — 2026-10-23

> Agent-assisted targeted audit of the merged batch `20b834c` → `0bb3bec`
> (branch `security-residuals`, PR #1). Read-only: no code was modified by the
> audit pass. **This is not a penetration test** — findings come from source,
> configuration and tool output, not live exploitation.
> Standards referenced: OWASP ASVS 5.0.0, OWASP Top 10.
> Prior audit: `docs/audits/2026-10-23-room-authority-and-cost-controls-security-review.md`
> (same day, F-01–F-07). This report supersedes its "only operational items
> remain" verdict; see F-10.

## 1. Summary

**Scoreboard:** ✅ 9 · 🟡 21 · ❌ 3 · ⬜ 4 (of 37 in-scope checklist items)

**Top findings**

| # | Finding | Severity | Priority | Blocks |
|---|---|---|---|---|
| F-01 | Directory schema creates an index on `create_key` before the ALTER adds the column; the next Worker deploy breaks every upgraded Directory DO | High | P0 | next Worker deploy |
| F-02 | One tenant can exhaust the shared global TTS request budget and silence premium narration for every room | Medium | P2 | scale / paid TTS |
| F-03 | Legacy drain is client-triggerable and closes unclaimable rooms outside the host's control | Low | P3 | rollout |
| F-04 | Idempotent create is check-then-act; concurrent retries can create two rooms for one key | Low | P3 | hardening |
| F-05 | The `last_seen` backfill can reap a pre-existing active room in the deploy window | Low | P3 | rollout |
| F-06 | First-room secrets are reconstructible from Directory storage (pepper + `create_key`) | Low | P3 | design claim |
| F-07 | Create retries are charged to the durable per-IP budget; the client surfaces nothing | Low | P3 | hardening |
| F-08 | `/api/tts` returns raw provider/exception text to the token holder | Low | P3 | hardening |
| F-09 | `DEPLOYMENT.md` says `wrangler.toml` declares the TTS request caps; it does not | Low | P3 | docs |
| F-10 | The prior remediation report overstates closure and test evidence | Low | P3 | launch decisions |

**Verdict:** The batch materially improves the design (durable create budget,
idempotent replay, idle reap, streamed body cap, state-rejection signal), and the
existing host/player secret controls are intact. It is **not deploy-ready**:
F-01 will break the Directory DO on the next `wrangler deploy` over the existing
production namespace; fix and add an upgrade test before deploying. F-02 is the
next availability concern; the rest are hardening.

## 2. Scope & method

- **Mode:** targeted, batched. **Change set:** `20b834c` → `0bb3bec` (17 files,
  +658/−100), folding in roadmap items **39, 40, 41, 42 and 43** (F-03–F-07).
- **Surface → domain map:** Worker auth/identity and client storage → AUTH-09/10/11/13/14,
  SEC-01/02/05/10/12, UX-01; Directory SQL/schema and network surface →
  DATA-01/02/03/09/15/16, SEC-05/06/07/08/11, API-01..08, OPS-11/13/21;
  always-on/regression/supply chain → SEC-01..04, OPS-01..04/18, TEST-03/06/08,
  plus `AGENTS.md` and `docs/SERVER_HARDENING.md` invariants.
- **Deliberately not reviewed:** the React UI beyond the client storage/secret
  paths, GCP/Cloudflare dashboard configuration, the legacy `server/` tree, and
  billing (no payment path exists).
- **Tools run:**
  - `npm audit --omit=dev` / `npm audit` (root): 3 moderate, 0 high, 0 critical
    (`uuid → xcode → @capacitor/cli`, dev-only).
  - `npm --prefix workers/bamboozle-rooms audit`: 2 moderate, 0 high, 0 critical
    (`vitest` dev chain).
  - Secret scan: `rg` for `eyJ|sk-|AKIA|BEGIN … PRIVATE KEY|TTS_API_TOKEN|GOOGLE_APPLICATION_CREDENTIALS_JSON`;
    `git log -S "BEGIN PRIVATE KEY"` → audit docs only. `.dev.vars` is ignored,
    untracked and mode 600.
  - Pattern sweep: `eval(`, `innerHTML`, string-built SQL, `cors: '*'`,
    hand-rolled crypto, `VITE_*` secrets → no new hits.
  - SQLite upgrade reproduction with the system `sqlite3` (see F-01); no live
    deployment was touched.
  - `gitleaks`/`trufflehog`/`osv-scanner` are not installed (see §6).
- **Method:** three domain sweeps; candidate findings at Medium+ verified by four
  fresh independent agents told to disprove them; the lead re-read every cited
  line for F-01 and F-02 and reproduced F-01 against SQLite.

## 3. Domain scoreboard

| Domain | ✅ | 🟡 | ❌ | ⬜ | Notes |
|---|---|---|---|---|---|
| Identity & access | 3 | 2 | 0 | 0 | Secret gates intact; legacy drain and create-budget UX are the gaps |
| Data layer | 0 | 5 | 1 | 0 | F-01 blocks upgraded deployments; legacy shapes otherwise handled |
| Application security & compliance | 3 | 6 | 0 | 0 | No new injection/sink; secrets/hash claims need qualification |
| API & webhooks | 1 | 4 | 0 | 3 | No webhooks/customer API; single ops token |
| Infrastructure & ops | 2 | 2 | 1 | 0 | CI gate green; GCP budget alert still open |
| Testing & QA | 0 | 1 | 1 | 1 | No upgrade-migration or idle-sweep test |
| UX & product surface | 0 | 1 | 0 | 0 | Client identity material remains XSS-readable localStorage |

## 4. Findings

### F-01 — Directory schema bootstrap fails on upgraded deployments · High · P0 · verified

- **Where:** `workers/bamboozle-rooms/src/directory.ts:98-144`
- **What:** The initial multi-statement `exec` creates
  `rooms_by_create_key ON rooms(host_id, create_key)` at line 112, but
  `create_key` is only added by the `ALTER TABLE` loop at lines 132-142. On a
  Directory DO created by an earlier release, `CREATE TABLE IF NOT EXISTS` is a
  no-op and the index statement fails with `no such column: create_key`. The
  constructor calls `ensureSchema()` unguarded, so every instantiation throws.
- **Reachability:** No attacker needed. Any `wrangler deploy` of this code over
  the existing production Directory namespace. Deployment is manual
  (`workers/bamboozle-rooms/package.json:9`, `docs/DEPLOYMENT.md:56`); CI does
  not deploy, and the merge itself did not. Whether `0bb3bec` has already been
  deployed could not be verified (see §6).
- **Impact:** The global Directory DO — the entry point for `/ws`, create/join,
  discovery and both TTS budgets — cannot serve. `/health` and `/api/version`
  keep returning 200 and mask the outage. No data is corrupted; the DO recovers
  only after a corrected deploy (or a manual schema fix).
- **Evidence:** system SQLite reproduction against the pre-batch schema:
  `CREATE INDEX … ON rooms(host_id, create_key)` → `Parse error … no such
  column: create_key`, exit 1. Workerd prepares/executes statements in the
  multi-statement `exec` eagerly, so the throw happens before the ALTER loop.
  The tests only exercise a fresh schema: `test/directory.test.ts:54-59` calls
  `deleteAll()` then `ensureSchema()`, so CI cannot catch this.
- **Fix:** Move the `rooms_by_create_key` index creation below the ALTER loop
  (and after the `UPDATE`); replace the catch-all ALTER with a
  `PRAGMA table_info(rooms)` check and only add missing columns; add an upgrade
  test that creates the pre-batch table shape, then calls `ensureSchema()` and
  asserts the columns/index exist.
- **Effort:** S.
- **Verification:** Independent verifier confirmed the ordering, workerd
  behaviour and test gap, confidence 9; lead reproduced the SQLite failure and
  re-read lines 98-144. Confidence 9.

### F-02 — Shared global TTS request budget can silence all premium narration · Medium · P2 · verified

- **Where:** `workers/bamboozle-rooms/src/directory.ts:986-1018`;
  `src/index.ts:83-94`; `src/room.ts:537-545`.
- **What:** The new request counter uses one global key (`req:global`, 5,000/day)
  shared by the ops API and every room, with a per-IP cap of 500/day. The request
  is counted before body validation and before the cache lookup. Ten source
  addresses × 500 cached-text narrations exhaust the global counter; every room
  then gets `TTS_RATE_EXCEEDED` until 00:00 UTC, while the character budget is
  untouched.
- **Reachability:** Any unauthenticated client can host a room (`AUTH_MODE=none`,
  `wrangler.toml:25`) and call `requestNarrator` as its legitimate host. The
  per-socket limit is 20 events/10s, so ten sockets reach 5,000 in ~4 minutes.
  One create per IP is 1/10 of the create cap.
- **Impact:** Premium narration is unavailable to every room for the rest of the
  UTC day. The client falls back to local Web Speech after ~4s
  (`services/gameService.ts:671-690`), so gameplay continues but the paid/quality
  audio path is down. The pre-existing 50k-character global budget has the same
  shared-fate property with ~100 unique phrases; this adds a second, cheaper
  trigger.
- **Evidence:** `directory.ts:989` (`req:global`), `:996-1007` (global check),
  `:1010` (increment); `index.ts:83-85` counts before length/JSON checks at
  `:87-94`; `room.ts:537-539` counts before `getAudio`; defaults at
  `src/env.ts:34-35`; not overridden in `wrangler.toml`.
- **Fix:** Split counters by trust path (ops API vs room narration) and add a
  per-room/per-host sub-budget; count room narrations only after the host check
  (already true) and consider not charging cache hits against the global ops
  budget. Edge rate limits/Turnstile remain the distributed layer.
- **Effort:** M.
- **Verification:** Independent verifier confirmed the arithmetic, the
  count-before-parse ordering and the client fallback, confidence 9; lead
  re-read the three call sites. Confidence 9.

### F-03 — Legacy drain is client-triggerable · Low · P3 · verified

- **Where:** `workers/bamboozle-rooms/src/directory.ts:553-554,577-584,835-849`
- **What:** `createRoomForHost` calls `sweepStaleRooms()` before checking the
  host secret, and the sweep closes every row with an empty
  `host_secret_hash` (`LEGACY_ROOM`). A caller can therefore choose the moment
  legacy rooms are closed, and a host id whose only rows are legacy falls
  through to a fresh create — the first caller mints a secret and owns the id.
- **Reachability:** Anyone who can open `/ws` and send `createRoom`; no secret
  required for a host id with no non-legacy rows.
- **Impact:** One-time, during the rollout window: legacy rooms are unclaimable
  anyway, and the host's own client already treats them as lost. The attacker
  gains timing control over the close and can claim a dormant host id. Not a
  live takeover of a secret-protected room.
- **Evidence:** `directory.ts:553` (sweep before the secret check), `:577-584`
  (per-host legacy drain before `rowsForHost` auth), `:835-849` (sweep closes
  empty-hash rows globally).
- **Fix:** Drain legacy rows from the alarm/admin path (or a one-time migration)
  before serving creates, not from a client-triggered create; pre-drain at
  deploy and document the claim semantics.
- **Effort:** S.
- **Verification:** Independent verifier confirmed the ordering and the
  first-caller claim, confidence 8. Confidence 8.

### F-04 — Idempotent create is check-then-act · Low · P3 · verified

- **Where:** `workers/bamboozle-rooms/src/directory.ts:558-568,589-607,632-641`
- **What:** The replay lookup and the empty-host check are separated from the
  insert by several awaits (`sweepStaleRooms`, `scheduleSweep`,
  `deriveHostSecret`, `hashSecret`, `/internal/init`). Two concurrent creates
  with the same `(hostId, createKey)` can both observe no row and insert two
  different room codes; `(host_id, create_key)` is a plain, non-unique index.
  A later replay returns the oldest row (`:707-717`), breaking the guarantee.
- **Reachability:** The host client on a slow create (reload/second tab) or two
  tabs sharing the pending localStorage key. No privilege impact.
- **Impact:** Two rooms for one key, one orphaned until the sweep and counted
  against the 3-room per-host cap; replay returns the older room, so the client
  may adopt the wrong one. Low.
- **Evidence:** `directory.ts:112` (non-unique index), `:558-568` (check),
  `:589-607` (empty-host branch), `:602-603,623` (await points), `:632-641`
  (insert), `:707-717` (oldest-first replay).
- **Fix:** After `/internal/init` returns 200, synchronously re-check
  `rowForCreateKey` immediately before the insert and close the just-initialized
  room on conflict; or use a partial unique index
  `UNIQUE(host_id, create_key) WHERE create_key <> ''` and treat the conflict as
  a replay.
- **Effort:** S.
- **Verification:** Independent verifier confirmed DO interleaving and the
  missing constraint, confidence 8 (same-key trigger 6-7). Confidence 8.

### F-05 — `last_seen` backfill can reap a pre-existing active room · Low · P3 · verified

- **Where:** `workers/bamboozle-rooms/src/directory.ts:144,835-849`
- **What:** The migration sets `last_seen = created_at` for existing rows, and
  the sweep now closes rooms with `last_seen < now - 6h` regardless of live
  sockets. On the first deploy, a room older than 6h is marked stale; if a
  create-triggered sweep runs before that room's first post-deploy join/relay
  touches it, it is closed even if players are connected.
- **Reachability:** Honest users, narrow deploy-time window. Cloudflare restarts
  the DO and drops sockets on deploy; reconnecting clients usually touch
  `last_seen` within seconds, so the race is short.
- **Impact:** Destructive close: all sockets get `roomClosed`, and the room
  deletes players, state and deadlines. Bounded to one rollout; production
  cutover was the same day, making >6h-old rooms unlikely.
- **Evidence:** `directory.ts:144` (backfill to `created_at`), `:835-849` (sweep
  has no live-socket exemption), `:815-823` (close path), `room.ts:224-238`
  (state/player deletion). `docs/DEPLOYMENT.md:86-89` covers only hashless
  legacy rooms.
- **Fix:** Backfill to `Date.now()` so pre-existing rooms get one fresh 6h
  window; document the deploy behaviour; add a test seeding a >6h-old row with a
  live socket and asserting it survives the first sweep.
- **Effort:** S.
- **Verification:** Independent verifier confirmed the mechanism and narrowed
  the claim to the deploy window, confidence 8. Confidence 8.

### F-06 — First-room secret is reconstructible from Directory storage · Low · P3 · verified

- **Where:** `workers/bamboozle-rooms/src/directory.ts:105,633-640,719-753`
- **What:** The first room's secret is `HMAC-SHA256(pepper, hostId:createKey)`
  truncated to 128 bits. The pepper lives in the same Directory SQLite `meta`
  table, and `rooms.create_key` is stored in plaintext. Anyone with read access
  to that storage can reproduce the secret for every idempotent room.
- **Reachability:** Requires a Directory storage read (backup/export, a future
  debug path, or a storage-layer bug), not network access. `/internal/*` is 404
  from the Worker and room summaries omit `create_key`.
- **Impact:** Host takeover for rooms created with a key, contradicting
  `docs/NETWORKING.md:63` ("the raw secret is never stored"). Before the batch,
  a storage read yielded only one-way hashes.
- **Evidence:** `directory.ts:720-735` (pepper in `meta`), `:633-640`
  (`create_key` stored), `:737-753` (HMAC derivation), `:559-568` (replay
  accepts the derived secret).
- **Fix:** Store `hashSecret(createKey)` and look up the replay by hash, deriving
  from the raw key presented by the client; or move the pepper to a Worker
  secret with a documented rotation. Otherwise, qualify the storage claim in
  `NETWORKING.md`.
- **Effort:** S.
- **Verification:** Two independent agents converged on the mechanism; one
  scored it Hardening because of the storage precondition. Lead re-read the
  derivation and the claim. Confidence 8 (impact contingent on storage read).

### F-07 — Create retries are charged to the durable budget · Low · P3 · verified

- **Where:** `workers/bamboozle-rooms/src/directory.ts:331,558-568`;
  `services/gameService.ts:794-806`.
- **What:** `consumeCreate` runs in the Directory dispatch before
  `createRoomForHost`, so a replay of an already-created key consumes another of
  the 10/hour/IP tokens. The client only console-logs `RATE_LIMITED`; the host
  sees no message.
- **Reachability:** Any host whose ack is lost (the exact case item 40 fixes),
  or repeated `npm run smoke` against a production Worker with the default cap
  (the script makes 8 budgeted creates per run; a second run within the hour
  fails).
- **Impact:** A legitimate host can be locked out for up to an hour, with no
  user-facing error or retry guidance. The dev scripts raise the cap to 1000, so
  local runs do not exercise the production limit.
- **Evidence:** `directory.ts:331` (budget before create), `:558-568` (replay
  lookup), `wrangler.toml:36` (`MAX_CREATES_PER_HOUR = "10"`),
  `scripts/smoke.mjs` create count, `gameService.ts:801-802` (log-only error).
- **Fix:** Check `rowForCreateKey(hostId, createKey)` before consuming the
  budget (and skip the charge for a verified replay); surface `RATE_LIMITED`
  in the create callback with a retry hint.
- **Effort:** S.
- **Verification:** Independent verifier confirmed the ordering and smoke
  arithmetic, confidence 8. Confidence 8.

### F-08 — `/api/tts` returns raw provider/exception text · Low · P3 · verified

- **Where:** `workers/bamboozle-rooms/src/index.ts:110-111`; `src/tts.ts:91,117,135,249`
- **What:** The catch block returns `error.message`, which includes Google
  response bodies, bucket/project identifiers and exception text.
- **Reachability:** Holder of the ops `TTS_API_TOKEN` only; no anonymous path.
- **Impact:** Leaks GCS bucket/project identifiers and provider error detail to
  the caller and the logs. No credentials are included.
- **Fix:** Return a stable `TTS_FAILED` code and log the detail server-side.
- **Effort:** S.
- **Verification:** Static review confirmed the catch path; confidence 9.

### F-09 — Deployment doc claims TTS request vars are in `wrangler.toml` · Low · P3 · verified

- **Where:** `docs/DEPLOYMENT.md:80` vs `workers/bamboozle-rooms/wrangler.toml:24-40`
- **What:** The doc lists `TTS_DAILY_REQUESTS` / `TTS_IP_DAILY_REQUESTS` under
  "`wrangler.toml` already declares", but neither is present; the code defaults
  (5,000/500) apply unless set in the dashboard.
- **Impact:** Config drift: an operator tuning the caps may believe they are
  pinned, and a future default change would alter production without a config
  diff.
- **Fix:** Add both vars to `[vars]` (and `.dev.vars.example`), or move them to
  a "code defaults" line in the doc.
- **Effort:** S.
- **Verification:** Confirmed by direct comparison; confidence 10.

### F-10 — Prior remediation report overstates closure · Low · P3 · verified

- **Where:** `docs/audits/2026-10-23-room-authority-and-cost-controls-security-review.md:38-39,204,228`
- **What:** The verdict says "The only open items are operational" while the same
  report still has ❌ for SEC-09, SEC-15, TEST-04, TEST-08 and CODE-14. The F-03
  remediation claims an "idle/legacy sweep" test, but no test seeds a recent
  `last_seen`; the F-04 remediation claims "placeholder-key rejection", but
  `rg INVALID_CREATE_KEY workers/bamboozle-rooms/test` finds nothing.
- **Impact:** A launch decision relying on the top-line verdict is told the
  pre-launch list is clear when five items remain, and two regression claims are
  backed only by smoke/absence.
- **Fix:** Qualify the verdict ("only the F-03–F-07 residuals are operational")
  and either add the two tests or drop the claims. This report carries the
  corrected state.
- **Effort:** S.
- **Verification:** Confirmed by re-reading the report and searching the tests;
  confidence 9.

### Hardening notes (verified, not vulnerabilities)

- **`last_seen` throttle is tighter than needed.** `touchRoom`
  (`directory.ts:755-764`) writes at most once per minute per room; the reap
  cutoff is 6h. A 15–30 minute throttle still bounds reap latency and cuts the
  new write path by 12–30×. The free-plan 100k rows-written/day quota makes
  this worth doing; the 100k request quota already caps the realistic volume.
- **`tts_budget` rows are never pruned.** `budgetCount` deletes a key when it is
  next read on a new day, but IPs that never return leave rows forever
  (`directory.ts:1061-1081`). Add a sweep delete for `day <> today`.
- **`.env` is tracked** (`git ls-files .env`), while `.gitignore:43` and
  `AGENTS.md` say `.env*` must not be committed. Today's values are public
  (`VITE_SERVER_URL`, `GCS_BUCKET_NAME`), but the ignore rule cannot protect a
  tracked file. `git rm --cached .env` and keep an `.env.example`.
- **CI installs are not hermetic.** `npm ci` runs the root `postinstall`
  (`cd server && npm install`), and actions are pinned by tag
  (`.github/workflows/ci.yml:25,27`). Use `npm ci` under `server/` (or drop the
  legacy tree from postinstall) and pin actions to commit SHAs.
- **IPv6/exact-IP keying** remains the documented F-03 residual; the previous
  report already leaves distributed saturation to Cloudflare edge rules. Not a
  new finding. Arithmetic correction: 1,000 sockets / 32 = 32 IPs, not 16.

## 5. Checklist verdicts

### A. Identity, accounts & access

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| AUTH-09 | ✅ | `room.ts:438-439,456-457,464-492,570-579`; `directory.ts:311-316,343-347` | Host/player/audience gates re-check the room's socket binding; a replay grants nothing by itself |
| AUTH-10 | 🟡 | `directory.ts:429-443,665-675`; `room.ts:292-341` | No id-based read remains; a 4-letter code is still the join capability, bounded by the read budget |
| AUTH-11 | ✅ | `directory.ts:665-696,698-717`; `room.ts:679-683` | Rooms are per-DO/secret-scoped; `create_key` never leaves the Directory |
| AUTH-13 | ✅ | `directory.ts:247-277,872-896,986-1018`; `index.ts:70-85` | Durable create and TTS request caps; per-socket/per-IP WS budgets intact |
| AUTH-14 | 🟡 | `directory.ts:331-334,872-896`; `gameService.ts:794-803` | No lockout UI; a shared NAT can exhaust the create budget silently |

### B. Data layer & correctness

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| DATA-01 | ❌ | `directory.ts:98-144` | F-01: upgrade path fails; no down path; tests only fresh schema |
| DATA-02 | 🟡 | `directory.ts:98-144` | DDL + full-table backfill on constructor; catch-all hides ALTER failures |
| DATA-03 | 🟡 | `directory.ts:110-112,698-717,838-844` | PK/host/create-key indexes cover lookups; sweep predicate is a scan of ≤500 rows |
| DATA-09 | 🟡 | `directory.ts:977`; `room.ts:438-447`; `protocol.ts:195-205` | New inputs validated; `gameState` remains untyped JSON (pre-existing) |
| DATA-15 | 🟡 | `directory.ts:98-144`; `gameService.ts:222` | Legacy hashless rows are drained; no schema version marker |
| DATA-16 | 🟡 | `directory.ts:558-568,632-641` | Replay exists but is not serialized (F-04) |

### C. Application security & compliance

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| SEC-01 | 🟡 | `directory.ts:719-753`; `gameService.ts:91-95`; `.gitignore:36` | No new secret in code/client; `.env` tracked (hardening) |
| SEC-02 | 🟡 | `docs/DEPLOYMENT.md:66-70` | TTS token rotation added; room secrets/pepper have no rotation |
| SEC-05 | 🟡 | `protocol.ts:195-205`; `index.ts:96` | New inputs capped/validated; `gameState` relay remains unsanitized by design |
| SEC-06 | ✅ | `directory.ts:138,698-717`; `origin.ts:18-33` | Parameterized SQL; no eval/innerHTML; origin gate unchanged |
| SEC-07 | ✅ | `index.ts:10,148-187`; `room.ts:529` | 16 KiB streamed cap; audio is in GCS, not the web root |
| SEC-08 | 🟡 | `origin.ts:8-26`; `wrangler.toml:27` | Allowlist unchanged; preview wildcard/null-origin remain pre-existing |
| SEC-10 | 🟡 | `gameService.ts:51,68-116`; `directory.ts:720-731` | WSS; secrets in localStorage and the create key/pepper in SQLite |
| SEC-11 | 🟡 | `auth.ts:18`; `index.ts:70-78`; `directory.ts:719-753` | `AUTH_MODE=none`, one ops token, derived secrets (F-06) |
| SEC-12 | ✅ | `directory.ts:282,649`; `room.ts:562` | No create key/secret in logs or broadcasts (grep) |

### G. API, integrations & webhooks

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| API-01 | ⬜ | no webhook code | No inbound/outbound webhooks |
| API-02 | ⬜ | no webhook code | No delivery/retry surface |
| API-03 | 🟡 | `index.ts:9,37-39` | `WORKER_VERSION` exists; WS contract has no version negotiation |
| API-04 | 🟡 | `index.ts:70-78`; `docs/DEPLOYMENT.md:63-70` | Single ops bearer; no scoped/revocable keys |
| API-05 | 🟡 | `directory.ts:247-277,986-1017` | Caps exist; exact-IP keying, no `Retry-After` |
| API-06 | 🟡 | `tts.ts:89-93,116-122` | Provider responses checked; no contract mocks |
| API-07 | ✅ | `tts.ts:151-160,173-201` | 401 retry + KV token cache |
| API-08 | ⬜ | no customer API | No public API/sandbox |

### D. Infrastructure, ops & supply chain

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| OPS-03 | ✅ | `.github/workflows/ci.yml:25-60` | Lint/typecheck/unit/worker/build/Playwright gate on PR + main |
| OPS-11 | 🟡 | `tts.ts:151-160`; `realtimeClient.ts:208-219` | Google 401 retry; DO↔DO has no retry; client backoff only |
| OPS-13 | ✅ | `directory.ts:815-823,857-870` | One named Directory alarm; close is idempotent |
| OPS-18 | ❌ | `docs/DEPLOYMENT.md:157`; roadmap 23 | GCP hard quota/budget still console-only |
| OPS-21 | 🟡 | `directory.ts:163,282,933`; `room.ts:229,562` | Console strings, not structured JSON |

### E. Testing & QA / I. UX

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| TEST-03 | ⬜ | no checkout/billing code | No money path to cover |
| TEST-06 | 🟡 | `test/directory.test.ts:73,95,113,268`; `test/index.test.ts:45`; smoke 348,364 | Good new coverage; no upgrade-schema or idle-`last_seen` test |
| TEST-08 | ❌ | no axe/lint gate; roadmap 32 | Accessibility still un-gated |
| UX-01 | 🟡 | `gameService.ts:51,91-116,808-811` | Identity/create key in localStorage; no TTL/scoping |

## 6. Could not verify

- Whether `0bb3bec` has already been deployed to production. Deployment is
  manual; no deploy log in the repo. If it has, F-01 is a live outage, not a
  next-deploy risk. Confirm with `wrangler deployments list` before deploying.
- Production Directory contents and schema (whether `create_key` exists yet);
  no live storage access.
- Whether the Cloudflare account is on the Free plan and whether the 100k
  rows-written/day quota is the binding limit; the repo targets Free.
- Cloudflare edge rate-limit rules / Turnstile for `/ws` and `/api/tts` —
  dashboard-only, not in the repo.
- GCP TTS hard quota, budget and alert delivery; `PROJECT_ID`/`BUDGET_ID` are
  blank in `docs/DEPLOYMENT.md:157`.
- Production values of `TTS_DAILY_REQUESTS`/`TTS_IP_DAILY_REQUESTS`; absent from
  `wrangler.toml`, so code defaults apply unless set in the dashboard.
- Real `cf-connecting-ip`/IPv6 distribution behind the edge; only source and
  local tests were inspected.
- `gitleaks`/`trufflehog`/`osv-scanner` are not installed; the secret scan was
  `rg` plus targeted history checks, not a full-history entropy scan.
- Whether Cloudflare decompresses inbound `Content-Encoding` before
  `request.body`; the 16 KiB cap holds either way, but the 413-vs-400 outcome for
  a compressed body was not exercised.

## 7. Rejected / downgraded candidates

- **IPv6 / exact-IP rotation bypasses per-IP budgets** → accepted residual, not
  a new finding. The prior F-03 remediation explicitly leaves distributed
  saturation to Cloudflare edge rules; arithmetic corrected (32 IPs for 1,000
  sockets, not 16).
- **`last_seen` writes exhaust the free-tier rows quota** → downgraded to a
  hardening note. The 100k requests/day quota caps the touch volume at ~49k
  rows/day, and the pre-existing state-persist path writes more rows per
  request; the 60s throttle should still be loosened.
- **`roomError` can be spoofed by a peer** → false positive. It is sent only by
  the Directory to the sender's own socket; the client handler only acts on the
  server event name.
- **`createKey` leaks via logs/broadcast/attachment** → false positive. Grep
  shows no console sink, it is not in `RoomSummary`, and it is never written to
  the socket attachment.
- **Gzip body bypasses the 16 KiB cap** → not demonstrated. The byte cap is
  applied to the stream actually read; the 413-vs-400 outcome for a compressed
  body is untested (see §6).

## 8. Remediation plan

### Before the next Worker deploy

| Priority | Item | Finding(s) | Effort |
|---|---|---|---|
| P0 | Move the `create_key` index below the ALTER/backfill, replace the catch-all ALTER with `PRAGMA table_info`, add an upgrade-schema test | F-01 | S |

### Before the first paying customer

| Priority | Item | Finding(s) | Effort |
|---|---|---|---|
| P2 | Split the TTS request budget by path and add a per-room/per-host sub-budget; keep edge rules as the distributed layer | F-02 | M |
| P2 | Serialize idempotent create (sync re-check or partial unique index) | F-04 | S |
| P2 | Backfill `last_seen` to deploy time and document the rollout behaviour | F-05 | S |
| P3 | Pre-drain legacy rows from the alarm/admin path, not a client create | F-03 | S |
| P3 | Store `hashSecret(createKey)` / move the pepper, or qualify the "only a hash" claim | F-06 | S |
| P3 | Skip the create budget for verified replays; surface `RATE_LIMITED` in the UI | F-07 | S |
| P3 | Return a stable `TTS_FAILED` code; log provider detail server-side | F-08 | S |
| P3 | Add the TTS request vars to `wrangler.toml` or correct the doc | F-09 | S |
| P3 | Qualify the prior report's closure verdict; add the missing tests | F-10 | S |

### Before enterprise review

- CSP/security headers (item 22), privacy/terms (item 24), `SECURITY.md`/`security.txt`
  (SEC-15), accessibility gate (item 32), secret rotation (item 27), rollback/DR
  (item 26).

### Hardening notes (batch: do when nearby)

- Loosen the `last_seen` throttle to 15–30 min; prune `tts_budget` rows on day
  rollover.
- `git rm --cached .env`; keep `.env.example`.
- Make CI installs hermetic (`npm ci` in `server/`, SHA-pinned actions).
- Record the 100k rows-written/day free-tier quota in `SERVER_HARDENING.md`.

## 9. Re-audit guidance

- Fix F-01 first, then re-run `npm test` in `workers/bamboozle-rooms` with an
  added upgrade-schema test, and deploy to a staging/clean namespace before
  production.
- Fully re-verify F-01/F-02 on the next pass; re-check F-03–F-07 only if their
  cited files change.
- Re-check the dashboard-only items (GCP budget, Cloudflare edge rules) with
  evidence before claiming F-02/F-03 closed at scale.
- Re-run the deterministic passes (npm audit, secret scan, worker/unit/e2e/smoke)
  and diff against this scoreboard.
- Suggested cadence: before the next Worker deploy, before item 5 (paid
  entitlements), before the Play Store submission, and quarterly thereafter.
