# Bamboozle Networking

Status: phase 1 — native WebSocket transport for the Cloudflare Worker. Event names and payloads are unchanged from the Socket.IO contract; only the transport and acks changed.

## Transport

`wss://<worker>/ws` — no room code in the URL. The first message binds the socket to a room.

```ts
// client → server
{ id?: string, event: string, data?: unknown }

// server → client (push)
{ event: string, data?: unknown }

// server → client (ack, only when the request had an id)
{ id: string, ok: true, data?: unknown }
{ id: string, ok: false, error: string }
```

- Ack timeout in the client: **10s**.
- Max frame: **256 KiB**; larger frames are rejected (`FRAME_TOO_LARGE`).
- Unknown/malformed events are logged and ignored; a handler never throws out of the socket.
- Acks are the Socket.IO callback replacement. `RealtimeClient.emit(event, data, cb)` still works, so `gameService.ts` kept its call sites.

## Events

### Client → server

| Event | Payload | Ack | Behaviour |
|---|---|---|---|
| `checkRoom` | `{ roomCode }` | yes | Directory lookup; `{ exists }` |
| `getRoomsByHost` | `{ hostId }` | yes | Directory rows + fresh room info (`roomCode`, `phase`, `playerCount`, `playerNames`, `isGracePeriod`, `createdAt`) |
| `createRoom` | `{ hostId, hostSecret?, token? }` | yes | Returns `{ roomCode, hostSecret }`; a server-issued 128-bit secret is returned once and required for later rooms under the same host id |
| `joinRoom` | `{ roomCode, id, role?, name?, hostSecret? }` | yes | `{ success, state, becameHost }`; host reclaim inside grace requires `hostSecret` |
| `requestState` | `{ roomCode }` | yes | Latest persisted `GameState \| null`; only for the room the socket joined |
| `gameStateUpdate` | `{ roomCode, gameState }` | no | Host-only; strips `hostId`, persists (≤ every 5s) and broadcasts to everyone else |
| `hostEvent` | `{ roomCode, event }` | no | Host-only relay (narration, host UI actions) |
| `playerEvent` | `{ roomCode, event }` | no | Allowlisted player actions only; the sender id is stamped from the socket, ignoring `payload.playerId` |
| `requestNarrator` | `{ roomCode, text, language, requestId }` | no | Host-only; TTS then `playAudio` |

### Server → client

| Event | Payload | When |
|---|---|---|
| `gameStateUpdate` | `GameState` | Host broadcast |
| `hostEvent` | `GameEvent` | Host relay (`PLAY_NARRATION`, …) |
| `playerEvent` | `GameEvent` | Player/audience action relay |
| `playAudio` | `{ audioUrl, text, requestId, isHit, hash }` | Host only offline; whole room when `isOnlineMode` |
| `roomClosed` | — | Host grace expired, empty room, or hard cap |
| `hostDisconnected` | — | Host socket closed or 3rd-room grace |
| `hostReconnected` | — | Host reclaimed inside grace |
| `playerDisconnected` | `{ playerId }` | Player socket closed; 60s kick starts |
| `playerKicked` | `{ playerId }` | Kick deadline fired |

## State and membership

- The **host client is authoritative**. The room DO stores the latest `GameState` and relays it; it does not compute game rules.
- `hostId` is **never** included in room state (join, broadcast or `requestState`). It is not an auth credential.
- The host credential is a server-generated 128-bit secret, returned once by `createRoom` and stored on the host device. Only its SHA-256 hash is kept in room meta. `joinRoom` must present it to reclaim host inside grace; knowing `hostId` is not enough.
- `createRoom` requires the same secret before it may create another room for an existing host id, or grace/close any of that host's rooms.
- Persistence is throttled: a write happens on phase change, when 5s have elapsed, and immediately when host grace starts (so a reconnect never receives a minimal/stale state).
- Roster/room metadata is read from the room DO. `playerNames` comes from the last persisted state; it can lag up to 5s.
- `Directory` is a best-effort index: `checkRoom`/`joinRoom` verify against the room DO and delete stale rows.
- One socket belongs to one room at a time.

## Player event authorization

`playerEvent` may only carry `JOIN_ROOM`, `JOIN_AUDIENCE`, `TOGGLE_READY`, `SUBMIT_LIE`,
`SUBMIT_VOTE`, `SUBMIT_AUDIENCE_VOTE`, `SELECT_CATEGORY` (when the sender is the
current selector) or `SEND_EMOTE`. Everything else is dropped.
The room DO overwrites `payload.playerId`/`payload.id` with the socket attachment's
player id, so a player cannot act as another player. Audience sockets cannot submit
lies/votes or toggle ready. Player ids must match `^[A-Za-z0-9_-]{1,50}$` and
reserved keys (`__proto__`, `constructor`, `prototype`) are rejected.

## Limits

- 20 events per 10s per socket for `createRoom`, `joinRoom`, `checkRoom`,
  `getRoomsByHost`, `requestState`, `gameStateUpdate`, `hostEvent`,
  `requestNarrator`, `playerEvent`. Excess acked events return `RATE_LIMITED`;
  fire-and-forget events are dropped.
- Read events also get a per-IP budget of 60 per 10s (best-effort, held in the
  Directory instance).
- 32 WebSockets per IP and 1,000 total; 30 upgrade attempts/minute/IP; 10
  `createRoom` calls per IP per hour; 500 rooms total; one room per socket
  (`ALREADY_IN_ROOM`). Over-cap joins/creates return `ROOM_FULL`/`RATE_LIMITED`.
- 6 players (+ host) and 20 audience members per room; a full room returns
  `ROOM_FULL`.
- A persisted game state above 128 KiB is rejected with `STATE_TOO_LARGE`; an
  outgoing broadcast above 256 KiB is dropped.
- 2 concurrent rooms per host. The 3rd moves the oldest to grace; the 4th closes
  the oldest. Both require the host secret.
- Stale rooms are swept by a 6h Directory alarm as well as on `createRoom`.
- Host grace, player kick and empty-room grace are 60s each (8s in the e2e harness).

## Connection lifecycle

1. Connect `wss://<worker>/ws`; the Directory gateway accepts and assigns a socket id.
2. Host sends `createRoom` (or `getRoomsByHost` then `joinRoom`); players send `joinRoom`.
3. `joinRoom` acks with the current state; clients render it.
4. On transport loss the adapter retries with exponential backoff (0.5s → 8s, jitter, unlimited) and emits `connect`/`disconnect`.
5. On reconnect, `gameService` re-sends `joinRoom`; the host presents the stored host secret, reclaims inside grace, players cancel their kick, and both receive the latest state.
6. After a full reload, `PlayerView` offers **JOIN LAST GAME** from `bamboozle_room_code` immediately; a failed join clears the stale code.
6. On close, the Directory informs the room DO. Host close → `hostDisconnected` + 60s grace; player close → `playerDisconnected` + 60s kick; last socket out → empty-room grace.

## Client adapter

`services/realtimeClient.ts` converts `VITE_SERVER_URL` (`https://…`) to `wss://…/ws`, queues up to 50 frames while connecting, rejects pending acks with `DISCONNECTED`, and keeps the `on/emit/emitAck` surface used by `gameService`.
