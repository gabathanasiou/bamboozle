# Bamboozle — Multiplayer Platform Plan

> **Status**: Planning complete. Implementation not yet started.
> **Last updated**: 2026-02-19

---

## The Vision

Transform Bamboozle from a local party game into a cross-platform multiplayer experience:

- **Browser** (free): Join games only. Enter a room code or scan a QR. No account needed.
- **Android App** (£1.99 one-time): Unlocks the ability to host unlimited games. Friends always join free.

One paying host per friend group funds the whole session. Browser players are entirely passive — they generate no meaningful server cost.

---

## Current State — What's Already Built

The majority of the infrastructure already exists. This is not a rebuild, it's an extension.

| System | Status | Location |
|---|---|---|
| React + Vite frontend | ✅ Done | `/` |
| Socket.IO server | ✅ Done | `server/index.js` |
| Room creation & codes | ✅ Done | `generateRoomCode()` in server |
| Host/Player architecture | ✅ Done | `services/gameService.ts` |
| Online mode (full game on player device) | ✅ Done | `isOnlineMode` in `GameState` |
| Host reconnection + grace period | ✅ Done | `server/index.js` |
| Room auto-cleanup on empty/disconnect | ✅ Done | `server/index.js` |
| Google Cloud TTS + GCS caching | ✅ Done | `server/ttsService.js` |
| Railway deployment | ✅ Done | `docs/DEPLOYMENT.md` |
| QR code / shareable URLs | ⚠️ Partial | Room codes exist; needs URL format + QR generator |
| Capacitor (Android wrapper) | ✅ Done | `capacitor.config.ts`, `android/` |
| Google Play Billing (RevenueCat) | ❌ Not started | See `docs/BILLING_INTEGRATION.md` |
| Host entitlement / JWT system | ❌ Not started | See `docs/ENTITLEMENT_SYSTEM.md` |
| Server-side host gating | ✅ Done (Phase 1) | `server/index.js` |

---

## Documentation Index

Start here, then read each doc in order as you work through a phase:

| Document | What It Covers |
|---|---|
| **This file** | Overview, current state, implementation phases, timeline |
| [`CAPACITOR_ANDROID.md`](./CAPACITOR_ANDROID.md) | Installing Capacitor, wrapping the React app for Android, Android Studio setup, Play Store listing guide |
| [`BILLING_INTEGRATION.md`](./BILLING_INTEGRATION.md) | RevenueCat setup (dashboard + Play Console), client purchase code, server JWT endpoint, dev workflow, Play Store rules |
| [`ENTITLEMENT_SYSTEM.md`](./ENTITLEMENT_SYSTEM.md) | JWT schema, token refresh strategy, free trial logic, security model |
| [`BROWSER_AND_PURCHASE_UX.md`](./BROWSER_AND_PURCHASE_UX.md) | Platform detection, browser join-only UI, "Get the app" CTA, post-game purchase prompt, entitlement state machine |
| [`SERVER_HARDENING.md`](./SERVER_HARDENING.md) | Concurrent room caps, socket rate limiting, what's already handled vs what needs adding |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | Railway deployment for server + frontend, environment variables, Google Cloud setup |
| [`NETWORKING.md`](./NETWORKING.md) | Socket.IO events reference, state sync strategy, connection lifecycle |

---

## Architecture

```
┌────────────────────────────────────────────────────┐
│                 BROWSER (Free)                      │
│  Landing page → Enter code / QR → Play             │
│  "Want to host? Get the app →" CTA on home screen  │
└─────────────────────┬──────────────────────────────┘
                      │ WebSocket (Socket.IO)
                      ▼
┌────────────────────────────────────────────────────┐
│              SERVER (Node.js / Railway)             │
│  • Room management       (existing)                 │
│  • Game state relay      (existing)                 │
│  • Google Cloud TTS      (existing)                 │
│  • JWT validation        (new)                      │
│  • Host gating           (new)                      │
└─────────────────────┬──────────────────────────────┘
                      │ WebSocket (Socket.IO)
                      ▼
┌────────────────────────────────────────────────────┐
│           ANDROID APP (£1.99 one-time)              │
│  • Same React app wrapped in Capacitor              │
│  • Google Play Billing via RevenueCat               │
│  • Full host + player UI                            │
└────────────────────────────────────────────────────┘
```

---

## User Flows

### Browser Player
1. Opens URL or scans QR → `bamboozle.app/join/ABCD`
2. Enters name → joins as player
3. Plays full game (writing, voting, reveal, leaderboard)
4. Home screen shows "Want to host? Get on Google Play →" CTA
5. **Cannot access**: room creation, host settings, game controls

### Android Host (paid)
1. Purchases app (£1.99, one-time via Google Play)
2. RevenueCat confirms entitlement → app requests JWT from server
3. Taps "Host a Game" → JWT sent with `createRoom` → server validates → room created
4. Shares QR code / link with friends
5. Friends join free (browser or app)
6. Host controls: start, settings, language, pause

### Android App — First Open (Free Trial)
1. Opens app → gets 1 free hosted game (no purchase needed)
2. After game ends → "Enjoyed hosting? Unlock unlimited for £1.99"
3. "Maybe Later" always available — never a hard block

---

## Implementation Phases

Work through these in order. Each phase is self-contained — you can ship and test each one before starting the next.

---

### Phase 1: Server Hardening
**Est: 2-3 hours | Prerequisite: None**

> ✅ **Status: Complete**

The lightest phase — small additions to the existing server.

- [x] Add concurrent room cap per host (max 2 simultaneous rooms)
- [x] Add socket event rate limiter (20 events / 10s per socket)
- [x] Add structured logging for room creation/destruction events
- [x] Add player name + answer input sanitization (strip HTML, max length)

📄 See: [`SERVER_HARDENING.md`](./SERVER_HARDENING.md)

---

### Phase 2: Shareable Links & QR Codes
**Est: 2-4 hours | Prerequisite: None**

- [ ] Define URL format: `bamboozle.app/join/{ROOM_CODE}`
- [ ] Auto-join room from URL parameter on page load
- [ ] Add QR code in lobby screen (host's view) using a lightweight library (e.g., `qrcode`)
- [ ] Browser landing page for `/join/:code` route

📄 No dedicated doc yet — straightforward enough to implement directly.

---

### Phase 3: Browser Join-Only UI
**Est: 2-3 hours | Prerequisite: Capacitor installed (Phase 4)**

- [ ] Add `utils/platform.ts` with `isNativeApp` detection
- [ ] Conditionally render "Host" button only on native app
- [ ] Add "Get the app" CTA section to browser home screen
- [ ] Add "Restore Purchases" option in Android app settings

📄 See: [`BROWSER_AND_PURCHASE_UX.md`](./BROWSER_AND_PURCHASE_UX.md)

---

### Phase 4: Capacitor Android Setup
**Est: 4-8 hours (longer if first Android project) | Prerequisite: Android Studio installed**

> ✅ **Status: Complete** - Installed and ready in Android Studio

**Environment Setup (one-time):**
- [x] Install Android Studio (download from developer.android.com)
- [x] Install Android SDK (done via Android Studio's SDK Manager)
- [x] Install Java 17+ (Android Studio bundles this, but verify)
- [x] Enable Developer Mode on an Android device for testing (or use emulator)

**Capacitor Setup:**
- [x] `npm install @capacitor/core @capacitor/cli`
- [x] `npx cap init "Bamboozle" "com.bamboozle.app"`
- [x] `npx cap add android`
- [x] Configure `capacitor.config.ts`
- [x] `npm run build && npx cap sync android`
- [x] Open in Android Studio: `npx cap open android`
- [ ] Test run on emulator or device
- [ ] Add back button handler
- [ ] Configure status bar to match dark theme

📄 See: [`CAPACITOR_ANDROID.md`](./CAPACITOR_ANDROID.md)

---

### Phase 5: RevenueCat + Google Play Billing
**Est: 8-12 hours | Prerequisite: Phase 4 complete, Google Play Developer Account ($25)**

> ⚠️ This is the most complex phase. Budget extra time and test carefully.

**RevenueCat Dashboard:**
- [ ] Create RevenueCat account
- [ ] Create project + connect Google Play (service account setup)
- [ ] Create product: `bamboozle_host_unlock`
- [ ] Create entitlement: `hosting`
- [ ] Create offering + package

**Google Play Console:**
- [ ] Create app listing in Play Console
- [ ] Create in-app product: `bamboozle_host_unlock` at £1.99
- [ ] Add yourself as a license tester

**Client Code:**
- [ ] `npm install @revenuecat/purchases-capacitor`
- [ ] Implement `services/billingService.ts`
- [ ] Implement `hooks/useEntitlement.ts`
- [ ] Wire purchase flow into home screen UI
- [ ] Wire free trial logic

**Server Code:**
- [ ] `npm install jsonwebtoken` (in `/server`)
- [ ] Add `server/entitlement.js` (JWT issue + validate helpers)
- [ ] Add `POST /api/get-host-token` endpoint
- [ ] Gate `createRoom` to require valid JWT in production
- [ ] Add `JWT_SECRET` to Railway environment variables

**Testing:**
- [ ] End-to-end test purchase with license tester account
- [ ] Test restore purchases
- [ ] Test what happens after a simulated refund

📄 See: [`BILLING_INTEGRATION.md`](./BILLING_INTEGRATION.md) | [`ENTITLEMENT_SYSTEM.md`](./ENTITLEMENT_SYSTEM.md)

---

### Phase 6: Play Store Submission
**Est: 3-5 hours + review wait (1-7 days) | Prerequisite: Phase 5 complete**

- [ ] App icons (all required sizes — Android Studio can generate from one source image)
- [ ] Store screenshots (min. 4 phone screenshots)
- [ ] Feature graphic (1024×500px)
- [ ] Store listing copy: title, short description, full description
- [ ] Privacy Policy URL (required — can be a simple hosted page)
- [ ] Content rating questionnaire
- [ ] Internal test track → Closed test track → Production

📄 See: [`CAPACITOR_ANDROID.md`](./CAPACITOR_ANDROID.md) (Play Store section)

---

## Total Estimated Effort

| Phase | Status | Effort |
|---|---|---|
| Phase 1: Server Hardening | ✅ Done | - |
| Phase 2: Shareable Links + QR | Pending | 2-4 hours |
| Phase 3: Browser Join-Only UI | Pending | 2-3 hours |
| Phase 4: Capacitor Android Setup | ✅ Done (needs testing) | - |
| Phase 5: RevenueCat + Billing | Pending | 8-12 hours |
| Phase 6: Play Store Submission | Pending | 3-5 hours |
| **Remaining** | | **15-24 hours** |

> Phase 1 and 4 are complete. Testing and remaining Phase 4 items (back button, status bar) needed before moving to Phase 5.

---

## Development Environment

Your browser dev workflow (`npm run dev`) is **completely unaffected** throughout all phases.

| Context | How | Hosting |
|---|---|---|
| Daily local dev | `npm run dev` in browser | ✅ Always available (no JWT check) |
| Android testing | Android Studio + physical device or emulator | ✅ With test purchase (free) |
| Production | Railway, `NODE_ENV=production` | 🔒 Requires valid JWT |

The entitlement system is gated behind `NODE_ENV === 'production'` — it simply doesn't run in development.
