# Server Hardening & Cost Protection

Status: reference — rules ported into the Cloudflare DO.

## Overview

This document covers the server-side protections needed to ensure cost scales only with paying hosts and to prevent abuse. The goal is **light-touch guardrails**, not heavy restrictions that punish legitimate users.

---

## 1. What's Already Handled ✅

The existing server already covers the most important cleanup cases:

| Scenario | Current Behaviour |
|---|---|
| **Host disconnects** | 60s grace period → room closed, all clients notified |
| **All players leave** | 60s grace → room destroyed, TTS cache cleaned |
| **Player disconnects** | 60s grace → player kicked, room notified |
| **Host reconnects** | Reclaims existing room within 60s window |

These mechanisms mean rooms are already self-cleaning. **No additional room lifetime limits are needed.**

---

## 2. Rate Limiting (Light Touch)

### Philosophy
A legitimate host might play 10 games in a day — finishing one, creating another. That's the whole point. We shouldn't limit *how many rooms they create over time*, only *how many they have open simultaneously*.

### What We Should Limit
- **Concurrent open rooms per host**: Max **2 at the same time**. This prevents a single host from holding 20 rooms open simultaneously (e.g., via a script), but doesn't stop sequential play at all.
  
### What We Should NOT Limit
- ❌ Total rooms created per day/hour — too harsh for legitimate use
- ❌ A global server room cap hardcoded at 100 — arbitrary and punishes real users during busy periods

### Implementation
```javascript
const MAX_CONCURRENT_ROOMS_PER_HOST = 2;

function countActiveRoomsByHost(hostId) {
  return Object.values(rooms).filter(r => r.hostId === hostId).length;
}

// In createRoom handler:
socket.on('createRoom', async ({ hostId, token }, callback) => {
  // ... entitlement check ...

  if (countActiveRoomsByHost(hostId) >= MAX_CONCURRENT_ROOMS_PER_HOST) {
    callback({ error: 'MAX_CONCURRENT_ROOMS', message: 'You already have active rooms open.' });
    return;
  }

  // Proceed with room creation as normal
  const roomCode = generateRoomCode();
  // ...
});
```

This blocks a misbehaving client but is **invisible to any normal user** who plays games one at a time.

---

## 3. Bot / Spam Protection

The main risk isn't legitimate users — it's someone scripting `createRoom` events without going through the purchase flow. The entitlement system (see `ENTITLEMENT_SYSTEM.md`) is the primary defence here.

However, as a belt-and-suspenders measure, we can add a simple socket-level event rate limiter:

```javascript
// Track events per socket connection
const socketEventCounts = {}; // { socketId: { count, windowStart } }
const EVENT_RATE_WINDOW = 10000; // 10 seconds
const MAX_EVENTS_PER_WINDOW = 20;

function isSocketRateLimited(socketId) {
  const now = Date.now();
  if (!socketEventCounts[socketId]) {
    socketEventCounts[socketId] = { count: 0, windowStart: now };
  }
  
  const tracker = socketEventCounts[socketId];
  if (now - tracker.windowStart > EVENT_RATE_WINDOW) {
    tracker.count = 0;
    tracker.windowStart = now;
  }
  
  tracker.count++;
  return tracker.count > MAX_EVENTS_PER_WINDOW;
}

// Clean up on disconnect
socket.on('disconnect', () => {
  delete socketEventCounts[socket.id];
  // ... rest of disconnect logic
});
```

This fires silently — a legitimate user sending one event per second would never hit 20 events in 10 seconds.

---

## 4. Input Validation & Sanitization

These are already-common bugs waiting to happen — worth documenting even if not yet implemented:

| Input | Validation Needed |
|---|---|
| **Player name** | Max 20 chars, strip HTML tags |
| **Lies / answers** | Max 100 chars, strip HTML tags |
| **Room code on join** | Exactly 4 characters, uppercase letters only |
| **All socket events** | Require `roomCode` to exist in `rooms` before processing |

The current server does some of this implicitly (guards on `if (!rooms[roomCode])`), but explicit input sanitization is a future improvement.

---

## 5. Logging

Keep a clear audit trail for debugging and future monitoring:

| Event | What to Log |
|---|---|
| Room created | `roomCode`, `hostId`, timestamp |
| Room destroyed | `roomCode`, reason, total lifetime |
| Room creation rejected | `hostId`, reason (`MAX_CONCURRENT_ROOMS`, entitlement failure) |
| Purchase validated | `userId`, `productId`, result |
| Purchase rejected | `userId`, error |

---

## 6. Cost Projections

### Per-Game Cost
| Component | Cost per game |
|---|---|
| Server compute (WebSocket, Railway) | ~$0.001 |
| Google Cloud TTS — first play of a phrase | ~$0.01–0.05 |
| Google Cloud TTS — subsequent plays (GCS cache) | ~$0.00 (served from CDN) |
| GCS storage | Negligible (KB per phrase) |
| **Total per game** | **~$0.01–0.05 (first time), ~$0.001 repeat** |

### Key Insight
Your TTS caching in GCS means the cost of a phrase is paid **once** across all future games. After the initial warm-up period, the marginal cost per game converges toward almost zero for the audio pipeline.

Cost scales with **new phrases being generated**, not with concurrent users. The existing room cleanup already prevents zombie rooms from accumulating idle costs.

---

## 7. Summary: What's Actually New Work

| Item | Priority | Complexity | Notes |
|---|---|---|---|
| Concurrent room cap per host | 🟡 Medium | 🟢 Trivial | 5 lines of code |
| Socket event rate limiter | 🟡 Medium | 🟢 Low | Belt-and-suspenders vs bots |
| Input sanitization | 🟢 Low | 🟢 Low | Nice to have, not urgent |
| Structured logging | 🟢 Low | 🟢 Low | For future monitoring |
| **Room lifetime limits** | ~~High~~ | ~~Medium~~ | **NOT needed — already handled** |
| **Global room cap** | ~~Medium~~ | ~~Low~~ | **NOT needed — arbitrary, too harsh** |
| **Per-host room creation rate limit** | ~~Medium~~ | ~~Low~~ | **NOT needed — punishes legit use** |
