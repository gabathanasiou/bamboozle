# Security Review — Room authority, TTS cost controls and abuse caps — 2026-10-23

> Agent-assisted targeted audit of commit `0ee030e` (branch `security-tranche`).
> Read-only review: no file was modified by the audit pass. Findings found during
> verification were remediated in `ec036c1` and `0ee030e`; this report covers the
> final tip. **This is not a penetration test** — findings come from source,
> configuration and tool output, not live exploitation.
> Standards referenced: OWASP ASVS 5.0.0, OWASP Top 10.
> Prior audit: `docs/audits/2026-10-23-security-audit.md` (2026-10-23).

## 1. Summary

**Scoreboard:** ✅ 4 · 🟡 31 · ❌ 11 · ⬜ 23 (of 69 in-scope checklist items)

**Top findings**

| # | Finding | Severity | Priority | Blocks |
|---|---|---|---|---|
| F-01 | A second socket can claim an existing player id and act/kick as that player | High | P0 | first paying customer |
| F-02 | `getRoomsByHost` is unauthenticated; host ids can be discovered and squatted | Medium | P2 | scale / privacy |
| F-03 | Global socket/room caps are saturable; create rate is in-memory | Medium | P2 | scale |
| F-04 | A lost `createRoom` ack strands the host secret and wipes the identity | Low | P3 | hardening |
| F-05 | Pre-deploy rooms have no host-secret hash and cannot be reclaimed | Low | P3 | rollout |
| F-06 | `/api/tts` has no request-rate limit; body cap trusts `Content-Length` | Low | P3 | hardening |
| F-07 | `STATE_TOO_LARGE` is silently dropped for `gameStateUpdate` | Low | P3 | hardening |

**Verdict:** The batch closes the original F-02/F-03/F-04/F-05/F-12 gaps and
materially improves cost control: `/api/tts` is off by default, both TTS paths
share a daily/per-IP character budget, and room/socket/create/player/state caps
plus a sweep alarm are in place. It is **not** safe to onboard paying customers
until F-01 is fixed: the player path still treats a client-supplied `playerId` as
identity, so a participant can impersonate another player. F-02/F-03 and the
external GCP budget/alert are the next priorities.

## 2. Scope & method

- **Mode:** targeted, batched. **Change set:** `21db4ae1` (main) → `0ee030e`
  (`security-tranche`), folding in roadmap items **15, 16, 17, 18, 19 and 25**.
- **Audited:** Cloudflare Worker and Durable Objects (`workers/bamboozle-rooms/`),
  the client realtime/state hooks (`services/gameService.ts`,
  `services/realtimeClient.ts`, `types.ts`), worker/Directory/room tests, deploy
  config (`wrangler.toml`, `.dev.vars.example`), and the security-relevant docs
  (`NETWORKING`, `SERVER_HARDENING`, `DEPLOYMENT`, `BILLING_INTEGRATION`,
  `ENTITLEMENT_SYSTEM`, `MULTIPLAYER_PLAN`).
- **Excluded / not available:** live GCP, Cloudflare and Netlify configuration;
  production Worker/Directory state; the legacy `server/` runtime; browser XSS
  beyond source review; GCS bucket IAM and object inventory. Untouched checklist
  domains (AI features, billing code) are marked N/A with reasons, not silently
  skipped.
- **Tools run:** `npm audit --json` (root 3 moderate / 0 high / 0 critical;
  worker 2 moderate / 0 high / 0 critical); `git ls-files` + `rg` secret-pattern
  scan (no live key tracked; the only pattern hit was the prior audit's text);
  `gitleaks`/`trufflehog` not installed; `npx tsc --noEmit` still red at
  `data/_oldquestions.ts:1971` (pre-existing, roadmap item 21); `npm run build`;
  `npm run test:unit` (28); worker `npm test` (47); `npx tsc --noEmit` in the
  worker (green); Playwright `e2e/realtime.spec.ts` (3); `npm run smoke`
  (14 steps).
- **Method:** three parallel read-only explore agents (auth/access, TTS/abuse,
  data/ops/docs); two fresh adversarial verifiers on the residual High/Medium
  claims; the lead re-read every cited line for F-01/F-02 and the remediation
  diffs. Remediation applied during the review: shared narrator TTS budget,
  prototype-name rejection, removal of copyable billing snippets, socket/upgrade
  cost caps, live-room-safe sweep, one-room-per-socket (`ec036c1`, `0ee030e`).

## 3. Domain scoreboard

| Domain | ✅ | 🟡 | ❌ | ⬜ | Notes |
|---|---|---|---|---|---|
| Identity & access | 0 | 4 | 0 | 4 | Host secret solid; player identity is still self-asserted (F-01) |
| Data layer | 1 | 6 | 0 | 0 | Additive DO schema; no version/backfill for legacy rows |
| Application security | 2 | 6 | 2 | 0 | TTS/token/sanitisation work; CSP, disclosure, a11y still open |
| Infrastructure & ops | 1 | 5 | 2 | 0 | CI and external cost alerts absent; in-app caps added |
| Testing & QA | 0 | 3 | 2 | 1 | 47 worker tests + 3 e2e + smoke; no load/a11y gate |
| Billing & commerce | 0 | 0 | 0 | 8 | No billing code; docs only |
| API & webhooks | 0 | 3 | 0 | 2 | No customer API/webhooks; WS protocol unversioned |
| AI features | 0 | 0 | 0 | 8 | TTS is not a model call; no AI surface |
| UX & product surface | 0 | 2 | 1 | 0 | Room-full/budget errors are weakly surfaced (UX-03) |
| Codebase & process | 0 | 2 | 4 | 0 | No CI/review gate; tsc red; no privacy/terms |

## 4. Findings

### F-01 — Player impersonation via duplicate `joinRoom` · High · P0 · verified

- **Where:** `workers/bamboozle-rooms/src/directory.ts:334-380`,
  `workers/bamboozle-rooms/src/room.ts:259-340,350-367,403-413`,
  `workers/bamboozle-rooms/src/protocol.ts:253-269`,
  `services/gameService.ts:1037` (state broadcast).
- **What:** A fresh socket may join the same room with an already-connected
  player id. The room upserts the row without a player secret or socket binding;
  the Directory stamps the attacker's attachment with that id, and `playerEvent`
  authorizes by the sender row, not socket ownership. The host secret protects
  only `hostId`.
- **Reachability:** Anyone who knows the 4-letter room code and a player id. Player
  ids are keys in broadcast `GameState.players`/`audience`, visible to every
  participant. Precondition: a room code plus a seat (needed to read the ids, not
  to abuse an existing row). A full room still accepts the impersonating join
  because the cap check is skipped when the row already exists.
- **Impact:** Forge the victim's lie/vote/ready/category selection; preempt or
  lock their answer; demote them to audience; closing the attacker socket starts
  the victim's 60s kick (`disconnect` is keyed only by `playerId`). Game-integrity
  and silent-mute DoS, repeatable per player.
- **Evidence:** `directory.ts:344-349` blocks only an id change on the *same*
  socket; `room.ts:303-340` upserts an existing id with no ownership check;
  `directory.ts:427-431` forwards `senderId` from the attachment;
  `room.ts:350-367` marks `connected=0` for any id on socket close.
- **Fix:** Mint a server-side 128-bit per-player resume secret on first join,
  store only its hash, return it once, and require it on every later join of that
  id. Store the current `socket_id` on the player row; accept `disconnect` only
  from that socket and verify it in `playerEvent`. Add a host-only server-side
  kick that deletes the row and closes the socket.
- **Effort:** M.
- **Verification:** Independent verifier confirmed the full chain and the kick;
  lead re-read `directory.ts:334-380`, `room.ts:259-367,403-413`. Confidence 9.

### F-02 — Unauthenticated `getRoomsByHost` and host-id squatting · Medium · P2 · verified

- **Where:** `workers/bamboozle-rooms/src/directory.ts:274-278,581-599,492-520`,
  `workers/bamboozle-rooms/src/room.ts:606-610`,
  `services/gameService.ts:199-205,564-575,741`.
- **What:** `getRoomsByHost` is keyed by a client-supplied `hostId` and returns
  every room code, phase, player count and player names. No secret or membership
  is required. The client uses one stable `playerId` for hosting and for playing
  in other rooms, so a person who plays as a normal player exposes the id that
  enumerates their hosted rooms. If the host has no Directory rows, an attacker
  who knows the id can call `createRoom` first and mint a secret the victim does
  not know, locking the victim out of that host id.
- **Reachability:** A room participant (or anyone who learns a host id) can query
  `getRoomsByHost`; a first-create squat needs the victim host id and no live
  rows. Rate limits only slow the query.
- **Impact:** Cross-room privacy leak (codes, phases, player names) and host
  identity squatting/lockout. Does not take over an existing secret-protected
  room.
- **Evidence:** `directory.ts:274-278` dispatches to `roomsByHost` without auth;
  `directory.ts:492-520` mints a new secret when no rows exist; `room.ts:606-610`
  strips only top-level `hostId`, not `players` keys/`vipId`.
- **Fix:** Require the host secret on `getRoomsByHost` and compare it against the
  stored hashes; return `[]` when it does not match. Stop deriving the host id
  from the player id (server-issued host id or phase-2 entitlement token).
- **Effort:** M.
- **Verification:** Independent verifier confirmed the core and corrected the
  "host joins own room" path (blocked by the host secret); lead re-read
  `directory.ts:274-278,581-599` and `gameService.ts:199-205,564-575`.
  Confidence 8.

### F-03 — Global caps are saturable and the create limiter is in-memory · Medium · P2 · verified

- **Where:** `workers/bamboozle-rooms/src/directory.ts:155-181,497-501,669-679,697-713`,
  `workers/bamboozle-rooms/src/env.ts:31-34`.
- **What:** 1,000 sockets / 500 rooms are global ceilings, and the per-IP
  `createRoom` counter is an in-memory `Map` that resets on Directory eviction.
  The new one-room-per-socket guard removes the cheap zombie-room trail, but
  multiple IPs/IPv6 rotation can still fill the global room cap; a room held by a
  single idle socket is skipped by the sweep indefinitely.
- **Reachability:** Distributed clients or IPv6 rotation; ~9 IPs at 10 rooms/hour
  can reach 500 rooms over 6 hours. Saturation affects new rooms/upgrades, not
  existing rooms.
- **Impact:** Partial service-wide denial of new room creation/connections until
  capacity frees; idle DO cost.
- **Evidence:** `directory.ts:280-286` now rejects a second create on one socket;
  `directory.ts:497-501` checks the global count; `directory.ts:697-713` holds
  create counters in memory; `directory.ts:669-679` skips any socket-held room.
- **Fix:** Cloudflare rate-limit rules/Turnstile on `/ws` and `createRoom`,
  durable create counters (SQLite or rate-limit binding), capacity headroom, and
  a last-activity heartbeat for the sweep so abandoned hostless rooms are reaped.
- **Effort:** M.
- **Verification:** Verifier confirmed the corrections (single-IP path is capped;
  zombie path mostly removed by the one-room guard). Confidence 7.

### F-04 — Lost `createRoom` ack strands the host secret · Low · P3 · verified

- **Where:** `services/gameService.ts:710-746`,
  `workers/bamboozle-rooms/src/directory.ts:492-520`.
- **What:** The host secret is stored only when the create ack arrives. If the ack
  is lost or the client fires two creates, the retry has no secret; the Directory
  returns `HOST_SECRET_REQUIRED`, and the client deletes `bamboozle_player_id` and
  reloads (`gameService.ts:716-722`). The created room is orphaned until grace.
- **Impact:** A host loses their room and persistent identity after a normal
  network blip. Reliability, not privilege escalation.
- **Fix:** Send a client-generated idempotency key on create; return the same
  `{roomCode, hostSecret}` for the same `(hostId, key)`. Do not wipe the player id
  on a create retry.
- **Effort:** S.
- **Verification:** Verifier confirmed; confidence 7.

### F-05 — Pre-deploy rooms cannot be reclaimed · Low · P3 · verified

- **Where:** `workers/bamboozle-rooms/src/directory.ts:107-113,503-520`,
  `workers/bamboozle-rooms/src/room.ts:275-282`.
- **What:** The `host_secret_hash` column is added with default `''`; rooms created
  before the deploy have no hash and no secret was ever issued. `joinRoom` requires
  a non-empty stored hash, so those hosts cannot reclaim; the client resets the
  player identity.
- **Impact:** One-time room/identity loss for hosts active across the deploy.
- **Fix:** Drain/close legacy rooms on rollout, or document a compatibility window
  and a backfill. Add a migration test that seeds an old row.
- **Effort:** S.
- **Verification:** Verifier confirmed; confidence 8.

### F-06 — `/api/tts` request-rate and body-cap gaps · Low · P3 · verified

- **Where:** `workers/bamboozle-rooms/src/index.ts:80-101,112-122`.
- **What:** The route is token-gated, but there is no request-rate limit (cache
  hits are free from the character budget), and the 16 KiB body check trusts
  `Content-Length`; a chunked body is fully parsed by `request.json()`.
- **Impact:** A leaked static token can spam cache-hit requests toward the shared
  100k/day Worker quota, or force a large JSON parse. The token itself is a
  long-lived secret with no rotation cadence.
- **Fix:** Per-token/IP request rate (edge or Worker), a hard body-size read
  wrapper, and a rotation cadence for `TTS_API_TOKEN`.
- **Effort:** S.
- **Verification:** Verifier confirmed the gate works and these residual gaps;
  confidence 7.

### F-07 — `STATE_TOO_LARGE` is silently dropped · Low · P3 · verified

- **Where:** `workers/bamboozle-rooms/src/room.ts:377-386`,
  `workers/bamboozle-rooms/src/directory.ts:374-375`.
- **What:** The room returns 413 for an oversized state, but `gameStateUpdate`
  has no ack and the Directory ignores the response; the host keeps its larger
  local state.
- **Impact:** Silent host/player state divergence in the unlikely case the state
  exceeds 128 KiB.
- **Fix:** Ack `gameStateUpdate` and propagate the error, or send an explicit
  `error` event to the host.
- **Effort:** S.
- **Verification:** Verifier confirmed; confidence 8.

### Remediation applied during this review

These were found by the agents/verifiers and fixed in `ec036c1`/`0ee030e`; they
are not open findings:

- Room narration now consumes the shared TTS budget on cache misses
  (`room.ts:458-491`); `/api/tts` and `requestNarrator` fail closed on budget
  errors.
- All `Object.prototype` names (`toString`, `hasOwnProperty`, …) are reserved, not
  just `__proto__`/`constructor`/`prototype`; the initial client maps are
  null-prototype (`protocol.ts:45,180-185`, `gameService.ts:213-217`).
- The remaining copyable client-trusted billing code (Part 4 of
  `BILLING_INTEGRATION.md`) is removed; only the superseded banners remain.
- Per-IP socket default raised from 12 to 32 (a same-NAT 2-room/6-player session
  needs up to 14), an upgrade budget (30/min/IP) was added, and `joinRoom` now
  counts against the per-IP read budget.
- The 6h sweep skips rooms with live Directory sockets; one socket may own only
  one room.

## 5. Checklist verdicts

### A. Identity, accounts & access

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| AUTH-01 | ⬜ | — | No account/session schema; anonymous guests + per-room secrets |
| AUTH-02 | ⬜ | — | No email/password login |
| AUTH-04 | ⬜ | — | No MFA/recovery; phase 2 entitlement only |
| AUTH-05 | ⬜ | — | No user session layer; room secrets are per-room |
| AUTH-09 | 🟡 | `protocol.ts:23-45,180-185`; `room.ts:403-456`; `gameService.ts:1959-1962` | Host/player/audience gates exist; player identity is self-asserted (F-01) |
| AUTH-10 | 🟡 | `directory.ts:334-380`; `room.ts:259-340` | `requestState` is member-only, but a duplicate join grants the same state |
| AUTH-11 | 🟡 | `directory.ts:581-599`; `room.ts:606-610` | Per-room DO isolation holds; cross-room host discovery via `getRoomsByHost` (F-02) |
| AUTH-13 | 🟡 | `protocol.ts:137-163`; `directory.ts:217-247,697-713` | Per-socket and per-IP limits; `joinRoom`/host-secret attempts still reset per socket |

### B. Data layer & correctness

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| DATA-01 | 🟡 | `directory.ts:87-113` | Additive schema, no version/backfill/down path |
| DATA-02 | 🟡 | `directory.ts:107-113` | `ALTER TABLE` on the small Directory table; catch-all hides failures |
| DATA-03 | ✅ | `directory.ts:88-105,669-679`; `room.ts:63-89` | PKs, host/created indexes, budget PK, indexed sweep |
| DATA-09 | 🟡 | `room.ts:377-393,403-456`; `protocol.ts:253-269` | Server-side id/allowlist/size checks; `gameState` is still untyped JSON |
| DATA-15 | 🟡 | `room.ts:78-81,606-631` | One unversioned JSON row; only top-level `hostId` stripped |
| DATA-17 | 🟡 | `directory.ts:492-520`; `room.ts:303-340` | Host create is secret-bound; player join is an id-only upsert (F-01) |
| DATA-21 | 🟡 | `docs/SERVER_HARDENING.md:110-124`; `docs/ROADMAP.md:216` | TTS cache grows; lifecycle/retention is roadmap item 35 |

### C. Application security & compliance

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| SEC-01 | ✅ | `index.ts:70-78`; `.gitignore:27,36`; `.dev.vars.example:5-7` | TTS/GCP secrets are Worker secrets; sample is empty; no live key tracked |
| SEC-02 | 🟡 | `index.ts:70`; `docs/DEPLOYMENT.md:60-63` | TTS bearer is static with no rotation cadence (item 27) |
| SEC-05 | 🟡 | `protocol.ts:162-236` | Text/name/ids/fields sanitised; `gameState` still relayed as untyped JSON |
| SEC-06 | 🟡 | `protocol.ts:162-200`; parameterised SQL in `room.ts`/`directory.ts` | SQLi/XSS controls hold; object-level player authorization is F-01 |
| SEC-08 | 🟡 | `origin.ts:18-26`; `server/index.js:22-43` | Worker allow-list is real; legacy `server/` still has wildcard CORS (item 20) |
| SEC-09 | ❌ | `netlify.toml` (no headers) | No CSP/security headers; item 22 open |
| SEC-10 | 🟡 | `realtimeClient.ts:269-276`; `tts.ts:51-53` | WSS/TLS; host/player secrets live in localStorage; audio URLs public |
| SEC-11 | 🟡 | `tts.ts:20-23`; `docs/DEPLOYMENT.md:99-105` | Broad `cloud-platform` service-account key and shared TTS bearer (item 27) |
| SEC-12 | ✅ | `tts.ts:70,78`; `room.ts:213` | Logs contain room code/MD5 only; no tokens or names |
| SEC-15 | ❌ | `rg --files -i 'security\\.md|security\\.txt'` → 0 | No disclosure process |

### D. Infrastructure, ops & supply chain

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| OPS-02 | 🟡 | `wrangler.toml:25-36`; `docs/DEPLOYMENT.md:56-63` | Config in TOML/secrets; `.env` is tracked (public values today) |
| OPS-03 | ❌ | no `.github`; `netlify.toml:1-3` | No CI/test gate; Netlify builds only; item 21 |
| OPS-04 | 🟡 | `docs/DEPLOYMENT.md:134-142` | `wrangler rollback` documented; no migration-down or rehearsal |
| OPS-07 | 🟡 | `directory.ts:75-79,155-181`; `docs/ROADMAP.md:167` | Worker scales; single global Directory is a write/failure domain (item 28) |
| OPS-11 | 🟡 | `tts.ts:151-159` | 401 token refresh only; no backoff/circuit breaker for 429/5xx |
| OPS-13 | ✅ | `directory.ts:639-679`; `room.ts:501-572` | DO alarms only; idempotent sweep; live-room skip correct |
| OPS-18 | ❌ | `docs/DEPLOYMENT.md:107-132`; `docs/ROADMAP.md:139` | In-app TTS budget added; no live GCP budget/alert (item 23) |
| OPS-21 | 🟡 | `wrangler.toml:35-36`; `directory.ts:70,78` | Observability on; free-text logs without request/actor correlation |

### E. Testing & QA

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| TEST-01 | 🟡 | 28 unit + 47 worker tests | Host secret, allowlist, caps, budget, token gate covered; `gameService` reducer is 0% |
| TEST-02 | 🟡 | `test/index.test.ts`, `test/directory.test.ts` | Google TTS/GCS live path is not integration-tested; cache hit is smoke-only |
| TEST-03 | ⬜ | no billing code | Billing/checkout flows do not exist yet |
| TEST-04 | ❌ | no load test | No 100/500/1000-room ramp; item 28 |
| TEST-06 | 🟡 | `test/*.test.ts` + `e2e/realtime.spec.ts` | Good regression additions; no duplicate-join/F-01 test |
| TEST-08 | ❌ | no axe/lint gate | Accessibility is roadmap item 32 |

### F. Billing & commerce

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| BILL-01..08 | ⬜ | no billing code | One-time host unlock is docs-only; item 5/8 |

### G. API, integrations & webhooks

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| API-01 | ⬜ | no webhooks | No inbound/outbound webhook surface |
| API-03 | 🟡 | `docs/NETWORKING.md`; `protocol.ts` | Native WS protocol documented but has no version field |
| API-04 | ⬜ | no customer API keys | No public API product |
| API-05 | 🟡 | `protocol.ts:137-163`; `directory.ts:155-247,808-841` | Per-socket/IP limits + budgets; in-memory counters reset on eviction |
| API-06 | 🟡 | `tts.ts:111-113,129-131` | Google API errors are surfaced; no contract tests |

### H. AI features

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| AI-01..08 | ⬜ | no model calls | Google TTS is speech synthesis, not an LLM/agent surface |

### I. UX & product surface

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| UX-02 | 🟡 | `views/OnlinePlayerView.tsx` join errors | Some join/room states handled; `ROOM_FULL`/budget errors are generic |
| UX-03 | 🟡 | `services/gameService.ts` | `ROOM_FULL`, `RATE_LIMITED`, `TTS_BUDGET_EXCEEDED` are not mapped to actionable copy |
| UX-08 | ❌ | no keyboard/axe gate | Accessibility is roadmap item 32 |

### J. Codebase & process

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| CODE-01 | 🟡 | `wc -l`: `gameService.ts` 2,127; `directory.ts` 901; `room.ts` 717 | Helpers added; large files remain |
| CODE-02 | ❌ | no `.github`; no PR/branch protection | Direct commits to `main`; item 21 |
| CODE-06 | ❌ | `data/_oldquestions.ts:1971`; `protocol.ts` `canReadRoomState` used only by test | Root tsc red; dead helper/exports remain |
| CODE-10 | 🟡 | `docs/NETWORKING.md`; `docs/SERVER_HARDENING.md`; `docs/DEPLOYMENT.md` | Docs mostly match; archive item 15 points at §5 while host authority is §6 |
| CODE-14 | ❌ | `rg --files -i 'privacy|terms'` → 0 | No privacy policy/terms; item 24 |
| CODE-16 | ❌ | git history | Bus factor one; item 33 |

## 6. Could not verify

- GCP hard TTS quota, billing budget and alert delivery — console-only; the
  `PROJECT_ID`/`BILLING_ACCOUNT_ID`/`BUDGET_ID` placeholders in
  `docs/DEPLOYMENT.md` are blank.
- Cloudflare edge rate-limit rules/Turnstile and plan limits — dashboard-only.
- Production `AUTH_MODE`/`TTS_API_TOKEN` presence and entropy; local `wrangler dev`
  uses the sample bindings.
- Real `cf-connecting-ip`/IPv6 behaviour behind NAT; the per-IP caps were tested
  only locally.
- Live room/socket counts and the feasibility of IPv6 rotation against the global
  caps.
- Browser XSS/localStorage exposure of the host/player secrets; source review only.
- GCS bucket IAM, object count, egress and lifecycle.
- The legacy `server/` runtime and its wildcard CORS/admin surface (item 20).
- Full-game state size for 6 players + 20 audience; not measured.
- Alarm retry/eviction under the real Cloudflare runtime; tests invoke the handler
  directly.
- Real 6-player/2-room same-NAT session; e2e covers 1 room/1 player, smoke covers
  6 players/1 room.

## 7. Rejected / downgraded candidates

- “The 6h sweep closes live rooms.” → **False positive** after `ec036c1`;
  `sweepStaleRooms` skips rooms with live Directory sockets. The residual issue is
  the opposite (idle socket-held rooms are never reaped), folded into F-03.
- “`/api/tts` token gate can be bypassed.” → **False positive**; 404 → 401 → 400
  order and constant-time compare verified; budgets fail closed. Residual
  request-rate/body gaps are F-06.
- “The host joins its own room as a player and leaks `hostId`.” → **Partly false**;
  own-room join requires the host secret. The real leak is cross-room reuse of the
  stable player id (`gameService.ts:199-205,564-575`), folded into F-02.
- “The TTS API body limit is bypassable with a chunked request.” → **Confirmed but
  token-gated**; reported as F-06, not a separate High.

## 8. Remediation plan

### Before the first paying customer

| Priority | Item | Finding(s) | Effort |
|---|---|---|---|
| P0 | Server-issued per-player resume secret + socket binding; host kick RPC | F-01 | M |
| P1 | Require the host secret on `getRoomsByHost`; stop deriving host id from client input | F-02 | M |
| P1 | Configure the GCP hard TTS quota and budget/alert; record ids in `DEPLOYMENT.md` | OPS-18 | S |
| P1 | Add the CI/typecheck gate before any external launch | OPS-03 / item 21 | S–M |

### Before enterprise review

- CSP/security headers (`SEC-09`, item 22), privacy policy/terms (`CODE-14`,
  item 24), `SECURITY.md`/`security.txt` (SEC-15), accessibility gate (TEST-08,
  item 32), secret rotation (`SEC-02`, item 27), rollback/DR (OPS-04, item 26).

### Before scale

- Edge rate-limit rules/Turnstile, durable create counters, room/socket capacity
  headroom (F-03); load tests at 100/500/1000 rooms and a reconnect storm
  (TEST-04, item 28); Directory sharding/failure isolation (OPS-07, item 28).

### Hardening notes (do when nearby)

- Idempotent `createRoom` to survive a lost ack (F-04).
- Drain/backfill legacy rooms with empty host-secret hashes (F-05).
- `/api/tts` request rate + hard body read + token rotation (F-06).
- Ack/propagate `STATE_TOO_LARGE` (F-07).

## 9. Re-audit guidance

- Fully re-verify F-01/F-02 after the player-secret/socket-binding and
  `getRoomsByHost` changes; re-run the duplicate-join and host-squat probes.
- Re-check OPS-18 only after the GCP console evidence is recorded.
- Carry forward F-03/F-04/F-05/F-06/F-07 with this date if untouched.
- Re-run the deterministic passes (npm audit, secret scan, worker/unit/e2e/smoke)
  and diff against this scoreboard.
- Suggested cadence: before item 5 (paid entitlements), before the Play Store
  submission, and quarterly thereafter.
