# Bamboozle Technical Documentation

Status: reference — audio/TTS pipeline.

## Audio & Narration System

The narration system is designed to provide a premium, synchronized experience across all devices.

### Components
1. **`gameService.ts`**: The heart of the audio logic.
   - `speak()`: Entry point for narration requests.
   - `playNextPremium()`: Processes the audio queue.
   - `internalSpeak()`: Wrapper for local `speechSynthesis`.
   - `unlockAudio()`: One-shot utility for mobile Safari compatibility. Guarded by `audioUnlockedRef` so it only runs once per session — calling it repeatedly (e.g. on every button click) used to interrupt the narrator by pausing the shared audio element mid-playback.

2. **`ProgressionManager.ts`**: Manages the timing of game phases.
   - Relies on the `onAudioEnded` callback to advance steps in the `REVEAL` phase.
   - Implements safety timers to prevent "hanging" if audio fails to play.

3. **`audioService.ts`**: Handles sound effects (SFX) using the Web Audio API.

### Web Audio Safari Support
Safari requires an explicit user gesture to enable audio. Bamboozle solves this by:
- Using a `shared narrator element` (`narratorAudioRef`).
- Calling `unlockAudio()` once on the first major user gesture (player Join/Ready, host Start, add-bot). It is intentionally **not** called on recurring gestures (e.g. sending emotes) to avoid interrupting active narration.
- The player join and ready buttons call it explicitly; earlier builds only unlocked for hosts, which left phone players blocked on Safari.
- Manually resuming the `AudioContext` and `speechSynthesis` state.

### Server-Side Integration
When `usePremiumVoices` is enabled:
1. Host emits `requestNarrator`.
2. The `BambooRoom` Durable Object checks GCS, generates on a miss and replies `playAudio` with a URL (whole room in online mode, host only otherwise).
3. All clients add the URL to `premiumAudioQueueRef` and play it through the shared narrator element.

### Server-Side TTS Architecture
- **Provider**: Google Cloud Text-to-Speech (Neural2/Wavenet voices).
- **Runtime**: `workers/bamboozle-rooms/src/tts.ts` (WebCrypto RS256 service-account JWT; KV token cache).
- **Storage & Caching**:
  - Audio is hashed with **MD5** (`md5(text + "-" + language).mp3`). WebCrypto has no MD5, so a small pure-JS implementation is used. **Never change this key** — 3,159 existing GCS objects depend on it.
  - Files live in **Google Cloud Storage** (`bamboozle-audio-assets`); public URLs are unchanged.
  - The Worker checks `GET /storage/v1/b/{bucket}/o/{name}` before generating; upload uses `uploadType=media` and then patches `cacheControl` to one year.
- **Admin Dashboard**: legacy `/admin` UI still talks to the Express `/api/admin/*` routes; it is not ported to the Worker.
- **Cleanup**: per-room audio is never deleted; the global GCS cache is reused across rooms. The `/api/tts` route remains a manual generation fallback.

## Troubleshooting

### Narrator Hangs
If the reveal sequence stops advancing:
1. Check the browser console for `[Audio] Failsafe: advancing queue`. This indicates the audio failed to load or play within 8 seconds.
2. Verify that `onAudioEnded()` is being called in both the successful and failed paths of `playNextPremium`.

### Narrator interrupted by player actions
- `unlockAudio()` checks `audioUnlockedRef.current` and is a no-op after the first call.
- It also checks `audio.paused && !isPlayingPremiumRef.current` before touching the shared element.
- **Do not** add `unlockAudio()` to recurring gesture handlers (emotes, votes, etc).

### No Sound on Mobile Safari
1. Ensure `actions.unlockAudio()` is called on a user gesture (like clicking "Join").
2. Verify that `narratorAudioRef.current` is being reused instead of creating new `new Audio()` objects.

## Emote / Reaction System

Floating emoji reactions appear when players send emotes during a game.

### Architecture
- **`EmotePopupLayer`** (`GameSharedComponents.tsx`): Renders floating emotes using a self-managed local queue.
  - Emotes are added to local state when they arrive from props and auto-removed after the animation completes (`ANIM_DURATION + 200ms`), regardless of when the server removes them. This prevents mid-flight interruptions.
  - Uses a pure CSS `@keyframes emote-burst` animation (GPU-composited via `transform` + `opacity`), so it never competes with React state updates.
- **Origin positioning**: Each emote stores `x` (% of viewport width) and `y` (% from viewport bottom), measured from the sender's avatar element at the moment of sending (`getBoundingClientRect`). The emote visually bursts out of the sender's avatar and floats upward.
- **`data-player-id`** attribute on each avatar in `AvatarStrip` enables fast DOM lookup for position measurement.

### Emote Event Flow
1. Player taps reaction → `handleEmote` measures avatar position → emits `SEND_EMOTE` with `x`/`y`.
2. Host's `processHostEvent` stores `x`/`y` in the `Emote` object (falling back to random if not provided, e.g. bot emotes).
3. State is broadcast → all clients receive the emote with origin coordinates.
4. `EmotePopupLayer` on each client adds it to local queue and plays the burst animation from the correct position.

## Bot System

### Bot Brain Guard
The bot brain `useEffect` is gated on `isHostRef.current` (a ref, not state). This ensures:
- Only the active host drives bot decisions.
- The guard remains correct after a host reconnects/reclaims their session, since `isHostRef.current` is set to `true` reliably on reclaim even before the state sync completes.
- **Avoid** using `state.hostId !== playerId` as a guard — `hostId` in state can be stale after reconnection.

### Host Reconnection / Reclaim
When a host disconnects and rejoins:
1. The server returns `becameHost: true` in the `joinRoom` response.
2. `isHostRef.current` is set to `true`.
3. `state.hostId` is updated to the reclaiming client's `playerId`.
4. `state.vipId` is updated similarly.
5. The full state is broadcast to re-sync all players.
6. `resumeGameProgression()` restarts any mid-phase game logic.

## Online Friends Mode
This mode merges the "Big Screen" visuals with the "Controller" inputs.
- Defined in `plan.md`.
- Implemented via `OnlinePlayerView.tsx`.
- Uses `RevealSequence` and `LeaderboardSequence` components from `GameSharedComponents.tsx`.

### Readiness Indicators
Player readiness (submitted lie / voted) is communicated solely via avatar expression changes — no separate UI indicator (e.g. green dot) is shown in the avatar strip.
