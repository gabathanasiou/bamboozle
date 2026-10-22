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
- **Status (2026-10-22):** Worker + Preview built; `wrangler dev`/deployed smoke, 3
  Playwright room specs and WebKit iPhone emulation pass. Remaining before closing:
  production cutover, real-phone iOS check, and the 48h monitoring window.
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
