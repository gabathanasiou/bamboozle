# Security & Production-Readiness Audit — Bamboozle — 2026-10-23

> Agent-assisted audit of commit `58084ae` (`main`). Read-only: no tracked code was
> modified by this audit. **This is not a penetration test** — findings come from
> source, configuration and tool output, not live exploitation. Standards
> referenced: OWASP ASVS 5.0.0, OWASP Top 10. Prior audit: none.

## 1. Summary

**Scoreboard:** ✅ 13 · 🟡 46 · ❌ 50 · ⬜ 39 (of 148 checklist items)

**Top findings**

| # | Finding | Severity | Priority | Blocks |
|---|---|---|---|---|
| F-01 | Production web build points at a deleted Railway backend; online mode is broken today | Critical | P0 | first paying customer |
| F-02 | Any player can take over a room: `hostId` is broadcast and accepted as the only host credential | High | P0 | first paying customer |
| F-03 | Players can invoke host-only actions and forge other players' lies/votes via `playerEvent` | High | P0 | first paying customer |
| F-04 | Unauthenticated room-state read and room enumeration by 4-letter code | High | P1 | first paying customer |
| F-05 | Public unauthenticated `/api/tts` allows unbounded Google TTS/GCS spend | High | P0 | first paying customer |
| F-06 | No per-IP/global limits; free-plan quota can be exhausted game-wide | High | P1 | first paying customer |
| F-07 | Legacy `server/` (documented rollback) has no host auth, wildcard CORS, open admin | High (dormant) | P1 | first paying customer |
| F-08 | No CI or merge gate; deploy is build-only and `tsc` already fails | High | P1 | first paying customer |
| F-09 | Runtime Tailwind CDN with no SRI, and no CSP/security headers | High | P1 | enterprise |
| F-10 | No cost alerts, error tracking, uptime checks, alert routing or status page | High | P1 | first paying customer |
| F-11 | No privacy policy or terms while names/narration go to Google TTS | High | P1 | Play Store / enterprise |
| F-12 | Billing design would mint host JWTs from client-supplied input (latent, not built) | High (latent) | P1 | first paying customer |

**Post-audit status (2026-10-23):** F-01 was fixed in `9766dbc`; production now
serves a bundle that points at the Worker and `/health` returns 200. The other
findings remain open and are tracked as roadmap items 15–36.

**Verdict:** Bamboozle is not safe to charge for or submit to Play today. At the
audited commit the production site could not connect to any backend (F-01, since
fixed in `9766dbc`); with the live Worker now reachable, any player in a room can
seize host control (F-02), issue host actions (F-03), read any room's full state
(F-04), and anyone on the internet can spend the owner's Google TTS budget (F-05).
Those four are small, contained fixes and should land before the next external
user. The engineering hygiene is better than average for a solo project
(parameterised SQL, real Worker tests, a working protocol contract, honest
hardening docs), but nothing gates a deploy, nothing watches production, and no
legal surface exists yet.

## 2. Scope & method

- **Mode:** full — all 148 checklist items, whole repository, no change set.
- **Pinned commit:** all evidence and line numbers refer to `58084ae`. Uncommitted
  work appeared in the tree while the audit was running (including `App.tsx`,
  `docs/ROADMAP.md`, `services/audioService.ts`, and new `views/HomeView.tsx` /
  `views/OfflineView.tsx`); it was not made by this audit and is **not covered
  here**. Re-check the affected UX lines after that work lands.
- **Audited:** React 19 + Vite frontend (`App.tsx`, `views/`, `components/`,
  `services/`), Cloudflare Worker `workers/bamboozle-rooms/` (Directory and room
  Durable Objects, TTS, protocol), legacy Express/Socket.IO `server/`, Netlify
  config, Wrangler config, Capacitor Android config, package manifests and
  lockfiles, docs (`docs/*.md`, `AGENTS.md`, `README.md`), git history.
- **Excluded / not available:** Google Cloud, Cloudflare, Netlify, GitHub and
  Railway dashboard settings; Play Console; live logs and analytics; the actual
  contents of production secrets. See §6.
- **Tools run:** `npm audit --json` root (3 moderate, 0 high/critical), `server/`
  (0), `workers/bamboozle-rooms` (2 moderate, 0 high/critical); secret history
  scan (`git log --all -S 'BEGIN PRIVATE KEY'`, `git grep`, `git ls-files` —
  the only hit is a `.dev.vars.example` placeholder); pattern sweeps
  (`dangerouslySetInnerHTML`, `innerHTML`, `eval(`, `new Function`,
  `document.write` → 0 hits; parameterised SQL audit of 15 `sql.exec` calls);
  `npx tsc --noEmit` (fails, TS1010); unit coverage (0% on `gameService.ts`);
  worker tests/typecheck (28 tests pass, worker typecheck clean); `npx playwright
  test --list` (4 tests, one desktop Chromium profile); `npm outdated`; live
  read-only HTTP checks. `gitleaks`, `trufflehog` and `osv-scanner` are not
  installed — see §6.
- **Method:** six read-only domain sweeps ran as parallel subagents (AUTH+DATA,
  SEC, OPS, TEST+BILL, API+AI, UX+CODE). Every Medium+ candidate was then handed
  to a **fresh, independent verifier** (six more parallel subagents) instructed
  to disprove it; the lead re-read every Critical/High cited line. Verifier
  verdicts are recorded in each finding. Domain sweeps and verifiers were
  read-only; one verifier ran `vite build` to a temp out-dir and coverage to
  `$TMPDIR`, and another ran the test scripts — no tracked file changed
  (`git status` clean).
- **Production probes disclosed:** the audit made only unauthenticated,
  non-mutating requests — `GET /health`, `GET` of the public Netlify page and
  bundle, a GCS metadata listing, and `POST /api/tts` with an empty body (400,
  no synthesis). No room was created, joined or enumerated; no audio was
  synthesised; no exploitation was attempted.

## 3. Domain scoreboard

| Domain | ✅ | 🟡 | ❌ | ⬜ | Notes |
|---|---|---|---|---|---|
| Identity & access | 0 | 3 | 4 | 7 | No accounts by design; host identity is a public bearer ID |
| Data layer | 4 | 10 | 1 | 6 | Per-room SQLite is sound; state validation and retention are weak |
| Application security & compliance | 0 | 7 | 11 | 6 | No disclosure/pentest/privacy surface; authz is the core gap |
| Infrastructure, ops & supply chain | 4 | 12 | 11 | 4 | No CI, monitoring, budgets or working rollback |
| Testing & QA | 1 | 3 | 3 | 1 | Real unit/worker tests; core game logic untested |
| Billing & commerce | 0 | 0 | 4 | 4 | Nothing built; design docs contain a dangerous shortcut |
| API & webhooks | 1 | 3 | 3 | 1 | Google token refresh is solid; no API keys or webhooks |
| AI features | 0 | 0 | 0 | 8 | No model calls anywhere in the product |
| UX & product surface | 1 | 3 | 4 | 2 | Good i18n framework; a11y and back navigation fail |
| Codebase & process | 2 | 5 | 9 | 0 | Good docs, no review, bus factor one |

## 4. Findings

Ordered by severity. Every finding carries the template shape.

### F-01 — Production web build points at a deleted Railway backend · Critical · P0 · verified (fixed post-audit in `9766dbc`)

- **Where:** `.env:1` (tracked: `git ls-files .env` → `.env`);
  `dist/assets/index-DYZQrfBS.js`; `services/gameService.ts:134`;
  `services/realtimeClient.ts:269-276`; `server/index.js:21`;
  `netlify.toml:1-3`; `docs/DEPLOYMENT.md:3,71-82`.
- **What:** The only production env var is
  `VITE_SERVER_URL=https://bamboozle-production.up.railway.app`. Vite inlines it
  at build; the published Netlify bundle is byte-identical to `dist` and contains
  that URL. The Railway app returns **404 `Application not found`**.
- **Reachability:** Every web and Android user right now. Host shows
  "Connecting…" forever; Join appears to do nothing, then times out after 10s.
  The client speaks native WebSocket (`/ws`); the legacy server is Socket.IO-only,
  so even restoring Railway would not fix it without a protocol bridge.
- **Impact:** The game's online mode — the paid product — does not work in
  production. Local pass-and-play is unaffected.
- **Evidence:** `curl -sS -o /dev/null -w '%{http_code}' https://bamboozle-production.up.railway.app/`
  → `404`; `curl https://bamboozlegame.netlify.app/` loads
  `assets/index-DYZQrfBS.js`, which contains `bamboozle-production.up.railway.app`
  and no Worker URL; Worker `/health` → `200`.
- **Fix:** Set `VITE_SERVER_URL=https://bamboozle-rooms.gabathanasiou.workers.dev`
  in Netlify's **production and branch-deploy** contexts, rebuild (not
  `--no-build`), and verify create/join from the production origin. Then
  `git rm --cached .env`, add an untracked `.env.example`, and add a build-time
  assertion that the bundle does not contain a `railway.app` host.
- **Effort:** S.
- **Verification:** Two independent verifiers reproduced the live bundle and the
  404; lead spot-checked the live HTML, `dist` grep, Railway 404 and Worker 200.
  Confidence 10.
- **Post-audit status:** fixed in `9766dbc`; the live bundle now contains
  `https://bamboozle-rooms.gabathanasiou.workers.dev` and `/health` returns 200.
  Re-verify create/join from the production origin.

### F-02 — Host takeover via broadcast `hostId` · High · P0 · verified

- **Where:** `services/gameService.ts:187,200-205`; `types.ts:84`;
  `workers/bamboozle-rooms/src/room.ts:259-269`;
  `workers/bamboozle-rooms/src/directory.ts:174-204,353-368`;
  `server/index.js:194-207,264-284` (same pattern on the legacy path).
- **What:** The host's identity is its client-generated `playerId`, copied into
  `GameState.hostId` and broadcast to every player on join and on every state
  update. The room DO grants host to anyone whose `playerId === hostId` while
  the real host is in grace (`pending` or no `hostSocketId`). `createRoom` is
  unauthenticated and capped per **caller-supplied** hostId, so calling it with
  the victim's hostId puts the victim's oldest room into host grace.
- **Reachability:** Any player in a room (or anyone who read `hostId` via F-04).
  Read `state.hostId`; call `createRoom {hostId: victimHostId}` twice; call
  `joinRoom {roomCode, id: victimHostId, role:'HOST'}` from another socket →
  `becameHost:true`. The victim is then rejected by `isHostRequest`
  (`room.ts:379-388`).
- **Impact:** Full authoritative control of someone else's room: arbitrary state
  to all players, forced rounds/categories, kicking, room kill, TTS spend, and
  lockout of the real host. No account or secret is needed.
- **Evidence:** `becameHost = playerId === hostId && (pending || !hostSocketId)`
  (`room.ts:262`); the third room for a host enters grace
  (`directory.ts:359-368`); the room DO test suite asserts that grace behaviour
  as intended.
- **Fix:** Issue a server-generated 128-bit host secret at room creation, store a
  hash, and require it on reclaim; never include it in the broadcast state.
  Bind host identity to the socket/token rather than to a public player id, and
  do not let an unauthenticated caller grace or close another host's rooms.
- **Effort:** M.
- **Verification:** Independent verifier reproduced the full chain and the
  lockout; lead read `room.ts:259-269`, `directory.ts:353-368` and the broadcast
  path. Confidence 9.

### F-03 — Players can invoke host-only actions and forge votes · High · P0 · verified

- **Where:** `workers/bamboozle-rooms/src/directory.ts:291-300`;
  `workers/bamboozle-rooms/src/protocol.ts:145-155`;
  `services/gameService.ts:588-594,1036-1148,1192-1210,1252-1279`;
  `server/index.js:372-387`.
- **What:** `playerEvent` is relayed to the host with only `payload.text` and
  `payload.name` sanitised. The host client runs `processHostEvent` for every
  relayed event, and that reducer handles `START_GAME`, `RESTART_GAME`,
  `UPDATE_ROUNDS`, `SELECT_CATEGORY`, `REMOVE_PLAYER`, `TOGGLE_PAUSE` and
  `SUBMIT_LIE`/`SUBMIT_VOTE`. The last two trust `payload.playerId` with no
  sender check.
- **Reachability:** Join any room (free, no account) and emit `playerEvent`.
  The Directory's host check applies to `gameStateUpdate`/`hostEvent`/
  `requestNarrator` but deliberately not to `playerEvent`.
- **Impact:** Any player can restart or start the game, change rounds, pick the
  category, kick lobby players, pause, force a reveal, and submit or change
  another player's lie and vote. Complete loss of game authority; no data or
  code execution.
- **Evidence:** `case 'playerEvent'` → `broadcast('playerEvent', …)` with no role
  check (`directory.ts:291-300`); `client.on('playerEvent', … processHostEvent …)`
  (`gameService.ts:591-593`); `START_GAME` has no phase/sender guard
  (`gameService.ts:1044-1080`).
- **Fix:** Whitelist player-originated event types in the Directory and the host
  reducer; stamp the sender id from the socket attachment and reject mismatched
  `payload.playerId`; keep host-only events on `hostEvent` only.
- **Effort:** M.
- **Verification:** Independent verifier traced all seven event branches and the
  forged-vote path; lead read `directory.ts:291-300` and the reducer branches.
  Confidence 9.

### F-04 — Unauthenticated room-state read and enumeration · High · P1 · verified

- **Where:** `workers/bamboozle-rooms/src/directory.ts:168-178,253-266`;
  `workers/bamboozle-rooms/src/protocol.ts:103-110`;
  `workers/bamboozle-rooms/src/directory.ts:645-650`;
  `workers/bamboozle-rooms/src/room.ts:471-482`;
  `workers/bamboozle-rooms/src/origin.ts:20`.
- **What:** `requestState` accepts any 4-letter room code and returns the full
  persisted `GameState` without joining or proving membership. `checkRoom` and
  `getRoomsByHost` are likewise unauthenticated and absent from
  `RATE_LIMITED_EVENTS`. Codes are 26⁴ = 456,976, allocated randomly.
- **Reachability:** Connect to `/ws` (a missing `Origin` is explicitly allowed),
  send `requestState`; or enumerate codes cheaply and read the ones that exist.
  No join, no account, no Origin header.
- **Impact:** Reads player names, the current question **and its correct
  answer**, all lies and votes, and `hostId` — which directly enables F-02.
  Cheating and targeting, not mass PII.
- **Evidence:** `const code = normalizeRoomCode(data.roomCode) || attachment.roomCode;`
  then `roomFetch(code, '/internal/state')` with no membership check
  (`directory.ts:253-266`); `RATE_LIMITED_EVENTS` omits these three events
  (`protocol.ts:103-110`).
- **Fix:** Require `attachment.roomCode === code` for `requestState`; rate-limit
  read events per socket and per IP; strip `hostId` from all outgoing state;
  consider 5–6 character codes or signed join links.
- **Effort:** S.
- **Verification:** Independent verifier confirmed; lead read the dispatch and
  rate-limit set. Confidence 9.

### F-05 — Public unauthenticated `/api/tts` allows unbounded spend · High · P0 · verified

- **Where:** `workers/bamboozle-rooms/src/index.ts:40-42,69-95`;
  `workers/bamboozle-rooms/src/tts.ts:55-77`;
  `workers/bamboozle-rooms/src/origin.ts:18-20`.
- **What:** `POST /api/tts` has no authentication, no rate limit, no budget and
  no callers in the client. It accepts 500 characters and synthesises plus
  uploads on a cache miss. `Origin` is not authentication, and a missing
  `Origin` is allowed.
- **Reachability:** Anyone on the internet with the public `workers.dev` URL,
  which is in the repo and the live preview. `POST {}` reaches the handler and
  returns `400 TEXT_REQUIRED`; any non-empty text synthesises.
- **Impact:** At the free-plan ceiling (100k requests/day × 500 chars ×
  ~$16/M Neural2 chars) that is roughly **$800/day** of Google TTS before the
  Worker quota stops it, plus GCS writes and permanent public cache pollution
  under the product's bucket. Estimate is list-price arithmetic, not a bill.
  The host narrator path (F-02/F-03) is a second, smaller channel.
- **Evidence:** route at `index.ts:40-42`; handler validates only length, text
  and language (`index.ts:69-95`); live probe returned 400 with no `Origin`.
- **Fix:** Remove the route (no client references it) or require a short-lived
  host token; add per-IP and global character budgets; set a hard Google TTS
  quota and a GCP budget alert with a stop.
- **Effort:** S.
- **Verification:** Two independent verifiers reached the handler; lead read the
  route and handler and confirmed the client has no call site. Confidence 10.

### F-06 — No per-IP/global limits; quota exhaustion is game-wide · High · P1 · verified

- **Where:** `workers/bamboozle-rooms/src/protocol.ts:12-14,103-118`;
  `workers/bamboozle-rooms/src/directory.ts:110-118,139-147,353-399`;
  `workers/bamboozle-rooms/src/directory.ts:544-554`;
  `workers/bamboozle-rooms/src/room.ts:249-294`.
- **What:** The only rate limit is 20 events/10 s **per socket**, stored in the
  socket attachment; reconnecting resets it. `createRoom` is capped at two rooms
  per caller-supplied `hostId`, so rotating the string bypasses it. There is no
  per-IP, total-connection or total-room cap, and no server-side player cap.
  Every broadcast iterates all sockets on the single Directory DO.
- **Reachability:** Any WebSocket client; no Origin required.
- **Impact:** Exhausts the Workers/DO free-plan request budget, which stops the
  game for everyone. Fills the room index; the 6-hour sweep only runs inside
  `createRoom`. A 256 KiB state frame is amplified to every socket in the room.
- **Evidence:** `MAX_EVENTS_PER_WINDOW = 20` and the six-event set
  (`protocol.ts:12-14,103-110`); no `CF-Connecting-IP` use anywhere in
  `workers/bamboozle-rooms/src` (`rg` → 0 hits).
- **Fix:** Cloudflare rate-limit rules/Turnstile per IP; add read events to the
  limiter; per-IP socket and room caps; an explicit server-side player cap; a
  periodic sweep rather than create-time only.
- **Effort:** M.
- **Verification:** Independent verifier confirmed; lead read the limiter and
  cap logic. Confidence 9.

### F-07 — Legacy server has no host auth, wildcard CORS, open admin · High (dormant) · P1 · verified

- **Where:** `server/index.js:21-36,57-65,306-331,372-387`;
  `server/adminRoutes.js:120-193`; `docs/DEPLOYMENT.md:3,71-101`.
- **What:** The documented production backend/rollback accepts `gameStateUpdate`,
  `hostEvent` and `requestNarrator` from any socket without checking the host,
  uses `origin:'*'` plus bare `cors()`, exposes `/api/tts` publicly, and mounts
  `/api/admin/*` whenever `NODE_ENV !== 'production'` with no auth. Nothing in
  the repo sets `NODE_ENV`.
- **Reachability:** **Dormant today** — Railway returns 404 and no local server
  runs. It becomes live the moment `server/` is redeployed, including as a
  "fix" for F-01. The same TTS-spend pattern is already live on the Worker.
- **Impact:** If revived: any Socket.IO client can overwrite any room's state,
  relay fake host events, trigger TTS spend, and possibly run admin batch jobs
  and disk writes. No accounts or sensitive data.
- **Evidence:** `rooms[roomCode].state = gameState` with no sender check
  (`server/index.js:306-313`); `requestNarrator` comment says "Only accept from
  Host" but the check is only room existence (`server/index.js:322-331`).
- **Fix:** Do not revive as-is. Add
  `if (rooms[code]?.hostSocketId !== socket.id) return;` to all three handlers;
  require an admin secret and set `NODE_ENV=production`; remove or protect
  `/api/tts`. Better: finish the cutover and retire `server/`.
- **Effort:** S (guard) / M (retire).
- **Verification:** Independent verifier confirmed code and the 404; lead read
  the three handlers. Confidence 10 on code, 8 on conditional risk.

### F-08 — No CI or merge gate; the typecheck is already red · High · P1 · verified

- **Where:** no `.github/`; `netlify.toml:1-3`; `package.json:8,14-26`;
  `data/_oldquestions.ts:1971`; `tsconfig.json`.
- **What:** There is no CI, no branch protection and no PR history; `main` is
  pushed directly. Netlify runs `npm run build` (`vite build`) only — no
  typecheck, lint, unit, worker or e2e test. `lint` checks roadmap/doc budgets,
  not code. `npx tsc --noEmit` exits 2 (`TS1010` at `data/_oldquestions.ts:1971`;
  after deleting that file a stale import also fails).
- **Reachability:** Every change, human or agent.
- **Impact:** Broken trees deploy — F-01 is the proof. Scoring/protocol
  regressions ship silently. The 28 unit and 28 worker tests are advisory only.
- **Evidence:** `gh api repos/.../actions/workflows` → `total_count:0`;
  branch protection → 404; `gh pr list --state all` → `[]`; `npx tsc --noEmit`
  → `data/_oldquestions.ts(1971,3): error TS1010: '*/' expected.`
- **Fix:** Add GitHub Actions on PR/push running `npm ci`, lint, `tsc --noEmit`,
  unit, worker typecheck/tests, build and Playwright; require the checks and a
  PR on `main`; fix/delete `_oldquestions.ts`, exclude `workers/**` from the root
  tsconfig and fix the stale i18n import.
- **Effort:** S–M.
- **Verification:** Independent verifier ran the commands; lead reproduced the
  `tsc` failure and lack of workflows. Confidence 10.

### F-09 — Runtime Tailwind CDN with no SRI, and no security headers · High · P1 · verified

- **Where:** `index.html:6,8,49-62`; `index.css:3-5`; `vite.config.ts:12`;
  `netlify.toml:1-8`; `dist/assets/index-Bov8weh_.css` (954 B).
- **What:** The app is styled entirely at runtime by a parser-blocking
  `https://cdn.tailwindcss.com` script with no `integrity`; the built CSS is 954
  bytes of literal `@tailwind` directives because the Vite plugin is not
  registered. There is no CSP, `X-Content-Type-Options`, `frame-ancestors`,
  `Referrer-Policy` or `Permissions-Policy`; live responses carry only Netlify's
  HSTS. An unpinned `esm.sh` import map is present but unused by the bundle.
- **Reachability:** Every page load. A CDN compromise runs arbitrary JS on the
  game origin, can read `bamboozle_player_id`/room code from localStorage and
  act as the host; no CSP limits the blast radius or clickjacking.
- **Impact:** Supply-chain XSS on a product that will soon handle entitlements;
  total UI failure if the CDN is blocked (hotel wifi, ad-blockers, outage).
- **Evidence:** `index.html:8` `<script src="https://cdn.tailwindcss.com"></script>`
  with no integrity; live headers on `/` and `/assets/*` contain only
  `strict-transport-security`; `netlify.toml` has no `[[headers]]`.
- **Fix:** Register `@tailwindcss/vite`, switch `index.css` to
  `@import "tailwindcss"`, delete the CDN script and the import map; add Netlify
  `[[headers]]` with CSP, `frame-ancestors 'none'`, `nosniff`,
  `Referrer-Policy: no-referrer`, a minimal `Permissions-Policy`, and immutable
  caching for `/assets/*`.
- **Effort:** M.
- **Verification:** Independent verifier compared live CSS/headers; lead read
  `index.html`, `netlify.toml` and the built CSS. Confidence 10.

### F-10 — No cost alerts and no production observability · High · P1 · verified

- **Where:** no budget/alert config (`rg -i 'budget|billing alert|anomal'` →
  prose only); `wrangler.toml:32-33`; `workers/bamboozle-rooms/src/index.ts:31-35`;
  `README.md:48`; `server/index.js:34-35`.
- **What:** There are no GCP budgets/anomaly alerts, no Cloudflare usage
  notifications, no Sentry/equivalent, no external uptime check, no alert route
  and no status page. `/health` returns a static `{ok:true}` and nothing probes
  it. README "Monitoring" refers to the dev-only Express admin dashboard.
  GCP Budget and Monitoring APIs are disabled on the project.
- **Reachability:** Silent. The current production outage is the proof: it went
  unnoticed because nothing checks a real create/join.
- **Impact:** TTS abuse (F-05) is discovered on the invoice; outages are
  discovered by players; client errors are invisible; MTTR is unbounded.
- **Evidence:** `rg -i 'sentry|bugsnag|datadog|uptime|statuspage|pagerduty'`
  → 0 source hits; `wrangler.toml` has only `[observability] enabled = true`.
- **Fix:** GCP budget + Pub/Sub alert and a hard TTS quota; Cloudflare usage
  notifications; Sentry for browser and Worker; an external synthetic monitor
  that creates/joins a room and checks a TTS cache hit; route alerts to a human;
  a hosted status page.
- **Effort:** M.
- **Verification:** Independent verifier checked GCP APIs and the repo; lead
  read the health route and config. Confidence 9.

### F-11 — No privacy policy or terms while data leaves to Google · High · P1 · verified

- **Where:** repo-wide search for privacy/terms → no policy file or page;
  `docs/ROADMAP.md:88`; `services/gameService.ts:975,1407,1593`;
  `services/gameService.ts:138-145`; `workers/bamboozle-rooms/src/tts.ts:67-76`.
- **What:** No privacy policy or terms exist. `/privacy` and `/terms` return the
  SPA shell (200) because of the redirect, not a policy. Player names are
  embedded in narrator text and sent to Google TTS; the resulting MP3 is stored
  permanently in a public GCS bucket. Player/room ids live in localStorage.
- **Reachability:** Every player; every Play Store review; any data request.
- **Impact:** Play Store submission blocker, GDPR transparency/retention gap, no
  deletion path for narration audio, and no subprocessor disclosure.
- **Fix:** Publish privacy + terms matching the real data flow (names, narration
  text, Google TTS/GCS, retention), link them in Settings and the store listing,
  and define a deletion/retention policy (including audio).
- **Effort:** S–M.
- **Verification:** Independent verifier checked the routes and data flow; lead
  read the TTS call path. Confidence 9.

### F-12 — Billing design would mint host JWTs from client input · High (latent) · P1 · verified

- **Where:** `docs/BILLING_INTEGRATION.md:248-263`;
  `docs/BROWSER_AND_PURCHASE_UX.md:184-188`;
  `docs/ENTITLEMENT_SYSTEM.md:118-121`; `services/gameService.ts:12,138-145`.
- **What:** The reference implementation of `POST /api/get-host-token` signs
  `issueHostToken(userId)` from the request body **without verifying `rcToken`**
  and says "trusting the client is acceptable". The entitlement doc keys the
  free trial to a client-generated `hostId`, which is just a random string in
  localStorage.
- **Reachability:** **Not built**; roadmap item 5 supersedes it with a
  Supabase Edge Function and short-lived room tokens. If built as written,
  anyone can mint a valid 7-day host JWT and clearing localStorage resets the
  trial.
- **Impact (as intended):** 100% entitlement bypass and free unlimited hosting.
- **Fix:** Mark both docs "superseded — do not implement"; implement item 5's
  RevenueCat webhook → server-side entitlement → short-lived token path; never
  trust a client `userId` or `rcToken`.
- **Effort:** S to prevent; L to implement properly.
- **Verification:** Independent verifier quoted the doc and confirmed no code;
  lead read the section. Confidence 8. **Latent: as-committed there is no
  reachable finding; as-intended it is High.**

### F-13 — Rollback and DR are unexecutable and untested · Medium · P2 · verified

- **Where:** `docs/DEPLOYMENT.md:95-101`; no `railway.json`/`Dockerfile`/
  `Procfile` (`git ls-files` → 0); `workers/bamboozle-rooms/wrangler.toml:16-18`.
- **What:** The only documented rollback is "set `VITE_SERVER_URL` back to the
  Railway URL" — which now returns 404 — plus a Netlify rebuild. There is no
  Worker version rollback doc, no Railway config, no migration-down path and no
  RTO/RPO or restore exercise.
- **Impact:** During the current outage the documented rollback cannot work;
  incident recovery depends on rebuilding a service from memory.
- **Fix:** Document and rehearse `wrangler rollback`/`wrangler versions` and pin
  deploy commit/artifacts; rebuild Railway config + health check or retire it;
  add a DR/RTO/RPO page and exercise it quarterly.
- **Effort:** M.
- **Verification:** Independent verifier checked the Railway 404 and wrangler
  versions; lead read the deployment doc. Confidence 10.

### F-14 — Service-account key plaintext on disk, broad scope, no rotation · Medium · P2 · verified

- **Where:** `google-credentials.json` (mode 644, untracked);
  `workers/bamboozle-rooms/.dev.vars` (same `private_key_id`);
  `workers/bamboozle-rooms/src/tts.ts:20-24,198-216`;
  `docs/DEPLOYMENT.md:56-58,89-90`.
- **What:** A live Google service-account private key sits in plaintext in the
  repo working tree and a duplicate in `.dev.vars`; the Worker mints tokens with
  the broad `cloud-platform` scope; the documented role is Storage Object Admin.
  There is no rotation procedure, owner or cadence.
- **Reachability:** Local filesystem, backups and synced folders only — not
  remotely reachable. Key material is real, not a placeholder.
- **Impact if leaked:** Bucket overwrite/delete of all 3,185 MP3s and TTS billing
  on the project; no MFA on a service-account key.
- **Fix:** Move the key to a secret manager/keychain, `chmod 600`, delete the
  duplicate, scope to `storage.objects.get/create/update` on one bucket, rotate,
  and document an owner/cadence. Prefer WIF/OIDC over a long-lived key.
- **Effort:** S.
- **Verification:** Independent verifier confirmed same key id and scope without
  printing secrets; lead confirmed file presence/mode. Confidence 9.

### F-15 — Single global Directory DO is the shared hot path · Medium · P2 · verified

- **Where:** `workers/bamboozle-rooms/src/directory.ts:49-61,102-119,544-554`;
  `workers/bamboozle-rooms/src/index.ts:60-62`;
  `docs/ARCHITECTURE.md:22-25`.
- **What:** Every WebSocket lands on one `idFromName('directory')` DO, and every
  broadcast iterates `getWebSockets()` across the whole system and filters by
  room. There is no per-IP/total connection cap or room-size cap.
- **Impact:** A hot room's fan-out consumes the shared event loop and adds
  latency to every room; a Directory failure stops all realtime relay. Free-plan
  CPU/request limits are the ceiling. Availability, not confidentiality.
- **Fix:** Move socket ownership into each room DO or shard Directory by room-code
  prefix; add caps; load-test before launch.
- **Effort:** L.
- **Verification:** Independent verifier confirmed O(all sockets) per broadcast;
  lead read the broadcast loop. Confidence 8.

### F-16 — A transient room error deletes a live room from the index · Medium · P2 · verified

- **Where:** `workers/bamboozle-rooms/src/directory.ts:222-237,401-408,472-477,509-527`.
- **What:** `roomInfo` returns null for any non-OK response (including the 503
  synthesised when a stub fetch throws), and `checkRoomExists` deletes the index
  row on null. There is no retry and no 404-vs-5xx distinction.
- **Impact:** A transient DO error during any join makes a live room
  unjoinable/undiscoverable; the rejoining client clears its stored code. The
  room DO keeps running with existing sockets but cannot be found.
- **Fix:** Delete only on a real 404; retry 5xx/timeouts with backoff; distinguish
  "unavailable" from "not found" in the client.
- **Effort:** S.
- **Verification:** Independent verifier traced the error path; lead read the
  functions. Confidence 8.

### F-17 — Prototype pollution via `__proto__` player id · Medium · P2 · verified

- **Where:** `workers/bamboozle-rooms/src/protocol.ts:131-133`;
  `workers/bamboozle-rooms/src/directory.ts:217`;
  `services/gameService.ts:912-913,1132-1140`.
- **What:** Player ids are only sanitised (tag-strip/truncate), so `__proto__`
  is accepted. The Worker stores it as a string, but the host indexes plain
  objects with it: `players['__proto__']` resolves to `Object.prototype`, and
  assignments pollute the prototype. `Object.values(players).filter(p => p.currentVote)`
  then counts players without an own vote.
- **Impact:** Host-page prototype pollution; conditional forced reveal/skip and
  corrupted tallies. Requires a host reconnect (JSON round-trip drops the
  shadowing `undefined`), and is redundant with F-03.
- **Fix:** Validate ids against `^[A-Za-z0-9_-]{1,50}$`; reject `__proto__`,
  `constructor` and `prototype`; use `Object.create(null)`/`Map` for player maps.
- **Effort:** S.
- **Verification:** Independent verifier reproduced the JS semantics and the
  conditional impact; lead read the indexing lines. Confidence 8.

### F-18 — Core scoring engine has 0% unit coverage · Medium · P2 · verified

- **Where:** `services/gameService.ts:1663-1701`; `vitest.config.ts:20-23`;
  `e2e/realtime.spec.ts:173-174`.
- **What:** The live app hook is untested. Coverage on `gameService.ts` is
  **0/1163 statements**; the aggregate reports 85% only because the config does
  not set `all: true`/`include`, so unimported files disappear. The only e2e
  round asserts that `STANDINGS` is visible — no numeric score or multiplier.
- **Impact:** Wrong points, tie handling, duplicate-lie and disconnected-voter
  behaviour, and phase desync ship silently.
- **Fix:** Extract pure `scoreRound`/`advancePhase` modules and table-test truth,
  lie, 2x/3x, ties, duplicate and no-vote cases; set `coverage.include` and a
  floor; add score assertions to e2e.
- **Effort:** M.
- **Verification:** Independent verifier ran coverage; lead read the scoring
  block and e2e assertions. Confidence 9.

### F-19 — No staging isolation; previews share Worker/DO/KV/GCS · Medium · P2 · verified

- **Where:** `workers/bamboozle-rooms/wrangler.toml:1-33` (no `[env.*]`);
  `docs/DEPLOYMENT.md:71-89`; `.env:1`.
- **What:** One Worker, one DO namespace, one KV id and one GCS bucket serve all
  previews; there is no staging. Today Netlify's production context points at
  Railway while previews point at the Worker, but every preview shares the same
  Worker/DO/KV and production audio bucket.
- **Impact:** Preview tests create rooms and pollute the production audio cache;
  no environment to rehearse migrations; blast radius is the whole service.
- **Fix:** Wrangler `[env.staging]` with separate DO/KV/buckets; a staging Netlify
  context; stop committing `.env`; fail builds when `VITE_SERVER_URL` is missing.
- **Effort:** M.
- **Verification:** Independent verifier corrected the "prod shares the Worker"
  part (Netlify contexts differ) but confirmed shared preview infra and bucket;
  lead read the Wrangler config. Confidence 8.

### F-20 — Accessibility failures block keyboard/screen-reader users · Medium · P2 · verified

- **Where:** `index.html:6`; `components/ChangelogModal.tsx:92`;
  `views/GameSharedComponents.tsx:763-774`; `App.tsx:207`;
  `views/PlayerView.tsx:138-141,344`; `views/OnlinePlayerView.tsx:31-33`;
  `views/SettingsView.tsx:74-76`.
- **What:** Pinch zoom is disabled; there is one `aria-label` in the app; text
  labels are not associated (`htmlFor` → 0 hits); clickable divs have no role,
  tabindex or key handler; modals lack dialog semantics, focus trap and Escape.
- **Impact:** Keyboard-only, screen-reader and low-vision users cannot reliably
  play. Fails WCAG 2.1 AA (1.4.4, 2.1.1, 1.3.1/4.1.2, 2.4.3); an
  enterprise/procurement review will fail.
- **Fix:** Remove `user-scalable=no`; use labelled `<button>`s; associate labels;
  add `role="dialog"`/`aria-modal`/focus trap/Escape; add axe checks to Playwright.
- **Effort:** M.
- **Verification:** Independent verifier confirmed; lead read the viewport meta
  and modal markup. Confidence 9.

### F-21 — Bus factor one; every account is personal · Medium · P2 · verified

- **Where:** `git remote -v` → `github.com/gabathanasiou/bamboozle`; one GitHub
  collaborator; Netlify team "gab-atha's team"; Cloudflare account personal; GCP
  project `gen-lang-client-0210833338`.
- **What:** A single maintainer owns the repo and every control plane. There is
  no second reviewer, no org ownership, no company entity evidence and no
  continuity/incident runbook.
- **Impact:** Account loss or unavailability means no deploy, no secret rotation,
  no recovery, no customer support. Blocks enterprise supplier review.
- **Fix:** Move GitHub/Netlify/Cloudflare/GCP to organisation-owned accounts, add
  a second maintainer, put secrets in a shared vault, and write an access/incident
  runbook.
- **Effort:** M.
- **Verification:** Independent verifier checked the accounts; lead confirmed the
  remote and single-collaborator state. Confidence 9.

### F-22 — Mobile/join UX: back exits, failures are silent or leak codes · Low · P3 · verified

- **Where:** `App.tsx:43-51,106-110`; `services/realtimeClient.ts:76-78,86-92`;
  `services/gameService.ts:1901`; `views/OnlinePlayerView.tsx:288`;
  `views/PlayerView.tsx:231`; `workers/bamboozle-rooms/src/directory.ts:183-235`.
- **What:** Android hardware back at `/` exits the app because views are React
  state, not routes. A 10 s ack timeout is only `console.warn`ed, so Join looks
  dead; worker codes (`ALREADY_IN_ROOM`, `INVALID_PLAYER_ID`) can reach the UI
  verbatim. The Join button itself remains pressable (implicit retry).
- **Impact:** Accidental exit mid-game; confusing join failures; trivial internal
  code disclosure.
- **Fix:** Make back state-aware and confirm exit while in a room; add a timeout
  message and explicit retry; map worker codes to human copy.
- **Effort:** S.
- **Verification:** Independent verifier confirmed and downgraded the "no retry"
  part; lead read the back handler and timeout path. Confidence 9.

### F-23 — GCS audio bucket is anonymously listable · Low · P3 · verified

- **Where:** `workers/bamboozle-rooms/src/tts.ts:51-53`;
  `docs/DEPLOYMENT.md:89`.
- **What:** `storage.googleapis.com/storage/v1/b/bamboozle-audio-assets/o?maxResults=1`
  returns 200; the full listing is 3,185 objects / 86.2 MiB. Public object read
  is intentional (the client plays the URLs); public **list** is not needed.
- **Impact:** Bulk egress and easier enumeration of hashed audio names. Object
  names are `md5(text-language)`, so there is no plaintext phrase inventory.
- **Fix:** Remove `allUsers` list permission, keep object-level read or use
  signed URLs/CDN; add a lifecycle rule for orphaned audio.
- **Effort:** S.
- **Verification:** Two independent verifiers listed the bucket; lead confirmed
  the 200 response. Confidence 10.

### F-24 — Dependency drift and dev-only advisories · Low · P3 · verified

- **Where:** `package.json:37-38,56-57`; `npm outdated`; `npm audit`.
- **What:** Vite 6.4.5 vs 8.3.5, TypeScript 5.8.3 vs 7.0.2, framer-motion
  12.29.2 vs 14.6.0. `npm audit`: root 3 moderate (`@capacitor/cli` → `xcode` →
  `uuid`), worker 2 moderate (`@vitest/mocker` via `vitest`), 0 high/critical.
  None is imported at runtime or bundled. Upgrades are ad hoc (7-month gap).
- **Impact:** Forced big-bang upgrades later; no automated advisory monitoring.
- **Fix:** Renovate/Dependabot monthly; upgrade the three majors; move
  `@capacitor/cli` to devDependencies.
- **Effort:** M.
- **Verification:** Independent verifier confirmed none is runtime-reachable;
  lead read the audit output. Confidence 9.

## 5. Checklist verdicts

Every item from `references/checklist.md` appears. Evidence is `file:line`, a
command, or "platform".

### A. Identity, accounts & access

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| AUTH-01 | 🟡 | `workers/bamboozle-rooms/src/room.ts:59-86`; `directory.ts:68-81` | No account schema by design; per-room SQLite is coherent but unversioned, no FKs/CHECKs/RLS |
| AUTH-02 | ⬜ | `rg 'login\|password\|email' services/ workers/ server/` → 0 auth hits | No email/password login; room-code join only |
| AUTH-03 | ⬜ | no reset token/provider anywhere | No password-reset flow exists |
| AUTH-04 | ⬜ | no MFA code; phase-2 accounts unbuilt (`docs/ROADMAP.md:44-53`) | No MFA/recovery; B2C today |
| AUTH-05 | 🟡 | `services/realtimeClient.ts:205-214`; `src/env.ts:14-16`; `gameService.ts:138-143` | Socket-scoped, 60s grace; no session expiry/revocation; `hostId` persists forever |
| AUTH-06 | ⬜ | no SSO code or roadmap item | Consumer product, no enterprise customer |
| AUTH-07 | ⬜ | no SAML code | No SAML |
| AUTH-08 | ⬜ | no SCIM/account lifecycle | No accounts to deprovision |
| AUTH-09 | ❌ | `protocol.ts:16,139-142`; `directory.ts:227`; `gameService.ts:591-592` | Roles are self-asserted; enforcement is client-side |
| AUTH-10 | ❌ | `directory.ts:253-266`; `room.ts:262` | `requestState` any code; `joinRoom` accepts any id (F-02/F-04) |
| AUTH-11 | ❌ | `directory.ts:174-177,253-266,411-435` | Cross-room state/metadata by code or leaked hostId |
| AUTH-12 | ⬜ | no impersonation code | No "log in as user" |
| AUTH-13 | ❌ | `protocol.ts:103-118`; `directory.ts:110-118` | Per-socket limit only, resets on reconnect, read events exempt |
| AUTH-14 | 🟡 | `room.ts:417-421`; `protocol.ts:103-118` | No passwords; room-code guessing has no global throttle/alerting |

### B. Data layer & correctness

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| DATA-01 | 🟡 | `wrangler.toml:16-18`; `room.ts:59-86` | `CREATE TABLE IF NOT EXISTS`; no down path/version table; manual deploy |
| DATA-02 | ✅ | `rg 'ALTER TABLE'` → 0; per-room cold schema | No shared table or blocking DDL |
| DATA-03 | ✅ | `directory.ts:78-79`; `room.ts:61-84` | PKs and both room indexes exist; deadlines small |
| DATA-04 | 🟡 | `directory.ts:49-61,544-554`; `index.ts:60-62` | No PG pooling; one global Directory DO is the analogue bottleneck |
| DATA-05 | 🟡 | no backup doc; `room.ts:207-209` | Room state ephemeral; GCS audio regenerable; no owner/retention |
| DATA-06 | ⬜ | `rg 'restore' docs` → purchase restore only | No restore runbook/evidence |
| DATA-07 | ⬜ | `rg 'point-in-time\|pitr'` → 0 | No PITR procedure/window |
| DATA-08 | 🟡 | `room.ts:207-209`; `directory.ts:359-368` | Rooms hard-deleted on close; no trash/undo |
| DATA-09 | ❌ | `room.ts:325-326`; `protocol.ts:145-155` | Arbitrary `gameState`/event accepted; only text/name capped |
| DATA-10 | ✅ | `room.ts:139,229`; `directory.ts:73` | All timestamps epoch ms; no wall-clock/DST |
| DATA-11 | ✅ | `room.ts:273-285`; `protocol.ts:121-124` | Parameterised SQL; apostrophes round-trip (only `<…>` stripped) |
| DATA-12 | 🟡 | `protocol.ts:123` | UTF-16 truncation can split emoji; no NFC/NFD or RTL handling |
| DATA-13 | ⬜ | `rg 'price\|currency\|amount' services/ workers/ server/` → 0 | No money stored |
| DATA-14 | ⬜ | no tax/currency code | Billing-phase decision |
| DATA-15 | 🟡 | `room.ts:74-77`; `gameService.ts:96-113` | Single unversioned JSON state; defaults only |
| DATA-16 | 🟡 | `rg 'idempoten'` → 0; `directory.ts:180-204` | No payment endpoints; `createRoom` not idempotent |
| DATA-17 | 🟡 | `room.ts:273-280`; `gameService.ts:1111-1133` | Join upserts, votes guarded; createRoom has no natural-key dedupe |
| DATA-18 | 🟡 | `directory.ts:359-368`; `protocol.ts:7` | Lists bounded by 3-room cap; server accepts unlimited players; no pagination |
| DATA-19 | ⬜ | `rg 'csv\|xlsx\|export'` in code → 0 | No export exists |
| DATA-20 | ⬜ | `rg 'csv\|xlsx\|papaparse'` → 0 | No import path |
| DATA-21 | 🟡 | `room.ts:207-209`; `directory.ts:499-507` | Rooms deleted, 6h sweep; no retention doc; GCS audio never deleted |

### C. Application security & compliance

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| SEC-01 | 🟡 | `.gitignore:43-44`; `git ls-files .env`; `vite.config.ts:13-16` | No secret in history/bundle; tracked `.env` (public values), live SA key on disk, latent Gemini define |
| SEC-02 | ❌ | `docs/DEPLOYMENT.md:56-58`; no rotation doc | No per-secret rotation owner/cadence |
| SEC-03 | 🟡 | `package-lock.json` (integrity, registry); `server/index.js:5` vs `server/package.json` | Lockfiles pinned; `cors` undeclared; unused deps |
| SEC-04 | ❌ | no `.github`, Dependabot/Renovate or audit script | No automated dependency scanning |
| SEC-05 | 🟡 | `rg 'dangerouslySetInnerHTML\|innerHTML\|eval('` → 0; `room.ts:323-333` | No HTML sinks; unsanitised host state is stored/relayed |
| SEC-06 | 🟡 | 15 `sql.exec`, all `?`-parameterised; no cookies | SQLi/CSRF/SSRF absent; object authz broken (F-02/F-03/F-04) |
| SEC-07 | ⬜ | `rg 'multer\|busboy\|type="file"'` → 0 | No upload/import surface |
| SEC-08 | 🟡 | `origin.ts:8-25`; `server/index.js:23,31` | Worker allowlist real (no `*`); missing Origin allowed; legacy `*` |
| SEC-09 | ❌ | `netlify.toml:1-8`; `index.html:8` | No CSP/nosniff/frame/referrer/permissions headers |
| SEC-10 | 🟡 | `https`/`wss` paths; `tts.ts:51-53`; `AndroidManifest.xml:9` | TLS in web; provider at-rest; Android cleartext + public bucket |
| SEC-11 | ❌ | `google-credentials.json`; `tts.ts:22`; `docs/DEPLOYMENT.md:89-90` | One broad service-account key, plaintext, no scoping |
| SEC-12 | 🟡 | `tts.ts:69-73`; `server/index.js:303,326` | No tokens logged; legacy logs names/text; no retention/correlation |
| SEC-13 | ❌ | no pentest report/roadmap item | Never run |
| SEC-14 | ❌ | no policy/questionnaire docs | Cannot evidence a security questionnaire |
| SEC-15 | ❌ | `git ls-files \| grep -i security` → ∅ | No SECURITY.md/security.txt/disclosure process |
| SEC-16 | ❌ | no device-loss/revocation runbook | No laptop-stolen plan; key on disk |
| SEC-17 | ⬜ | no SOC 2 artefacts | Consumer product, no enterprise contract |
| SEC-18 | ⬜ | no patient/health fields | No PHI |
| SEC-19 | ⬜ | no PHI vendors | N/A; DPAs with Google/Cloudflare/Netlify also absent |
| SEC-20 | ❌ | no read-access logging | "Who viewed a record" unanswerable |
| SEC-21 | ⬜ | `rg 'stripe\|paddle\|cvv'` in code → 0 | No card data; billing unbuilt |
| SEC-22 | ❌ | `room.ts:207-209`; no privacy/deletion path | No GDPR deletion answer; narration audio persists publicly |
| SEC-23 | ⬜ | no region pinning or EU commitment | No residency guarantee made yet |
| SEC-24 | ❌ | no access-review doc | No inventory/sign-off of prod access |

### D. Infrastructure, ops & supply chain

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| OPS-01 | 🟡 | `wrangler.toml:1-33`; `docs/DEPLOYMENT.md:71-82`; `.env:1` | No staging; prod uses Railway, previews use one shared Worker |
| OPS-02 | 🟡 | `wrangler.toml`, `netlify.toml`, Gradle files | Config in files; KV/secrets/IAM are manual |
| OPS-03 | ❌ | no `.github`; `netlify.toml:1-3`; `package.json:8,14` | Build-only deploy; no test/lint/audit gate |
| OPS-04 | ❌ | `docs/DEPLOYMENT.md:95-101`; Railway 404 | Rollback target dead; no Worker rollback doc |
| OPS-05 | 🟡 | `netlify.toml`; `room.ts:59-85`; `index.ts:37-39` | Atomic swaps; no expand/contract or client version gate |
| OPS-06 | ❌ | `rg 'feature.?flag\|kill.?switch'` → 0 | No runtime flags; TTS/rooms cannot be disabled without deploy |
| OPS-07 | 🟡 | `docs/SERVER_HARDENING.md:77-86`; `directory.ts:49-61` | Edge scales; global Directory and free caps are the ceiling |
| OPS-08 | ✅ | `netlify.toml`; Google edge for audio | CDN in place |
| OPS-09 | ✅ | platform-managed `workers.dev`/`netlify.app` TLS | Auto-renewing; no custom domain |
| OPS-10 | 🟡 | `room.ts:351-372` | TTS inline in DO; no queue |
| OPS-11 | 🟡 | `tts.ts:146-155`; `realtimeClient.ts:206-214` | Client backoff good; server retries only 401 |
| OPS-12 | ❌ | `index.ts:88-94`; `room.ts:373-375` | Failed TTS logged/dropped; no DLQ/replay |
| OPS-13 | ✅ | `room.ts:394-431`; `directory.ts:499-507` | Per-room DO alarms, single writer |
| OPS-14 | ✅ | `tts.ts:43-49,168-195` | Content-addressed cache; token TTL/invalidation |
| OPS-15 | ⬜ | `rg 'sendgrid\|resend\|nodemailer\|smtp'` → 0 | No email infra |
| OPS-16 | ⬜ | same → 0 | No bounces/complaints |
| OPS-17 | 🟡 | `room.ts:207-210`; `docs/TECHNICAL.md:43` | Rooms cleaned; GCS append-only, no lifecycle |
| OPS-18 | ❌ | no budget/alert config; GCP APIs disabled | No cost alerts on any metered service |
| OPS-19 | ❌ | no DR/RTO/RPO doc | No disaster-recovery plan |
| OPS-20 | 🟡 | `directory.ts:49-61` | Single-location DO; no uptime contract promised |
| OPS-21 | 🟡 | `wrangler.toml:32-33`; `room.ts:203` | Observability on; unstructured logs, no actor/request ids |
| OPS-22 | ❌ | `rg 'sentry\|bugsnag\|datadog'` → 0 | No error tracking/grouping |
| OPS-23 | ❌ | `/health` exists; `rg 'uptime'` → 0 | Nothing external probes it |
| OPS-24 | ❌ | `rg 'pagerduty\|on-call'` → 0 | No alert route to a human |
| OPS-25 | 🟡 | platform graphs only | No app-level latency/error/throughput dashboard |
| OPS-26 | ❌ | `rg 'opentelemetry\|otel\|traceparent'` → 0 | No tracing/correlation |
| OPS-27 | ⬜ | no on-call docs | Solo maintainer; no rotation to audit |
| OPS-28 | 🟡 | `docs/DEPLOYMENT.md:95-113` | Deploy/rollback steps; no quota/TTS/Directory runbooks |
| OPS-29 | ⬜ | `git log --grep='incident\|postmortem'` → 0 | No incidents recorded pre-launch |
| OPS-30 | ❌ | `rg 'status page\|statuspage'` → 0 | No status page |
| OPS-31 | 🟡 | no `engines`/`.nvmrc`; Node v26 local; `wrangler.toml:3` | Node unpinned; compat date/Android SDK current |

### E. Testing & QA

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| TEST-01 | 🟡 | `services/questionPicker.test.ts`; `realtimeClient.test.ts`; 28 tests; `gameService.ts` 0% | Picker/transport tested; core game logic untested (F-18) |
| TEST-02 | 🟡 | `workers/.../test/room.test.ts`, `directory.test.ts`; `scripts/smoke.mjs` | DO integration real; Google TTS/GCS only manual smoke |
| TEST-03 | ⬜ | no signup/checkout code | No money path exists to test |
| TEST-04 | ❌ | `rg 'k6\|artillery\|autocannon\|soak'` → 0 | No load/soak/concurrency test |
| TEST-05 | ✅ | `questionPicker.test.ts:12-20`; `e2e/realtime.spec.ts` | Synthetic data, no PII/accounts |
| TEST-06 | 🟡 | `docs/TESTING.md:130-150`; `0790098` adds tests | Policy good; older fixes lack specs; no CI enforcement |
| TEST-07 | ❌ | `playwright.config.ts:16-34`; `docs/ROADMAP.md:39-41` | Desktop Chromium only; roadmap overclaims WebKit iPhone |
| TEST-08 | ❌ | `index.html:6`; `SettingsView.tsx:74-76`; no axe | No a11y gate; WCAG failures committed (F-20) |

### F. Billing & commerce

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| BILL-01 | ⬜ | `docs/ROADMAP.md:75-81`; no billing code | One-time non-consumable; no subscriptions/proration |
| BILL-02 | ⬜ | `docs/BILLING_INTEGRATION.md:3,337` | No recurring charge; Play handles declines |
| BILL-03 | ❌ | no invoice/PO code | No procurement invoices |
| BILL-04 | ❌ | `docs/ROADMAP.md:47-50`; `BILLING_INTEGRATION.md:84-91` | MoR planned (Play/Paddle) but nothing configured |
| BILL-05 | ❌ | `BILLING_INTEGRATION.md:337`; `ROADMAP.md:52-53` | Refund entitlement revocation planned only |
| BILL-06 | ⬜ | flat one-time price; `tts.ts:67-75` | No usage billing; TTS cost unmetered |
| BILL-07 | ⬜ | no contract/invoice code | No annual contracts |
| BILL-08 | ❌ | RevenueCat dashboard charts only | No ledger/export finance can reconcile |

### G. API, integrations & webhooks

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| API-01 | ❌ | `rg 'webhook\|signature\|hmac'` in source → 0 | No webhooks, no signature verification |
| API-02 | ❌ | `tts.ts:146-155`; `index.ts:91-94` | No outbound retry/backoff or delivery log |
| API-03 | 🟡 | `index.ts:9,37-39`; `protocol.ts:1-5` | Hardcoded `/api/version`; no path versioning/negotiation |
| API-04 | ❌ | `auth.ts:13-19`; `wrangler.toml:25` | No API keys; host id is client-chosen |
| API-05 | 🟡 | `protocol.ts:103-118`; `index.ts:69-95` | Per-socket 20/10s; TTS and reads unlimited |
| API-06 | 🟡 | `tts.ts:84-88,115-116,243-249` | Defensive parsing; no contract tests/changelog monitor |
| API-07 | ✅ | `tts.ts:146-155,168-196` | Google 401 refresh + KV/isolate cache |
| API-08 | ⬜ | no customer integration API | No sandbox needed yet |

### H. AI features

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| AI-01 | ⬜ | `rg 'gemini\|openai\|anthropic\|llm\|generateContent'` → only `vite.config.ts`, README | No model calls or prompt surfaces |
| AI-02 | ⬜ | no prompts; `tts.ts:93-108` | No prompt leaves the network; TTS text flow is F-11 |
| AI-03 | ⬜ | no model spend | Nearest spend is TTS (F-05) |
| AI-04 | ⬜ | no evals; no model | Nothing to evaluate |
| AI-05 | ⬜ | no model provider | TTS fallback exists (`gameService.ts:536-556`) |
| AI-06 | ⬜ | no model; static voice map `tts.ts:26-29` | No model deprecation path needed |
| AI-07 | ⬜ | no prompt logs; legacy logs TTS text | Nothing prompt-shaped retained |
| AI-08 | ⬜ | no agent/destructive AI actions | Only legacy admin operators |

### I. UX & product surface

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| UX-01 | ❌ | 890 KB JS/277 KB gz; Tailwind CDN; no SW/manifest | Heavy first load; no offline shell; assets revalidate |
| UX-02 | 🟡 | `App.tsx:318-342`; `ChangelogModal.tsx:116-136` | Loading/offline states exist; no error boundary/catch-all |
| UX-03 | 🟡 | `OnlinePlayerView.tsx:288`; `realtimeClient.ts:76-78` | "Room not found" actionable; silent timeouts/internal codes |
| UX-04 | ✅ | `PlayerView.tsx:166,175,225-232`; `OnlinePlayerView.tsx:231-241` | Inputs retained on failed join |
| UX-05 | ⬜ | no email infra | No templates to test |
| UX-06 | ⬜ | no notification code | Nothing to turn off |
| UX-07 | ❌ | `OnlinePlayerView.tsx:448,514,769` | No undo; destructive actions immediate |
| UX-08 | ❌ | `index.html:6`; one aria-label; no htmlFor | Keyboard/screen-reader support essentially absent (F-20) |
| UX-09 | 🟡 | 80/80 en/el keys; `PlayerView.tsx:154-293`; `SettingsView.tsx` | i18n framework good; entry/settings hardcoded English; dates `en-US` |
| UX-10 | ❌ | `App.tsx:43-51,106-110` | Android back exits mid-flow; no 404 route |

### J. Codebase & process

| ID | Verdict | Evidence | Note |
|---|---|---|---|
| CODE-01 | 🟡 | `gameService.ts` 2,051 lines; views 742–845 | Naming/structure consistent; core files too large |
| CODE-02 | ❌ | no `.github`; 0 PRs; `docs/BEST_PRACTICES.md:50` | No review; docs claim one; direct-to-main |
| CODE-03 | 🟡 | branching policy documented; 0 merges | Written but not evidenced |
| CODE-04 | ❌ | `package.json:37-38,56-57`; 7-month gap | Not monthly; three majors behind |
| CODE-05 | ✅ | Vite 6.4, React 19, Node 22 supported | No framework past security EOL |
| CODE-06 | ❌ | `data/_oldquestions.ts`; `Player3D.tsx`; `Card.tsx`; `question-viewer/` | Dead/AI leftovers, one breaks tsc |
| CODE-07 | ❌ | 2,051-line `gameService.ts`; no size rule | Monolith not split |
| CODE-08 | ✅ | `docs/ARCHITECTURE.md:29-37`; `docs/DEPLOYMENT.md:95-101` | Architecture/trade-offs written down |
| CODE-09 | 🟡 | `README.md:5,9,35`; `.env:1` | README stale (AI Studio, Gemini, dead Railway) |
| CODE-10 | 🟡 | 22 docs; `TESTING.md:39`; `RELEASE_NOTES.md:7` | Good coverage, some stale; no ownership/incident page |
| CODE-11 | ❌ | `/admin` dev-only `App.tsx:109`; Worker has no ops API | No production ops panel |
| CODE-12 | ❌ | `rg 'support@\|help center\|faq'` → 0 | No support tooling/contact |
| CODE-13 | 🟡 | `ChangelogModal.tsx:52-69` | Exists; one 8-month-old entry |
| CODE-14 | ❌ | no privacy/terms | Missing entirely (F-11) |
| CODE-15 | ❌ | remote/owner `gabathanasiou`; personal Netlify/Cloudflare/GCP | Everything under personal accounts |
| CODE-16 | ❌ | `git shortlog -sne` → one person | Bus factor one |

## 6. Could not verify

- **Cloudflare dashboard:** plan/usage, deployed version vs `58084ae`, DO
  jurisdiction, WAF/rate-limit rules, Workers Logs retention, account MFA,
  notification policies. Confirm in the dashboard.
- **Google Cloud:** the service account's actual IAM role and key age, bucket
  IAM/UBLA, bucket location, audit logs, TTS quotas and any billing-account
  budget created outside the project. The project's Budget/Monitoring APIs are
  disabled, so only repo-side absence was proven.
- **Netlify:** the production/branch `VITE_SERVER_URL` values live in the
  dashboard (CLI redacts them); the published bundle and docs are the evidence.
  Deploy-context history and rollback state not inspected.
- **Railway:** whether the service can be restored, its `NODE_ENV`, region or
  env vars; the documented URL returns 404.
- **GitHub:** branch protection, secret scanning/push protection, private
  vulnerability reporting, collaborator list (read-only API showed one
  collaborator and no workflows).
- **Play Console:** data-safety declarations, privacy URL state, licence testers.
- **Live exploitation/traffic:** no room enumeration, no forged events, no TTS
  synthesis, no load test; no analytics/logs were available to see prior abuse.
- **Manual device testing:** VoiceOver/TalkBack, iOS Safari audio unlock,
  low-end Android, captive-portal behaviour were not exercised.
- **AI chat history:** not in the repo; cannot verify what credentials or prompts
  were pasted into agent sessions.
- **Secret scanners:** `gitleaks`, `trufflehog` and `osv-scanner` are not
  installed, so only history/search heuristics were run, not a full scanner.

## 7. Rejected / downgraded candidates

- **GCS bucket anonymously listable → Low** (was Medium): listing is real
  (3,185 objects), but object names are MD5 hashes and public object read is the
  intended playback path; no plaintext phrase inventory, and egress was already
  possible for known names.
- **TTS awaited inline in the room DO → Low/hardening** (was Medium): DO I/O
  interleaves other events, it affects only that room, and clients have a local
  speech fallback (`gameService.ts:536-556`). Real gaps are timeout/retry, not a
  hard room freeze.
- **"Other players get no audio on TTS failure" → rejected**: `PLAY_NARRATION`
  fallback is broadcast and handled by players (`gameService.ts:1328-1345,728-740`).
- **`__proto__` prototype pollution → Medium** (was High): mechanism confirmed,
  but the worker stores strings; impact requires a host reconnect and is
  redundant with F-03.
- **"Preview and production share one Worker/DO/KV" → partly rejected**: Netlify
  contexts differ today (production → Railway, preview → Worker). The real gap
  is shared preview infra and one GCS bucket, reported as F-19.
- **"No retry affordance on join" → downgraded**: the Join button stays
  pressable; the real issue is the silent 10 s timeout and raw codes.
- **"esm.sh import map is an active supply-chain risk" → hardening**: the
  production bundle does not use it; remove it with the Tailwind cleanup.
- **"Scoring coverage gap is High" → Medium**: it is a release-quality risk, not
  an exploitable security issue.
- **"No load test is High" → scale hardening**: functional Directory tests exist;
  the missing dimension is throughput, not correctness.
- **"No company entity" → unverified**: no evidence found, but absence in the
  repo is not proof; treated under F-21 without asserting it.
- **`.dev.vars.example` "BEGIN PRIVATE KEY" hit → false positive**: placeholder
  text only; the real key is the untracked `.dev.vars`.

## 8. Remediation plan

> **Roadmap mapping (2026-10-23):** F-02 → 15, F-03 + F-17 → 16, F-04 → 17,
> F-05 → 18, F-06 → 19, F-07 → 20, F-08 → 21, F-09 → 22, F-10 → 23, F-11 → 24,
> F-12 → 25, F-13 → 26, F-14 → 27, F-15 → 28, F-16 → 29, F-18 → 30, F-19 → 31,
> F-20 → 32, F-21 → 33, F-22 → 34, F-23 → 35, F-24 → 36. F-01 is being fixed
> separately and has no roadmap item.

### Before the first paying customer

| Priority | Item | Finding(s) | Effort |
|---|---|---|---|
| P0 | Point production/branch builds at the Worker, rebuild, verify create/join; untrack `.env` | F-01 | S |
| P0 | Server-issued host secret; stop broadcasting `hostId`; bind reclaim to it | F-02 | M |
| P0 | Whitelist player event types; stamp sender id; reject forged `playerId` | F-03 | M |
| P0 | Remove or token-gate `/api/tts`; add per-IP limits and a hard GCP TTS quota | F-05 | S |
| P1 | Require membership for `requestState`; rate-limit read events; strip `hostId` | F-04 | S |
| P1 | Cloudflare per-IP/global limits, server-side player cap, periodic sweep | F-06 | M |
| P1 | Do not revive `server/` as-is; add host guards + admin auth if it must stay | F-07 | S |
| P1 | GitHub Actions gate (lint, tsc, unit, worker, build, e2e) + branch protection | F-08 | S–M |
| P1 | Build Tailwind, remove CDN/import map, add Netlify security headers/CSP | F-09 | M |
| P1 | Budget alerts, Sentry, external synthetic create/join monitor, status page | F-10 | M |
| P1 | Publish privacy policy + terms; document retention/deletion | F-11 | S–M |
| P1 | Mark the client-trust billing design superseded; implement item 5 properly | F-12 | S now |

### Before enterprise review

- SSO/SAML/SCIM, MFA and recovery (AUTH-04/06/07/08) — not needed for consumers,
  required the moment a B2B deal appears.
- Durable audit trail of who viewed/changed what (SEC-20) and a disclosure
  process (`SECURITY.md`/`security.txt`, SEC-15).
- Pen test before their security team runs one (SEC-13); questionnaire evidence
  pack (SEC-14); DPAs/subprocessor list (SEC-19/23).
- Organisation-owned accounts, a second maintainer, access reviews and a
  device-loss/revocation runbook (F-21, SEC-16/24).
- Staging isolation and rehearsed rollback/DR (F-13, F-19).
- Accessibility remediation and an axe gate (F-20, TEST-08).

### Before scale

- Replace/shard the global Directory DO; add connection and room-size caps;
  load-test 100/500/1000 rooms and a reconnect storm (F-15, F-06).
- Add indexes only where real queries need them; there is no shared relational
  table today (DATA-03).
- Move TTS off the room DO with timeout/retry/DLQ and a circuit breaker.
- Add tracing/correlation and app-level dashboards (OPS-21/25/26).
- Add a second region only if an uptime contract requires it (OPS-20).

### Hardening notes (batch: do when nearby)

- Remove the `GEMINI_API_KEY` `define` block (`vite.config.ts:13-16`); no code
  reads it, and it is one import from a public leak.
- Pin Node (`.nvmrc`, `engines`, Netlify `NODE_VERSION`) and drop the
  `postinstall` legacy-server install (OPS-31).
- Set Android `cleartext: false` in production and `allowBackup="false"`
  (`capacitor.config.ts:14-18`; `AndroidManifest.xml:4,9`).
- Remove `allUsers` list permission from the GCS bucket (F-23).
- Version the realtime protocol (API-03); add bounded retry/backoff for 429/5xx
  and a dead-letter/replay path for TTS (OPS-11/12).
- Delete `data/_oldquestions.ts`, `components/Player3D.tsx`,
  `components/ui/Card.tsx`, `metadata.json` and the unused `question-viewer/`;
  add a `typecheck` script.
- Add a production ops surface (room list/kill, health, cache) behind auth and
  an in-app support/status link (CODE-11/12).
- Add Renovate/Dependabot and upgrade Vite 8 / TypeScript 7 / framer-motion 14;
  move `@capacitor/cli` to devDependencies (F-24).

## 9. Re-audit guidance

- Fully re-verify every open P0/P1, plus anything whose cited files changed.
- Carry forward with age: P2/P3s not yet touched (mark "carried from 2026-10-23").
- Re-run the tool passes in §2 and diff the scoreboard: dependency audit, secret
  history scan, `tsc --noEmit`, worker tests, coverage on `gameService.ts`, and
  the live bundle/Worker checks.
- Suggested cadence: before the production cutover, before Play Store submission,
  and quarterly thereafter; a full pass again before the first paid entitlement.
