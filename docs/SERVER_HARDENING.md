# Server Hardening & Cost Protection

Status: implemented in `workers/bamboozle-rooms/`; `server/` keeps the original reference implementation until production cutover.

## Overview

The goal is light-touch guardrails: cost and abuse scale with deliberate hosting,
not with normal play. The Worker also runs on the Cloudflare free plan, so every
design choice below protects the daily request/CPU/storage budgets.

## 1. Room lifecycle

| Scenario | Behaviour |
|---|---|
| Host disconnects | `hostDisconnected`; 60s `host_grace` alarm → `roomClosed` |
| Host reconnects | `joinRoom` with the same host id inside grace → `becameHost:true`, `hostReconnected` |
| All sockets leave | 60s `empty_room` alarm → room destroyed |
| Player disconnects | `playerDisconnected`; 60s `player_kick` alarm → `playerKicked` |
| Player reconnects | `joinRoom` clears the kick deadline |
| Stale index row | `checkRoom`/`joinRoom` verifies the room DO and deletes the row |
| Room older than 6h | 6h Directory alarm (also swept on `createRoom`) |

All timers are **Durable Object alarms** persisted in SQLite. No `setTimeout`/
`setInterval` in the Worker: they block hibernation and bill duration.

## 2. Concurrent room caps

`MAX_CONCURRENT_ROOMS_PER_HOST = 2`.

- 1st/2nd room: created normally.
- 3rd room: oldest room enters host grace (it can be reclaimed or closes after 60s).
- 4th room: oldest room is closed first, then the active cap is re-applied.

This allows unlimited sequential games while preventing one host from holding many
open rooms. A legitimate player never notices it.

## 3. Event rate limits

`MAX_EVENTS_PER_WINDOW = 20`, `EVENT_RATE_WINDOW = 10_000`, per socket.

Applies to `createRoom`, `joinRoom`, `checkRoom`, `getRoomsByHost`, `requestState`,
`gameStateUpdate`, `hostEvent`, `requestNarrator` and `playerEvent`. The counter
lives in the WebSocket attachment, so it survives hibernation. Acked requests
receive `{ok:false,error:"RATE_LIMITED"}`; fire-and-forget events are silently
dropped.

`checkRoom`/`getRoomsByHost`/`requestState`/`joinRoom` also have a best-effort
per-IP budget of 60 per 10s (held in the Directory isolate) so one address cannot
spray many sockets. Normal play (one action every few seconds) never reaches the
limit.

`getRoomsByHost` requires a host secret matching the indexed rows for that host
id. Without it (or with a wrong one) the Directory returns `[]`, so host ids
cannot be enumerated and other hosts' room codes/player names are not disclosed.

The per-IP `createRoom` budget is stored in Directory SQLite, so an isolate
eviction or restart cannot reset it. A sweep alarm reaps rooms whose `last_seen`
is older than 6h even if a socket still lingers, and drains rows that predate the
host-secret design. `last_seen` moves at most once a minute per room on a
successful join/relay.

Both TTS paths consume a durable per-IP and global request budget before doing
work, so cache hits cannot be spammed for free. `POST /api/tts` also reads its
body through a hard 16 KiB byte cap instead of trusting `Content-Length`.
Rejected `gameStateUpdate`s produce a `roomError` event to the host.

## 4. Abuse and availability caps

| Cap | Default | Where |
|---|---|---|
| WebSockets per IP / total | 32 / 1000 | Directory WebSocket upgrade |
| WebSocket upgrades per IP | 30 per minute | Directory upgrade budget |
| `createRoom` per IP | 10 per hour, durable | Directory (`MAX_CREATES_PER_HOUR`) |
| Rooms per socket | 1 | Directory (second create → `ALREADY_IN_ROOM`) |
| Rooms total | 500 | Directory |
| Players per room | 6 (+ host) | `BambooRoom.join` / `playerEvent` |
| Audience per room | 20 | `BambooRoom.join` / `playerEvent` |
| Broadcast state | 128 KiB | `BambooRoom.stateUpdate` |
| Broadcast frame | 256 KiB | Directory |
| TTS requests per IP / global | 500 / 5000 per day, durable | Directory (`TTS_IP_DAILY_REQUESTS`, `TTS_DAILY_REQUESTS`) |
| Ops `/api/tts` body | 16 KiB, streamed byte cap | Worker |
| Stale-room sweep | every 6h; reaps rooms idle 6h and legacy rows | Directory DO alarm |

All limits are env-overridable (`MAX_SOCKETS_PER_IP`, `MAX_SOCKETS_TOTAL`,
`MAX_TOTAL_ROOMS`, `MAX_CREATES_PER_HOUR`, `MAX_PLAYERS_PER_ROOM`,
`MAX_AUDIENCE_PER_ROOM`, `MAX_STATE_BYTES`, `TTS_DAILY_CHARS`,
`TTS_IP_DAILY_CHARS`, `TTS_DAILY_REQUESTS`, `TTS_IP_DAILY_REQUESTS`).
Cloudflare rate-limit rules / Turnstile are an additional
edge layer; configure them in the dashboard for `/ws` and `/api/tts` (for
example 30 requests/minute per IP) so abusive traffic never reaches the DO.

## 5. Input validation & sanitisation

| Input | Rule |
|---|---|
| Player name | max 12, strip HTML tags, trim |
| Lies / answers | max 100, strip HTML tags, trim |
| Room code | exactly 4 A–Z after uppercasing/trimming |
| Host/player id | max 50 |
| TTS text | max 500 |
| WebSocket frame | max 256 KiB; larger → `FRAME_TOO_LARGE` |
| Unknown event | ignored/logged; never throws |

`sanitize()` is the same `replace(/<[^>]*>?/gm,'').substring(0,len).trim()` as the
old server. Unknown fields pass through, but the interactive text fields are clamped.

## 6. Host authority checks

Only the current host socket can send `gameStateUpdate`, `hostEvent` or
`requestNarrator`. The room DO compares the socket id to `hostSocketId`; a demoted
host socket (3rd-room grace) is rejected until it reclaims.

`hostSocketId` is bound only after the socket proves it knows the server-issued
host secret: a SHA-256 hash is stored in room meta and the raw secret is returned
once to the creating socket. `joinRoom` reclaim compares hashes with a
constant-time comparison. `hostId` is public-ish and is never accepted alone;
`createRoom` also requires the secret before it may grace or close another room
for that host.

`playerEvent` is a separate, unprivileged channel: only the player-action
allowlist is relayed, sender ids are stamped from the socket attachment, and
host-only types are rejected in both the room DO and the host reducer. Category
selection is allowed only when the stamped sender is the current selector.

Player identity is not taken from the client id alone. The first join mints a
per-player 128-bit resume secret (hash stored in the player row), returned once
and required on every later join of that id. The row also stores the owning
`socket_id`; `playerEvent` and `disconnect` are accepted only from that socket,
so a second socket cannot impersonate the player or kick them. A successful
reconnect closes the replaced socket via Directory `/internal/close-socket`.

## 7. TTS cost protection

- GCS cache is checked first; a hit costs one metadata request and no TTS billing.
- The cache key is **MD5** `md5(text + "-" + language).mp3` — never change it.
- Text is capped at 500 characters.
- Google access tokens are cached in KV (`expirationTtl: 3300`) plus isolate memory,
  so token exchanges are ~24/day, not per request.
- TTS is generated only by the host-authenticated `requestNarrator` path and the
  ops API. Hosting itself is not entitlement-gated in phase 1 (`AUTH_MODE=none`),
  so the character budget is the code-level backstop.
- `POST /api/tts` is **disabled by default** (404). It only exists when the
  `TTS_API_TOKEN` secret is set; requests must send
  `Authorization: Bearer <token>` (401 otherwise). This is an ops fallback, not a
  host entitlement path.
- On a cache miss, both paths consume a character budget from the Directory:
  50,000 characters/day globally and 5,000/IP/day by default. Cache hits consume
  nothing. Exceeding either returns `429 TTS_BUDGET_EXCEEDED` (the room path
  falls back to the client's local voice).
- Set the GCP guardrails out-of-band:
  - A hard Cloud Text-to-Speech quota (characters/minute) on the project.
  - A Cloud Billing budget with alert thresholds (50/80/100%) and a Pub/Sub or
    email notification to the owner.
  - A GCS lifecycle/retention rule if narration audio should be deleted.
  The Worker cannot create these; record the project/budget ids in
  `docs/DEPLOYMENT.md` when set.

## 8. Free-plan guardrails

- Workers Free: 100k requests/day, 10 ms CPU/invocation.
- DO Free (SQLite): 100k requests/day, 13k GB-s/day, 5 GB storage.
- KV Free: 100k reads/day, 1k writes/day (token cache only).
- State writes are throttled to at most one every 5s, plus phase changes and one
  host-grace flush.
- Socket relay uses hibernation; no polling.
- If a launch/streamer night exceeds the daily caps, upgrade to Workers Paid ($5/mo);
  the code needs no changes.

## 9. Logging

Structured console logs (visible in `wrangler tail`):

- `[Room] close <CODE> reason=<reason> lifetime=<s>`
- `[TTS] CACHE HIT room=<CODE> file=<hash>.mp3`
- `[TTS] GENERATE room=<CODE> file=<hash>.mp3`
- `[Directory] room RPC failed …`, `[Room] narrator failed …`

No purchase/identity logging exists in phase 1 because there is no auth or payment
code. The `authorizeHost()` seam is `AUTH_MODE=none`.

## 10. Cost projection

| Component | Cost |
|---|---|
| Realtime Workers/DO (phase 1 volume) | £0 on the free plan |
| Google TTS first play of a phrase | ~$0.01–0.05 |
| GCS cache hit | ~$0 (Google CDN; egress is the variable) |
| GCS storage (85.5 MiB) | covered by the free tier |

Cost scales with **new phrases**, not concurrent players. Room cleanup prevents
zombie rooms from accumulating idle cost.
