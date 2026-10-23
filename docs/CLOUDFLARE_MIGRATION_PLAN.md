# Bamboozle — Phase 1: Railway → Cloudflare (Free) Migration Plan

**Status:** planned, not started
**Goal:** run Bamboozle's realtime backend on Cloudflare Workers + Durable Objects on the **free plan**, with no Railway dependency. Payments/accounts are **out of scope** for phase 1 but the entitlement seam must be built in.

**Hard rule:** this is a **separate** Cloudflare Worker from Lemon Schedule. Do not reuse `lemon-rooms`, its Durable Object namespace, its secrets, or any Lemon code. Copy patterns only. Separate Supabase project later, too.

---

## 1. Why this shape

- The server is a ~450-line relay: the **host client owns game state**, the server stores the latest `GameState`, relays events to the room, enforces room caps/rate limits, and runs 60s reconnect timers. That is a Durable Object with WebSockets.
- Socket.IO cannot run natively on Workers. The community shim (`socket.io-serverless`) **does not support acknowledgements**, which Bamboozle uses on `checkRoom`, `createRoom`, `joinRoom`, `getRoomsByHost`, `requestState`. So phase 1 replaces Socket.IO with a small native-WS protocol and a client adapter that keeps the existing event names.
- Google Cloud stays for **voice only**: TTS generation + the existing GCS audio cache. It is not the room layer.
- No database is needed in phase 1. Room state is ephemeral; a tiny `Directory` DO answers room-code/host lookups.

## 2. Target architecture

```
Netlify (static React) / Capacitor Android
        │  wss
        ▼
Cloudflare Worker  "bamboozle-rooms"        ← NEW, separate from lemon-rooms
  ├── GET  /health
  ├── GET  /api/version
  ├── POST /api/tts                         ← Google TTS → GCS (existing bucket)
  └── GET  /ws                              ← upgrades to the room DO
          │
          ├── BambooRoom DO   (one per room)  state, players, relay, alarms
          └── Directory DO    (one object)    room codes, host → rooms index
```

No Redis. No Express. No Railway. No Supabase in phase 1.

## 3. Repository layout (new files only)

```
workers/bamboozle-rooms/
  wrangler.toml
  package.json
  tsconfig.json
  src/index.ts          Worker router + CORS + /api/tts
  src/room.ts           BambooRoom DO
  src/directory.ts      Directory DO
  src/tts.ts            Google TTS + GCS REST client
  src/protocol.ts       message types + validation
  src/auth.ts           authorizeHost() seam (AUTH_MODE=none in phase 1)
  test/protocol.test.ts
  test/room.test.ts
services/realtimeClient.ts   NEW client adapter
services/gameService.ts      swap socket.io-client for the adapter
```

Keep `server/` untouched until parity is proven. Do **not** delete Railway code in this phase.

> **`.gitignore` gotcha:** the repo ignores `*.json`. New `package.json`, `package-lock.json` and `tsconfig.json` under `workers/bamboozle-rooms/` need explicit `!` exceptions (or `git add -f`). Fix the ignore rules in the same commit as the new folder.

## 4. Wire protocol

One JSON envelope, event names unchanged from `docs/NETWORKING.md`:

```ts
// client → server
{ id?: string, event: string, data?: unknown }

// server → client (push)
{ event: string, data?: unknown }

// server → client (ack; only when the request had an id)
{ id: string, ok: true, data?: unknown }
{ id: string, ok: false, error: string }
```

- `id` is a client-generated string; the adapter keeps a `Map<id, {resolve, reject, timer}>`.
- Ack timeout: 10s.
- Unknown/ malformed events are ignored and logged; never throw out of the socket handler.
- Max frame size: 256 KB; reject larger with `error: "FRAME_TOO_LARGE"`.

### Event mapping (must match `docs/NETWORKING.md`)

| Event | Direction | Ack? | Notes |
|---|---|---|---|
| `checkRoom` | C→S | yes | Directory lookup |
| `getRoomsByHost` | C→S | yes | Directory lookup |
| `createRoom` | C→S | yes | `{ hostId, hostSecret?, token? }` → `{ roomCode, hostSecret }`; `token` ignored in phase 1 |
| `joinRoom` | C→S | yes | returns `{success, state, becameHost}`; `hostSecret` required to reclaim |
| `requestState` | C→S | yes | returns `GameState \| null`; membership required |
| `gameStateUpdate` | C→S | no | host → room broadcast (exclude sender); `hostId` stripped |
| `hostEvent` | C→S | no | relay to room |
| `playerEvent` | C→S | no | allowlisted player actions; sender id stamped from the socket |
| `requestNarrator` | C→S | no | TTS; reply `playAudio` |
| `roomClosed` | S→C | — | broadcast |
| `hostDisconnected` / `hostReconnected` | S→C | — | broadcast |
| `playerDisconnected` / `playerKicked` | S→C | — | broadcast |
| `playAudio` | S→C | — | `{audioUrl, text, requestId, isHit, hash}` |

Connection: `wss://<worker>/ws`. No room in the URL; the first message is `checkRoom`/`createRoom`/`joinRoom`.

## 5. Durable Object: `BambooRoom`

### Storage (SQLite backend; free plan only supports SQLite)

```sql
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
); -- roomCode, hostId, hostSocketId(nullable), pendingHostReconnect, createdAt, phase

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,          -- PLAYER | AUDIENCE
  connected INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL
);                             -- latest GameState

CREATE TABLE IF NOT EXISTS deadlines (
  kind TEXT NOT NULL,          -- host_grace | player_kick | empty_room
  key TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (kind, key)
);
```

- Persist `state` **at most every 5 seconds**, plus immediately on phase changes. Reconnect only needs the latest state; this keeps SQLite writes far under the 100k/day free limit.
- Socket identity lives in **WebSocket attachments**, not memory:
  `ws.serializeAttachment({ playerId, role, roomCode })`.
- Use the **Hibernation API**: `ctx.acceptWebSocket(ws)` + `webSocketMessage` / `webSocketClose`. Never `setInterval`/`setTimeout` (they prevent hibernation and bill duration).

### Timers → alarms

- Deadlines go in `deadlines`; call `setAlarm(min(at))`.
- On `alarm()`: process every deadline with `at <= now`, emit the corresponding event, then reschedule the next earliest (or delete the alarm).
- Kinds: `host_grace` (60s → close room), `player_kick` (60s → `playerKicked`), `empty_room` (60s → close).
- The room-cap grace (`LIMIT_GRACE_EXPIRED`) uses the same `host_grace` deadline with a reason stored in `meta`.

### Ported rules (from `server/index.js`)

- `MAX_CONCURRENT_ROOMS_PER_HOST = 2` (3rd moves oldest to grace, 4th closes oldest)
- `MAX_EVENTS_PER_WINDOW = 20`, `EVENT_RATE_WINDOW = 10_000`
- `MAX_NAME_LENGTH = 12`, `MAX_ANSWER_LENGTH = 100`, TTS text cap 500
- `sanitize()` = strip HTML tags + trim + truncate (same regex)
- Room code: 4 × A–Z; allocate through the Directory DO with retry on collision

## 6. Durable Object: `Directory`

One global object (name `"directory"`) so room-code allocation is serialized.

```sql
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  host_secret_hash TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  phase TEXT NOT NULL DEFAULT 'LOBBY',
  player_count INTEGER NOT NULL DEFAULT 0,
  pending_host_reconnect INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS rooms_by_host ON rooms(host_id);
CREATE INDEX IF NOT EXISTS rooms_by_created ON rooms(created_at);
```

- `checkRoom` → `SELECT 1 FROM rooms WHERE code = ?`
- `getRoomsByHost` → rows for host, mapped to the current response shape
- `createRoom` → generate code, insert, enforce the host secret and the 2/3-room caps,
  return `{ roomCode, hostSecret }`
- `joinRoom` / `gameStateUpdate` / close → best-effort `phase`/`player_count` update
- Sweep stale rooms older than 6h on create (free, avoids a cron)

## 7. TTS service (Google Cloud, unchanged bucket)

- Secrets: `GOOGLE_APPLICATION_CREDENTIALS_JSON` (full service-account JSON, ~2 KB, under the 5 KB env limit) and `GCS_BUCKET_NAME` (`bamboozle-audio-assets`).
- Sign a service-account JWT (RS256) with **WebCrypto**:
  - claims: `iss`, `scope = https://www.googleapis.com/auth/cloud-platform`,
    `aud = https://oauth2.googleapis.com/token`, `iat`, `exp = iat + 3600`
  - exchange at `https://oauth2.googleapis.com/token`
  - cache the access token in **KV** with `expirationTtl: 3300` (≈24 writes/day — free)
- `POST https://texttospeech.googleapis.com/v1/text:synthesize` with the same voice config:
  - `en` → `en-US-Neural2-F`, `el` → `el-GR-Wavenet-A`, `MP3`, pitch 0, rate 1.1
- GCS (keep URLs identical to today):
  - exists: `GET /storage/v1/b/{bucket}/o/{encodeURIComponent(name)}`
  - upload: `POST /upload/storage/v1/b/{bucket}/o?uploadType=media&name={name}`
  - public URL: `https://storage.googleapis.com/{bucket}/{name}`
- **Cache-key compatibility is mandatory:** existing objects are named
  `md5(`${text}-${language}`).mp3`. WebCrypto has no MD5, so use a small pure-JS
  MD5 (`spark-md5` / `js-md5`). Do **not** switch to SHA-256 — it would orphan all
  3,159 cached lines and re-bill TTS.
- Optional phase 1.5: mirror the bucket to R2 (`rclone copy gcs:bamboozle-audio-assets r2:bamboozle-audio`)
  and serve from R2 (zero egress). Not required for phase 1.
- `/api/admin/*` is dev-only today; do not port it. Keep `failed_generations.json` local-only.

## 8. Client adapter

`services/realtimeClient.ts` — a drop-in replacement for the small Socket.IO surface `gameService.ts` uses:

```ts
class RealtimeClient {
  connected: boolean;
  id: string;
  connect(url: string): void;
  on(event: string, cb: (data?: unknown) => void): () => void;
  emit(event: string, data?: unknown): void;
  emitAck<T>(event: string, data?: unknown, timeoutMs?: number): Promise<T>;
  disconnect(): void;
}
```

- Converts `VITE_SERVER_URL` (`https://…`) to `wss://…/ws`; default `http://localhost:8787` in dev.
- Reconnect: exponential backoff 0.5s → 8s with jitter, unlimited retries; emits `connect` / `disconnect` so `gameService` can re-join.
- Queues `emit` calls while connecting (bounded, 50).
- Rejects pending acks on disconnect (`error: "DISCONNECTED"`).
- In `gameService.ts`, replace only the import and the `io(...)` construction; keep every event name and payload shape. The `socketRef` type becomes `RealtimeClient`.

## 9. Entitlement seam (paid layer later, no payment code now)

`src/auth.ts`:

```ts
export type HostAuth = { allowed: boolean; userId?: string; reason?: string };

export async function authorizeHost(
  request: Request,
  data: { hostId: string; token?: string },
  env: Env,
): Promise<HostAuth> {
  if ((env.AUTH_MODE ?? "none") === "none") return { allowed: true, userId: data.hostId };
  // phase 2: verify a short-lived token minted by a Supabase Edge Function
  // (HS256 with ROOM_TOKEN_SECRET, claims { sub, role: "host", exp })
  return { allowed: false, reason: "ENTITLEMENT_REQUIRED" };
}
```

- `wrangler.toml`: `AUTH_MODE = "none"` for phase 1.
- `createRoom` payload keeps an **optional** `token` field; phase 1 ignores it.
- Phase 2 (separate Supabase project/org, never Lemon's): accounts + `entitlements`
  + RevenueCat/Paddle webhooks → an Edge Function mints the token → this Worker
  verifies it. No changes to the room DO or the client protocol.
- Players never need accounts; only the host is gated.

## 10. Free-tier guardrails

- Workers Free: **100k requests/day**, **10 ms CPU/invocation**, 100 workers.
- DO Free (SQLite): **100k requests/day**, **13k GB-s/day**, 5 GB storage.
- KV Free: 100k reads/day, **1k writes/day** (token cache only).
- Rules: hibernation API, alarms only, no polling, persist state ≤ every 5s, cap TTS text.
- If a launch/streamer night exceeds the daily caps, upgrade to Workers Paid ($5/mo) — phase 1 code needs no changes.

## 11. Deployment

```toml
# workers/bamboozle-rooms/wrangler.toml
name = "bamboozle-rooms"
main = "src/index.ts"
compatibility_date = "2026-10-22"

[[durable_objects.bindings]]
name = "ROOMS"
class_name = "BambooRoom"

[[durable_objects.bindings]]
name = "DIRECTORY"
class_name = "Directory"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["BambooRoom", "Directory"]

[vars]
AUTH_MODE = "none"
GCS_BUCKET_NAME = "bamboozle-audio-assets"

[observability]
enabled = true
```

- `wrangler secret put GOOGLE_APPLICATION_CREDENTIALS_JSON` (do not commit the JSON)
- `wrangler deploy` → `https://bamboozle-rooms.<subdomain>.workers.dev`
- Netlify env: `VITE_SERVER_URL=https://bamboozle-rooms.<subdomain>.workers.dev`
- CORS: allow the Netlify site origin, `http://localhost:3000/5173`, and Capacitor
  origins (`capacitor://localhost`, `https://localhost`). No `*` in production.

## 12. Testing & acceptance

**Automated**
- `vitest` + `@cloudflare/vitest-pool-workers`: protocol validation, sanitize, room-code allocation, deadline scheduling, rate limit.
- `wrangler dev` smoke: `/health`, `/api/version`, WS echo/ack.

**Manual (two browsers + a phone)**
1. Host creates room; second window joins as PLAYER; third as AUDIENCE → `joinRoom` acks, state identical.
2. Play a full round: writing, voting, reveal, leaderboard → no desync.
3. Host closes tab → 60s grace → players see `hostDisconnected`; host rejoins → `hostReconnected`.
4. Player closes tab → 60s later `playerKicked`; rejoin within 60s cancels.
5. Host creates a 3rd room → oldest enters grace; 4th closes it.
6. >20 events in 10s → dropped.
7. TTS: a phrase already in GCS → `isHit: true`, same URL; a new phrase → generated + uploaded, URL loads.
8. iOS Safari: audio unlock still works (existing client logic).
9. No Railway process running; Netlify preview points at the Worker.

**Acceptance**
- All events in §4 work against `wrangler dev` and the deployed Worker.
- `server/` untouched; no `socket.io-client` import left in the client.
- `npm run build` passes; Cloudflare logs show no errors.
- Existing 3,159 GCS lines are reused (cache hit), not regenerated.
- Docs updated: `ARCHITECTURE.md` (remove Redis/Railway), `DEPLOYMENT.md`, `NETWORKING.md`, `SERVER_HARDENING.md`, `ENTITLEMENT_SYSTEM.md` (mark as phase-2 design), `MULTIPLAYER_PLAN.md` status, `README.md` docs index.

## 13. Rollout / rollback

1. Deploy the Worker alongside Railway; keep Railway live.
2. Point a Netlify **deploy preview** at the Worker via `VITE_SERVER_URL`; run the manual checklist.
3. Switch production env; monitor `wrangler tail` + Cloudflare analytics for 48h.
4. After a stable week, remove the Railway service and archive `server/` (do not delete history).
5. Rollback = revert `VITE_SERVER_URL` to the Railway URL (until step 4).

## 14. Voice cache — facts and migration

Measured 2026-10-22:

| Item | Value |
|---|---|
| Bucket | `gs://bamboozle-audio-assets` |
| Objects | **3,159** MP3s |
| Size | **89,674,560 bytes ≈ 85.5 MiB** |
| Railway disk | **none** — the `/audio` static route reads `/tmp/bamboozle_audio_cache`, which nothing writes |
| Local dev residue | `server/data/failed_generations.json` (108 KB, gitignored) |

- **No migration is required for phase 1.** Keep GCS and the same public URLs; the Worker only checks/creates objects.
- GCS free tier (5 GB standard) covers 85.5 MiB easily; egress is the only variable.
- If you switch to R2 later: 3,159 Class A writes + 86 MB → **$0** on the R2 free tier (1M writes, 10 GB, zero egress). `rclone copy gcs:bamboozle-audio-assets r2:bamboozle-audio` is enough; no re-generation and no code change beyond the URL base.
- **Never change the MD5 cache key** (see §7), or those 3,159 lines are orphaned.

## 15. Phase 2 (paid) — plug-in only, do not build now

- Separate Supabase project in its **own organization** (so upgrading Bamboozle to Pro never touches Lemon).
- Tables: `profiles`, `entitlements`, `purchases`; RLS on; service role only in Edge Functions.
- Android: Play Billing + RevenueCat webhook → `entitlements`.
- Web (optional): Paddle or Stripe Managed Payments webhook → same table.
- Edge Function `room-token` mints `{sub, role:"host", exp}`; Worker verifies with `ROOM_TOKEN_SECRET`.
- Client sends the token in `createRoom`; phase 1 ignores it. No room/DO/protocol rewrite.

## 16. Open questions for the implementer

1. Directory as a single DO vs D1 — start with DO; shard only if it becomes hot.
2. Keep GCS vs mirror to R2 — phase 1 keeps GCS; R2 is an optional cost optimization.
3. `VITE_SERVER_URL` for the Android build — confirm the production Worker URL is baked at build time.
4. Room-code QR/share link (`/join/CODE`) is phase 2 of the product plan, not this migration.

---

## Starting prompt for the implementing agent

> Work in `/Users/gabrielathanasiou/Documents/Software Apps/bamboozle` (the Bamboozle repo — **not** Lemon Schedule; do not touch any other project).
>
> Read first, in this order:
> 1. `docs/CLOUDFLARE_MIGRATION_PLAN.md` (this file)
> 2. `docs/NETWORKING.md` (event contract)
> 3. `docs/SERVER_HARDENING.md` (rules to port)
> 4. `docs/ARCHITECTURE.md` and `docs/TECHNICAL.md` (current system + audio)
> 5. `server/index.js`, `server/ttsService.js`, `services/gameService.ts`
>
> Implement **Phase 1 only**: replace Railway/Socket.IO with a new Cloudflare Worker `bamboozle-rooms` (Workers Free + Durable Objects, SQLite) and a native-WebSocket client adapter, keeping Google TTS + the existing GCS audio bucket.
>
> Hard constraints:
> - **Do not** modify, import, or deploy anything from the Lemon Schedule repo, and do **not** reuse `lemon-rooms`, its DO namespace, or its secrets. This is a separate worker.
> - **Do not** delete or modify `server/` — keep it as the reference/rollback until parity is verified.
> - **Do not** add Supabase, auth, payments, or accounts. Only implement the `authorizeHost()` seam with `AUTH_MODE=none`.
> - Keep every event name/payload from `docs/NETWORKING.md`; only the transport changes.
> - Preserve the **MD5** cache key (`md5(text + "-" + language)`) so the 3,159 existing GCS MP3s are reused.
> - Free plan only: hibernation WebSockets, DO alarms (no `setTimeout`/`setInterval`), state persisted ≤ every 5s.
> - The repo's `.gitignore` has a blanket `*.json`; add exceptions for the new worker's `package.json`, `package-lock.json`, `tsconfig.json`.
>
> Deliverables:
> 1. `workers/bamboozle-rooms/` per §3, `wrangler.toml` per §11, protocol + DOs + TTS per §§4–7.
> 2. `services/realtimeClient.ts` and the minimal `services/gameService.ts` swap.
> 3. Unit tests (`vitest` + `@cloudflare/vitest-pool-workers`) and a `wrangler dev` smoke script.
> 4. Deployed Worker (`wrangler deploy`) + `wrangler tail` verification, and a Netlify deploy-preview run pointing `VITE_SERVER_URL` at it.
> 5. Doc updates listed in §12.
>
> Verification is the manual checklist in §12. Do not claim done without steps 1–9 passing. Commit in small, revertible commits on a branch (`feat/cloudflare-rooms`), run `npm run build` before every commit, and ask a blocking question rather than guessing on: room-directory consistency, TTS token caching, or reconnect semantics.
>
> When finished, report: the Worker URL, the deploy-preview URL, which checklist items passed, the GCS cache-hit evidence, and any remaining risks.
