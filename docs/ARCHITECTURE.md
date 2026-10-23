# Bamboozle Architecture Overview

Status: reference — phase 1 realtime is the Cloudflare Worker `bamboozle-rooms`; `server/` stays as rollback until production cutover.

## Introduction
Bamboozle is a real-time multiplayer party game inspired by Jackbox Games. Players submit funny "lies" to fill in the blanks of trivia questions, then vote on the most believable ones.

## Core Architecture

### Tech Stack
- **Frontend**: React (Vite) + TypeScript + Tailwind CSS
- **Networking**: native WebSocket (`services/realtimeClient.ts`)
- **Realtime backend**: Cloudflare Worker `bamboozle-rooms` + Durable Objects (SQLite, free plan)
- **Audio**: Web Audio API + Google Cloud Text-to-Speech, cached in GCS
- **Animation / 3D**: Framer Motion + React Three Fiber avatars
- **Native wrapper**: Capacitor (Android)
- **Hosting**: Netlify (frontend), Cloudflare (realtime), Google Cloud Storage (audio)
- **Rollback**: previous Worker deployment (`npx wrangler rollback`); legacy Express/Socket.IO code remains in `server/`

## Target Topology

```
Netlify / Capacitor ── wss ──► Worker bamboozle-rooms
                                  ├── Directory DO  (sockets, room index, caps, rate limit)
                                  ├── BambooRoom DO (one per room: state, players, alarms)
                                  └── /api/tts ──► Google TTS ──► gs://bamboozle-audio-assets
```

- **Directory** is the single socket gateway because the Worker must choose a DO before the first `joinRoom` frame. It tags sockets with their room and relays to the room DO.
- **BambooRoom** is authoritative for room state, membership, 60s grace/kick deadlines and TTS requests. It calls back through Directory to broadcast.
- Socket state survives hibernation in WebSocket attachments + SQLite, never in `setTimeout`/`setInterval`.

## Distribution Model

1. **Web (free)**: Netlify. Players join by 4-letter code without an account.
2. **Android app**: Capacitor; bundles `dist/`, supports live reload in development.
3. **One paying host** later unlocks hosting; players always join free (phase 2, not built).

## Data Flow
1. The **host client** runs the game logic and is the authoritative `GameState`.
2. Players/audience send `playerEvent`; the host consumes it and broadcasts `gameStateUpdate`.
3. The room DO stores the latest state (at most every 5s, plus phase changes and host-grace flushes) so reconnects resume correctly.
4. `requestNarrator` is handled by the room DO: GCS cache check → Google TTS on miss → `playAudio` to the room (online mode) or the host only.

## Key Systems

### 1. Game State Management (`services/gameService.ts`)
`useGameService` owns the `GameState`, phase transitions, player input, narration and reconnection. It talks to the realtime adapter with the same event names as the old Socket.IO client.

### 2. Networking (`workers/bamboozle-rooms/` + `services/realtimeClient.ts`)
- Rooms use 4-letter A–Z codes.
- One JSON envelope per frame; event names/payloads are in `docs/NETWORKING.md`.
- `Directory` enforces the 2-concurrent-room cap, 20 events/10s limit and room lookup.
- `BambooRoom` owns relay state, host/player grace and alarms.
- Details and the operational rules live in `docs/SERVER_HARDENING.md`.

### 3. Audio System (`services/audioService.ts`, `workers/bamboozle-rooms/src/tts.ts`)
- **SFX**: preloaded Web Audio effects.
- **Local TTS**: browser `speechSynthesis` fallback.
- **Premium**: Google Cloud TTS (Neural2/Wavenet), cached permanently in GCS. The cache key is **fixed**: `md5(text + "-" + language).mp3`.
- **Safari/iOS**: one shared `Audio` element unlocked on the first join/ready gesture and reused for all narration.

### 4. Admin Dashboard (`views/AdminView.tsx`)
Legacy, local-development only. It still targets the Express `/api/admin/*` routes and is **not part of the Worker**; batch generation and cache clearing remain on the old server path.

### 5. UI/UX Design
- Mobile-first player views, TV-oriented host view.
- Framer Motion transitions; avatars generated from a seed.
- Emote bursts and reveal choreography are client-side and must not be used as sync evidence — the authoritative state is the host's broadcast.

### 6. Design Lab (`designer/`)
Dev-only `/designer` shell + `/designer/preview` iframe. It mounts the real
`OnlinePlayerView`, `HostView`, `PlayerView`, and app-shell components with
deterministic fixtures, so it is 1:1 with production components and breakpoints.
It provides screen/role/phase controls, content stress, viewport presets, an
overflow/clipped-text scan, hover inspector, PNG export, URL state, and a
`window.__bamboozleDesigner` bridge. See `docs/DESIGN_LAB.md`.

## Repository Structure
- `services/` — game state, audio, realtime adapter.
- `views/`, `components/` — host/player UI.
- `workers/bamboozle-rooms/` — Worker, DOs, TTS, worker tests, smoke script.
- `server/` — legacy Express/Socket.IO implementation, kept for local fallback only.
- `docs/` — architecture, networking, hardening, deployment, testing.
