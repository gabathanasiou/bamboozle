# Bamboozle — Release Notes

Status: historical — append-only release notes.

---

## v0.7.0 — 2026-02-19

### 🐛 Bug Fixes

#### iOS Autocomplete in Answer / Name Inputs
- Tapping an iOS QuickType autocomplete suggestion now correctly inserts the text into the lie input, name input, and room code input across both `PlayerView` and `OnlinePlayerView`.
- **Root cause**: React's controlled inputs suppress `compositionend` events, which is how iOS delivers autocomplete selections instead of a standard `change` event.
- **Fix**: Added `onCompositionEnd` handlers to all text inputs so autocomplete selections are captured.
- Also added proper keyboard attributes on all inputs:
  - `autoCapitalize="characters"` — iOS keyboard auto-caps matches the existing `.toUpperCase()` logic
  - `autoCorrect="off"` — prevents iOS from substituting words (e.g. "DOGE" → "dodge")
  - `spellCheck={false}` — removes distracting red underlines on intentional lies
  - `inputMode="text"` — shows the full keyboard, not numeric or emoji
  - `autoComplete="off"` on code field; `autoComplete="nickname"` on name field

#### iOS Now Playing / Dynamic Island Branding
- When premium (Google Cloud TTS) voices play through an `HTMLAudioElement`, iOS automatically shows transport controls in the Dynamic Island, Control Center, and Lock Screen. This cannot be suppressed (it's an OS-level behaviour for all web audio).
- **Fix**: The `MediaSession` API is now used to register branded metadata so the widget displays "**Bamboozle — Narrator**" instead of a raw server URL.
- All transport controls (skip, seek, previous track) are disabled via no-op handlers — they don't make sense for a narrator.
- Affects: `services/gameService.ts` → `playNextPremium()`.

---

### 🎨 UI / UX Improvements (prior commits)

#### TikTok-Style Emotes
- Emotes now originate from the sender's avatar position rather than a fixed screen location.
- Each emote drifts along a unique S-curve path and fades out at a consistent size — matching the TikTok Live animation style.
- **Cooldown guard**: a debounce prevents the same emote from firing more than once per tap (fixes accidental double-fire on iOS tap events).
- Removed the now-redundant `EmotePopupLayer` from the join flow.

#### Home & Join Screen Redesign
- Home screen, Join screen, and Settings screen have been redesigned to share the same aesthetic as the Lobby — dark background with animated stars, glassmorphism cards, consistent yellow accent colours.
- The Narrator character now appears on the home screen as a focal point, reinforcing the game's personality from first launch.
- `GameButton` and `GameInput` UI components extracted and used consistently across all screens.

#### Narrator on Lobby Join
- The narrator character is displayed in the lobby while waiting for players, scaled down during the writing phase to reclaim vertical space.

---

### 📋 Planning & Documentation

A full suite of technical planning documents was added to `docs/` covering the upcoming Android + monetisation work:

| Document | Contents |
|---|---|
| [`MULTIPLAYER_PLAN.md`](./MULTIPLAYER_PLAN.md) | Master plan: vision, current state, phased implementation roadmap (6 phases, ~21–35 hours total) |
| [`CAPACITOR_ANDROID.md`](./CAPACITOR_ANDROID.md) | Step-by-step guide for wrapping the React app as an Android app using Capacitor, including Play Store setup |
| [`BILLING_INTEGRATION.md`](./BILLING_INTEGRATION.md) | Full RevenueCat + Google Play Billing integration guide — dashboard setup, client code, server JWT endpoint, dev workflow |
| [`ENTITLEMENT_SYSTEM.md`](./ENTITLEMENT_SYSTEM.md) | JWT schema, token refresh strategy, free trial logic, security model |
| [`BROWSER_AND_PURCHASE_UX.md`](./BROWSER_AND_PURCHASE_UX.md) | Platform detection, browser join-only UI, "Get the app" CTA, post-game purchase prompt, entitlement state machine |
| [`SERVER_HARDENING.md`](./SERVER_HARDENING.md) | Server-side cost protection — concurrent room caps, socket rate limiting, what's already handled |

#### Monetisation Model (planned)
- **Browser** (free): Join-only. Enter a room code. No account needed. A "Get the App" CTA is shown in place of the Host button.
- **Android App** (£1.99 one-time): Unlocks unlimited game hosting. Friends always join for free.
- **Free trial**: First hosted game is free before the purchase gate appears.
- **RevenueCat** handles all Google Play receipt validation — no direct Google API integration needed on the server.
- **Server gating**: Room creation in production requires a signed JWT issued by the server after RevenueCat confirms entitlement.

---

### 🔧 Infrastructure

#### Safari Audio Fix (v0.6.x, previous session)
- Premium voices no longer hang the game on Safari/iOS during the reveal sequence.
- Root cause was audio element reuse conflicts and race conditions in the `onAudioEnded` callback chain.
- Fixed via a shared `narratorAudioRef` element with a per-play safety timeout (8s failsafe) and careful cleanup of stale `activeAudioRef` references.

---

## Upcoming — v0.8.0 (planned)

- [ ] Phase 1: Server hardening (concurrent room caps, socket rate limiter)
- [ ] Phase 2: Shareable join links (`/join/ABCD`) + QR code in lobby
- [ ] Phase 3: Browser join-only UI + "Get the App" CTA
- [ ] Phase 4: Capacitor Android wrapper + Android Studio build
- [ ] Phase 5: RevenueCat + Google Play Billing integration
- [ ] Phase 6: Play Store submission
