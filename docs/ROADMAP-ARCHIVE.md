# Bamboozle — Roadmap Archive (Completed Index)

Status: **index only** — the live backlog is `docs/ROADMAP.md`; consult this file
during triage (grep it before asking for or implementing anything). Full narrative
lives in git history (the commit that retired the item); canonical knowledge lives
in `AGENTS.md` / `docs/*.md` and the pointers below.

How to use: grep for a feature term before asking for or implementing anything. If it
hits, the work is done — read the pointers, don't re-implement. **Ids are stable:
never renumber or reuse.**

| # | Item | Knowledge / code pointers |
|---|---|---|
| 1 | Server hardening — room caps, rate limits, sanitisation | `docs/SERVER_HARDENING.md`; `server/index.js` |
| 2 | Capacitor Android wrapper | `docs/CAPACITOR_ANDROID.md`; `capacitor.config.ts`; `android/` |
| 3 | Online Friends Mode (single-device multiplayer) | `docs/MULTIPLAYER_PLAN.md`; `services/gameService.ts`; `plan.md` |
| 12 | Fair, non-repeating question and category selection | `services/questionPicker.ts` + `.test.ts`; `services/gameService.ts`; `i18n/questions/*`; `docs/GAME_SYSTEMS.md` |
| 15 | Host identity and room takeover | docs/NETWORKING.md host secret/reclaim; docs/SERVER_HARDENING.md §5; workers/bamboozle-rooms/src/room.ts join+publicState; workers/bamboozle-rooms/src/directory.ts createRoomForHost; services/gameService.ts host secret storage; workers/bamboozle-rooms/test/room.test.ts, test/directory.test.ts, scripts/smoke.mjs |
| 16 | Room action authorization and player-id validation | docs/NETWORKING.md player event authorization; workers/bamboozle-rooms/src/protocol.ts allowlist/stamp/validate; workers/bamboozle-rooms/src/room.ts playerEvent; services/gameService.ts reducer guard/null-prototype maps; workers/bamboozle-rooms/test/room.test.ts, test/protocol.test.ts |
| 17 | Room state read authorization and enumeration | docs/NETWORKING.md state/limits; workers/bamboozle-rooms/src/directory.ts requestState+per-IP limiter; workers/bamboozle-rooms/src/protocol.ts RATE_LIMITED_EVENTS/READ_EVENTS/canReadRoomState; workers/bamboozle-rooms/test/protocol.test.ts, scripts/smoke.mjs |
| 18 | TTS cost abuse | docs/SERVER_HARDENING.md §7; docs/DEPLOYMENT.md cost guardrails; workers/bamboozle-rooms/src/index.ts token gate; workers/bamboozle-rooms/src/tts.ts budget hook; workers/bamboozle-rooms/src/directory.ts tts_budget; workers/bamboozle-rooms/test/index.test.ts, test/directory.test.ts, scripts/smoke.mjs |
| 19 | Abuse and availability caps | docs/SERVER_HARDENING.md §4; docs/NETWORKING.md limits; workers/bamboozle-rooms/src/directory.ts socket/create/room caps+sweep alarm; workers/bamboozle-rooms/src/room.ts player/audience/state caps; workers/bamboozle-rooms/src/env.ts; workers/bamboozle-rooms/test/directory.test.ts, test/room.test.ts, scripts/smoke.mjs |
| 25 | Retire the client-trusted host-token design | docs/BILLING_INTEGRATION.md §4.3 superseded banner; docs/ENTITLEMENT_SYSTEM.md superseded banner; docs/MULTIPLAYER_PLAN.md server-code note; roadmap item 5 is the approved flow |
| 37 | Player identity binding and resume secrets | docs/NETWORKING.md player resume secret; docs/SERVER_HARDENING.md §6; docs/TECHNICAL.md player reconnect; workers/bamboozle-rooms/src/room.ts join/disconnect/playerEvent; workers/bamboozle-rooms/src/directory.ts close-socket; services/gameService.ts secret storage; workers/bamboozle-rooms/test/room.test.ts, scripts/smoke.mjs |
| 38 | Require host secret for room discovery | workers/bamboozle-rooms/src/directory.ts roomsByHost; services/gameService.ts discovery/adopt; docs/NETWORKING.md; docs/SERVER_HARDENING.md §3; workers/bamboozle-rooms/test/directory.test.ts; workers/bamboozle-rooms/scripts/smoke.mjs |
| 21 | CI and typecheck gate | .github/workflows/ci.yml; tsconfig.json; i18n/index.ts; package.json typecheck; docs/DEPLOYMENT.md §CI gate; docs/TESTING.md |
