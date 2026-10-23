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
