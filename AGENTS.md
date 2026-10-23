# Bamboozle — Agent Guide

Real-time multiplayer party game: React + Vite front-end (Netlify / Capacitor Android),
Google Cloud TTS + GCS voice cache, and a realtime backend that is moving from
Railway/Socket.IO to Cloudflare Workers + Durable Objects.

## Commands

- `npm run dev` — Vite dev server
- `npm run build` — production build (run before every commit)
- `npm run preview` — preview the build
- `npm run android:build` — Capacitor Android build
- `npm run roadmap -- list|add|close|check` — roadmap CLI
- `npm run lint` — currently the roadmap contract check

## Roadmap — the required workflow

- `docs/ROADMAP.md` holds **open items only** (`[ ]` / `[~]`).
- Completed work moves to `docs/ROADMAP-ARCHIVE.md` as **one line** (id, title,
  doc/code pointers). Git history keeps the narrative.
- Ids are **stable and unique forever**. The CLI assigns the next free id.
- Every new ask goes through triage first: headings here → archive → `docs/*.md` →
  `git log --oneline --grep=<term>` → source. Open item → do it; in-progress → don't
  parallel it; done → use the pointer; overlaps → merge into one item.
- Close in one commit: `npm run roadmap -- close <id> --points "docs/...; path/..."`
  (or edit by hand), then `npm run roadmap:check`.
- The full contract is the header of `docs/ROADMAP.md`; the portable
  copy-to-another-repo instructions are `docs/ROADMAP-KIT.md`.

## Read first

1. `docs/ROADMAP.md` — what is open right now (grep `^## `, don't read it whole)
2. `docs/CLOUDFLARE_MIGRATION_PLAN.md` — phase 1 target architecture
3. `docs/NETWORKING.md` — event contract that must be preserved
4. `docs/SERVER_HARDENING.md` — rules to port (caps, rate limits, sanitisation)
5. `docs/TECHNICAL.md` — audio/TTS pipeline

## Project skills

- `.opencode/skills/design-lab-handoff/` — turns a pasted `/designer` resize
  request into responsive code at the stated breakpoint (`docs/DESIGN_LAB.md`).

## Architecture facts

- Game state is authoritative in the **host client**; the backend is a relay plus room
  registry and reconnect timers.
- TTS audio is cached in `gs://bamboozle-audio-assets` (3,159 MP3s, ~85.5 MiB).
  Cache names are `md5(text + "-" + language).mp3` — **never change the hash**.
- `server/` is the legacy Railway/Express/Socket.IO implementation. Keep it until the
  Cloudflare phase-1 parity checklist passes; it is the rollback path.
- The target Worker is `bamboozle-rooms` (Workers Free + Durable Objects, SQLite).

## Hard rules

- **Never mix this repo with Lemon Schedule.** Do not reuse `lemon-rooms`, its Durable
  Object namespace, secrets, or code. Separate worker, separate DO classes, separate
  secrets/resources.
- Never commit `google-credentials.json` or `.env*` (both gitignored). Production
  secrets go through `wrangler secret` / the host's env.
- Free-tier discipline in the Worker: hibernation WebSockets, DO alarms (never
  `setTimeout`/`setInterval`), persist room state at most every 5 seconds.
- Do not delete knowledge when closing a roadmap item — put the canonical pointer in
  `docs/*.md` or the archive row first.
- Small, revertible commits; imperative messages. Ask a blocking question instead of
  guessing on protocol, entitlement, or billing behaviour.

## Testing

- Read `docs/TESTING.md` first: unit (Vitest) → integration → e2e (Playwright).
- Automate only silent-break risk; visual changes get a numbered manual check.
- Register new spec base names in `scripts/smart-test.mjs`; an orphan fails `lint`.
- Triage a red run with `test:smart -- --list` + `test:baseline`, never `git checkout`.
