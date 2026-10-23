# Bamboozle — Roadmap (Open Work Only)

This is the **live backlog**: `[ ]` not started, `[~]` in progress. Completed work is
retired to `docs/ROADMAP-ARCHIVE.md` as **one line**; git history keeps the narrative.

**How this file works — the whole workflow lives here, so no custom skill is required:**

- **Query, don't read it all:** `grep '^## ' docs/ROADMAP.md` lists every item with its
  flags. Read only the matched line range.
- **Every new ask goes through triage first.** Dedupe in this order: headings here →
  `docs/ROADMAP-ARCHIVE.md` → `AGENTS.md` + `docs/*.md` → `git log --oneline --grep=<term>`
  → source. Open item → do it; in-progress → never parallel; done → use the pointer;
  overlaps several → merge into ONE item; nothing → add one.
- **Ids are stable and unique forever.** Never renumber or reuse. Next id =
  `max(live ∪ archive) + 1`. The CLI does this.
- **Shape:** request → approach/files → verify → `Relations:` (depends on / merges /
  supersedes / blocked by).
- **Close in one commit:** flip `[x]`, add ONE archive row
  (`| id | title | doc + code + test pointers |`), delete the live section, then
  `npm run roadmap:check`.
- **CLI:** `npm run roadmap -- list | add "title" | close <id> --points "..." | check`.
- **Portable kit for other repos:** `docs/ROADMAP-KIT.md` (copy 3 files, add 3 scripts).

---

## 4. Cloudflare realtime phase 1 — leave Railway (`[~]`)

- **Request:** Bamboozle's realtime backend runs on Cloudflare Workers + Durable Objects
  on the **free plan**; no Railway. Google TTS + the existing GCS audio cache stay.
- **Approach:** follow `docs/CLOUDFLARE_MIGRATION_PLAN.md` — new worker
  `bamboozle-rooms` (separate from `lemon-rooms`), native-WS protocol,
  `BambooRoom` + `Directory` DOs, alarms instead of timers, TTS via REST with
  **MD5 cache-key compatibility**, deploy with Wrangler. Keep `server/` untouched
  until parity. Client: `services/realtimeClient.ts`, transport swap only in
  `services/gameService.ts`.
- **Verify:** plan §12 checklist — two browsers + phone, full round, host/player
  reconnect grace, 2/3-room caps, rate limit, TTS cache hit, iOS Safari audio,
  Netlify deploy preview, `npm run build`.
- **Status (2026-10-23):** Worker + production cutover done; `wrangler dev`/deployed
  smoke, 3 Playwright room specs, WebKit iPhone emulation and the live Netlify host
  flow pass. Remaining before closing: real-phone iOS check and the 48h monitoring
  window.
- **Relations:** blocks 5 and 10; supersedes Railway in `docs/DEPLOYMENT.md`.

## 5. Paid host entitlements — phase 2 (`[ ]`)

- **Request:** paying hosts unlock hosting on web + Android; players always join free.
- **Approach:** **separate** Supabase project in its own organization (never Lemon's):
  `profiles`, `entitlements`, `purchases` + RLS. RevenueCat webhook (Android) and
  Paddle/Stripe Managed Payments (web) write entitlements. A Supabase Edge Function
  mints a short-lived room token; the Worker verifies it through the existing
  `authorizeHost()` seam (`AUTH_MODE=token`). Keep the £1.99 one-time host unlock.
- **Verify:** purchase → webhook → entitlement row → token → `createRoom`; refund
  revokes at next refresh; cross-device restore; guest players need no account.
- **Relations:** depends on 4; supersedes the client-trusted JWT design in
  `docs/ENTITLEMENT_SYSTEM.md`.

## 6. Shareable join links + QR codes (`[ ]`)

- **Request:** `bamboozle.app/join/{ROOM_CODE}` auto-joins; the host lobby shows a QR.
- **Approach:** client route + code parse on load, lightweight `qrcode` lib, existing
  room flow unchanged. See `docs/MULTIPLAYER_PLAN.md` Phase 2.
- **Verify:** phone scan joins; invalid/expired code shows a clear error; host lobby
  renders the QR at phone-camera size.
- **Relations:** independent of 4/5.

## 7. Browser join-only UI + Get-the-app CTA (`[ ]`)

- **Request:** the browser never renders the Host UI; it shows a Play Store CTA.
- **Approach:** `utils/platform.ts` via Capacitor, hide host components, keep the
  server-side gate in item 5. See `docs/BROWSER_AND_PURCHASE_UX.md`.
- **Verify:** browser home shows Join + CTA only; a console-fired `createRoom` is
  rejected once item 5 lands.
- **Relations:** depends on 5 for the server side.

## 8. RevenueCat + Google Play Billing (`[ ]`)

- **Request:** one-time `bamboozle_host_unlock` at £1.99.
- **Approach:** `docs/BILLING_INTEGRATION.md` — RevenueCat project, product and
  `hosting` entitlement; `services/billingService.ts`, `hooks/useEntitlement.ts`;
  webhook into the Supabase entitlement table (item 5).
- **Verify:** license-tester purchase, restore on reinstall, simulated refund.
- **Relations:** depends on 5; feeds 9.

## 9. Play Store submission (`[ ]`)

- **Request:** internal → closed → production release.
- **Approach:** `docs/CAPACITOR_ANDROID.md` — icons, screenshots, feature graphic,
  privacy policy, content rating. `npm run android:build` must be green.
- **Verify:** internal-track install + purchase; review passed.
- **Relations:** depends on 8.

## 10. Mirror the TTS cache to R2 — optional (`[ ]`)

- **Request:** zero-egress audio while keeping the existing cache.
- **Approach:** copy `gs://bamboozle-audio-assets` (3,159 objects, 85.5 MiB) to an
  R2 bucket; serve via a public bucket or Worker route; **preserve the MD5 names**.
  Keep GCS working during cutover.
- **Verify:** existing phrase is a cache hit from R2; new phrase uploads; old GCS
  URLs still resolve until the switch is complete.
- **Relations:** depends on 4; cost ≈ $0 on R2 free tier (10 GB, 1M writes).

## 11. Voice and phase sync e2e (`[ ]`)

- **Request:** on slow connections, clients can hear narration late or advance to the
  next screen before everyone has finished, producing a desynced round.
- **Approach:** add a focused Playwright spec (or extend `e2e/realtime.spec.ts`) with
  three contexts and per-client `page.route` delays on `storage.googleapis.com` audio
  (0s / 2s / 5s). Assert every client receives `playAudio`/state and that the host's
  reveal → leaderboard transition does not leave a slow client on the previous screen;
  the slow client must catch up after its audio finishes. Drive with `expect.poll`,
  never `waitForTimeout`; register the spec base name in `scripts/smart-test.mjs`.
- **Verify:** run with 0/2/5s delays repeatedly; no client stuck, same room state,
  cache-hit audio only (no new TTS generation), `npm run lint` green.
- **Relations:** depends on 4; follows `docs/TESTING.md` (integration probe, not a
  visual test).

## 14. Classic split-screen views — parity with the online UI (`[ ]`)

- **Request:** the legacy `HostView` (TV) and `PlayerView` (controller) are valid future
  modes but are unreachable because `App.tsx` forces online mode; they duplicate layouts,
  hardcode English, and miss shared emote/reveal/game-over/dev behaviour. Bring them to
  feature parity with `OnlinePlayerView` using shared components.
- **Approach:** extract join/lobby/question/vote/reveal/leaderboard/emote/score pieces
  from `OnlinePlayerView` and `GameSharedComponents`; rebuild both legacy views on them;
  use `Button`/`Input`/`Card`; replace hardcoded strings with `getText`; add an explicit
  Online Friends vs Classic TV mode choice and remove the unconditional
  `shouldForceOnlineMode`; preserve reconnect/reclaim and audience/emote/dev tools.
- **Verify:** design-lab parity matrix (classic host at TV, classic player at phone,
  EN/EL, long copy, 1–6 players, audience, every phase/subphase), a real two-browser
  classic round, online-mode regression, `npm run build`, unit, `npm run lint`.
- **Relations:** depends on 13 (design lab baseline/verification); supersedes the forced
  online mode in `App.tsx`.

## 20. Legacy server hardening or retirement (`[ ]`)

- **Request:** `server/` is the documented rollback but accepts `gameStateUpdate`/`hostEvent`/`requestNarrator` from any socket, uses `cors: '*'`, and mounts unauthenticated `/api/admin/*` when `NODE_ENV !== 'production'` (audit F-07).
- **Approach:** add `rooms[code]?.hostSocketId === socket.id` guards; require an `ADMIN_TOKEN` and `NODE_ENV=production` for admin; remove or protect `/api/tts`; otherwise retire `server/` once item 4 is closed. Keep it as rollback only.
- **Verify:** a socket integration test proves unauth state updates are ignored; unauth admin → 401; unauth TTS → 401/404; the rollback smoke passes.
- **Relations:** depends on 4 (retire after cutover); relates 26.

## 22. Build Tailwind and add CSP/security headers (`[ ]`)

- **Request:** the UI is styled at runtime by an unpinned `cdn.tailwindcss.com` script with no SRI; there is no CSP/nosniff/frame/referrer header set; the built CSS is 954 B of dead directives (audit F-09).
- **Approach:** register `@tailwindcss/vite`, switch `index.css` to `@import "tailwindcss"`, delete the CDN script and the unused `esm.sh` import map; add Netlify `[[headers]]` with CSP, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, and immutable `/assets/*` caching.
- **Verify:** production CSS contains utilities with the CDN blocked; live headers are present; no CSP violations; the game renders on web and Android; `npm run build`.
- **Relations:** relates 21 (assert no CDN host in the bundle).

## 23. Cost alerts, error tracking and uptime (`[ ]`)

- **Request:** there are no budgets, anomaly alerts, error tracker, external uptime check, alert route or status page; the current production outage went unnoticed (audit F-10).
- **Approach:** GCP budget + Pub/Sub alert and a hard TTS quota; Cloudflare usage notifications; Sentry for browser and Worker; an external synthetic that creates/joins a room and checks a TTS cache hit; alerts to a human; a hosted status page.
- **Verify:** a forced Worker 500 and a failed synthetic both page; the budget threshold fires in a test project; the dashboard shows the failure.
- **Relations:** relates 18, 19, 26.

## 24. Privacy policy, terms and retention (`[ ]`)

- **Request:** no privacy policy or terms exist; player names are sent to Google TTS and audio persists publicly; there is no deletion path (audit F-11).
- **Approach:** publish privacy + terms matching the real flow (names, narration text, Google TTS/GCS, localStorage ids, retention), link them in Settings and the store listing, document subprocessors, and add a deletion/retention rule for narration audio.
- **Verify:** pages are live and linked; a deletion request removes the audio; Play data-safety answers match; legal review recorded.
- **Relations:** blocks 9; relates 35.

## 26. Rollback and disaster recovery (`[ ]`)

- **Request:** the documented rollback points at a Railway app that returns 404; there is no Worker version rollback, migration-down path, RTO/RPO or restore exercise (audit F-13).
- **Approach:** document and rehearse `wrangler rollback`/`wrangler versions`; pin deploy artifacts; restore Railway config + health check or retire it; write per-dependency RTO/RPO and a restore drill; record the last exercise date.
- **Verify:** roll a canary Worker version back; restore one GCS object; the timed drill meets the documented RTO; docs updated.
- **Relations:** depends on 4; relates 20, 23.

## 27. Secret and service-account hygiene (`[ ]`)

- **Request:** a live service-account key sits in plaintext (mode 644) with a duplicate in `.dev.vars`, uses the broad `cloud-platform` scope, and has no rotation owner or cadence (audit F-14).
- **Approach:** move the key to a secret manager/keychain, `chmod 600`, delete the duplicate, scope a custom role to get/create/update on one bucket, rotate, and document owner/cadence; prefer WIF/OIDC over a long-lived key.
- **Verify:** the old key is revoked; the Worker works with the new secret; `git status` shows no key; rotation is recorded.
- **Relations:** relates 33, 23.

## 28. Directory DO scale and failure isolation (`[ ]`)

- **Request:** one global Directory DO owns every socket and every broadcast scans all sockets; a hot room slows every room and the DO is a shared single point of failure (audit F-15).
- **Approach:** move socket ownership into each `BambooRoom` DO or shard Directory by room-code prefix; cap room size and connections; add the load test before launch.
- **Verify:** a 100/500/1000-room ramp and a reconnect storm stay within CPU/error budgets; one hot room does not move other rooms' p95; free/paid limits are documented.
- **Relations:** depends on 19; relates 29.

## 29. Room index resilience (`[ ]`)

- **Request:** any non-OK room RPC (including a transient 503) makes `checkRoomExists` delete the index row, so a live room becomes unjoinable (audit F-16).
- **Approach:** delete only on a real 404; retry 5xx/timeouts with backoff; distinguish "unavailable" from "not found"; keep the stored room code on 5xx.
- **Verify:** fault-inject a 503 → the row remains and the retry succeeds; a 404 still deletes; reconnect works.
- **Relations:** relates 28.

## 30. Scoring and phase tests (`[ ]`)

- **Request:** `gameService.ts` has 0% unit coverage and the round e2e asserts only that a heading is visible, so wrong points, multipliers and ties ship silently (audit F-18).
- **Approach:** extract pure `scoreRound`/`advancePhase` modules; table-test truth, lie, 2x/3x, ties, duplicate lies, audience and no-vote cases; set `coverage.include` with a floor; add score assertions to e2e.
- **Verify:** coverage includes `gameService`; a deliberately broken multiplier fails a test; e2e asserts exact points; `npm run test:unit`.
- **Relations:** depends on 21; relates 11.

## 31. Staging isolation (`[ ]`)

- **Request:** there is no staging; every preview shares one Worker/DO/KV and the production GCS bucket, so preview tests pollute production data (audit F-19).
- **Approach:** Wrangler `[env.staging]` with separate DO/KV/bucket; a staging Netlify context; stop committing `.env`; fail the build when `VITE_SERVER_URL` is absent.
- **Verify:** staging create/join works and production is untouched; new audio lands in the staging bucket; a missing env var fails the build.
- **Relations:** depends on 4; relates 26.

## 32. Accessibility (`[ ]`)

- **Request:** pinch zoom is blocked, labels are unassociated, clickable divs are keyboard-inaccessible and modals lack dialog semantics; there is no axe gate (audit F-20).
- **Approach:** remove `user-scalable=no`; use labelled `<button>`/`<input>`; add `role="dialog"`/`aria-modal`/focus trap/Escape; add axe checks to Playwright; target WCAG 2.1 AA.
- **Verify:** axe reports no serious violations; keyboard-only play through join/lobby/round; VoiceOver/TalkBack pass; the design lab covers all phases.
- **Relations:** relates 13/14; depends on 21 for the gate.

## 33. Account ownership and bus factor (`[ ]`)

- **Request:** every control plane (GitHub, Netlify, Cloudflare, GCP) is a personal account with one maintainer; account loss means no deploy, rotation or recovery (audit F-21).
- **Approach:** move to organisation-owned accounts, add a second maintainer, put secrets in a shared vault, and write an access/incident runbook with a recovery drill.
- **Verify:** a second person can deploy and rotate a secret without the founder; the recovery drill is recorded; the access list is reviewed.
- **Relations:** relates 27, 26.

## 34. Mobile navigation and join errors (`[ ]`)

- **Request:** Android back exits from join/lobby/game, a 10s ack timeout is silent, and raw worker codes reach the UI (audit F-22).
- **Approach:** make back state-aware and confirm exit while in a room; surface the timeout with a retry; map `ALREADY_IN_ROOM`/`INVALID_PLAYER_ID` to human copy; add a loading state to Join.
- **Verify:** hardware back from every view; an offline/timeout join shows a retry; no raw code in the UI; `npm run android:build`.
- **Relations:** relates 13/14.

## 35. GCS bucket listing and lifecycle (`[ ]`)

- **Request:** `gs://bamboozle-audio-assets` is anonymously listable (3,185 objects) and has no lifecycle rule; public object read is intentional, list is not (audit F-23).
- **Approach:** remove the `allUsers` list permission, keep object-level read or move to signed URLs/CDN, add a lifecycle rule for orphaned audio, and audit bucket IAM.
- **Verify:** anonymous list → 403; a known object URL still plays; the lifecycle dry run lists only orphans; the cache hit still works.
- **Relations:** relates 24, 27.

## 36. Dependency automation and upgrades (`[ ]`)

- **Request:** upgrades are ad hoc, Vite/TypeScript/framer-motion are two majors behind, and `npm audit` reports 3 root + 2 worker moderate dev-only advisories (audit F-24).
- **Approach:** add Renovate/Dependabot monthly; upgrade Vite 8, TypeScript 7 and framer-motion 14; move `@capacitor/cli` to devDependencies; keep the audit clean.
- **Verify:** `npm audit` has no high/critical; build, unit, worker and e2e pass; no runtime-reachable advisory.
- **Relations:** relates 21.

## 45. Split TTS request budgets by path (`[ ]`)

- **Request:** one shared `req:global` budget (5,000/day) lets a tenant or a leaked ops token silence premium narration for every room; the per-IP cap (500/day) needs only ten addresses to exhaust it (security review F-02).
- **Approach:** separate counters for the ops API and room narration, add a per-room/per-host sub-budget, keep cache hits capped, and rely on Cloudflare edge limits for distributed volume. Files: `directory.ts`, `index.ts`, `room.ts`, `env.ts`, `docs/SERVER_HARDENING.md`.
- **Verify:** one room cannot exhaust another room's narration budget; the ops API and rooms fail independently; normal play and cache hits still work; unit/smoke pass.
- **Relations:** fixes review F-02; relates 18, 42.

## 46. Serialize idempotent room creation (`[ ]`)

- **Request:** the idempotent-create replay check spans awaits and `(host_id, create_key)` is non-unique, so two concurrent creates can insert two rooms for one key; replay then returns the older room (security review F-04).
- **Approach:** re-check `rowForCreateKey` synchronously immediately before the insert (closing the just-initialized room on conflict), or add a partial unique index and treat the conflict as a replay. Files: `directory.ts`, `test/directory.test.ts`.
- **Verify:** two concurrent creates with the same key yield one room; replay returns that room and secret; different keys still create separate rooms; worker tests pass.
- **Relations:** fixes review F-04; relates 40.
