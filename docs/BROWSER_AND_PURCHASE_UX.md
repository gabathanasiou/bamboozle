# Browser Join-Only & Platform UX

Status: reference — browser join-only + purchase UX; the server gate lands with roadmap item 5.

## Overview

The browser version of Bamboozle is join-only by design. This is enforced in two complementary ways:
1. **Client-side**: The "Host" UI is simply never rendered in a browser — no button to find, nothing to hack
2. **Server-side**: `createRoom` requires a valid JWT from the entitlement system — even if someone manually fires the event from the browser console, the server rejects it

Both layers work together. Neither alone is sufficient.

---

## Platform Detection

Using Capacitor's platform detection, the app knows at runtime whether it's running natively (Android) or in a browser:

```typescript
// utils/platform.ts
import { Capacitor } from '@capacitor/core';

// true when running as an installed Android app
// false when running in any browser (mobile or desktop)
export const isNativeApp = Capacitor.isNativePlatform();

export const platform = Capacitor.getPlatform(); // 'android' | 'ios' | 'web'
```

This single flag drives all the conditional rendering below.

---

## Home Screen: What Each Platform Sees

### Browser
```
┌───────────────────────────────────────┐
│            🎮 BAMBOOZLE               │
│                                       │
│   ┌───────────────────────────────┐   │
│   │         Join a Game           │   │
│   └───────────────────────────────┘   │
│                                       │
│   ─────────────── ✦ ──────────────   │
│                                       │
│   Want to host your own games?        │
│   Get the Android app for £1.99 →     │
│                                       │
│   ┌───────────────────────────────┐   │
│   │    📱  Get it on Google Play  │   │
│   └───────────────────────────────┘   │
│                                       │
│   One-time payment. Unlimited games.  │
│   Your friends join free.             │
└───────────────────────────────────────┘
```

### Android App (Entitled — purchased)
```
┌───────────────────────────────────────┐
│            🎮 BAMBOOZLE               │
│                                       │
│   ┌───────────────────────────────┐   │
│   │         Host a Game           │   │
│   └───────────────────────────────┘   │
│                                       │
│   ┌───────────────────────────────┐   │
│   │         Join a Game           │   │
│   └───────────────────────────────┘   │
│                                       │
└───────────────────────────────────────┘
```

### Android App (Not Yet Purchased — free trial or first open)
```
┌───────────────────────────────────────┐
│            🎮 BAMBOOZLE               │
│                                       │
│   ┌───────────────────────────────┐   │
│   │    Host a Game (Try Free)     │   │  ← 1 free trial game
│   └───────────────────────────────┘   │
│                                       │
│   ┌───────────────────────────────┐   │
│   │         Join a Game           │   │
│   └───────────────────────────────┘   │
│                                       │
│   Unlock unlimited hosting: £1.99 →   │
└───────────────────────────────────────┘
```

---

## Component Implementation

```tsx
// In HomeSelector (App.tsx)
import { isNativeApp } from './utils/platform';
import { useEntitlement } from './services/entitlementService';

function HomeSelector({ onSelect }) {
  const { isEntitled, freeTrialAvailable } = useEntitlement();
  const canHost = isNativeApp && (isEntitled || freeTrialAvailable);

  return (
    <div className="home-selector">
      {/* Host button — only on Android */}
      {isNativeApp && (
        <GameButton onClick={() => onSelect('HOST')}>
          {isEntitled ? 'Host a Game' : 'Host a Game (Try Free)'}
        </GameButton>
      )}

      {/* Join button — always shown */}
      <GameButton onClick={() => onSelect('PLAYER')}>
        Join a Game
      </GameButton>

      {/* Browser CTA — only in browser */}
      {!isNativeApp && (
        <div className="get-app-cta">
          <p>Want to host your own games?</p>
          <a href="https://play.google.com/store/apps/details?id=com.bamboozle.app"
             target="_blank" rel="noopener noreferrer">
            📱 Get it on Google Play — £1.99
          </a>
          <small>One-time payment. Unlimited games. Your friends join free.</small>
        </div>
      )}
    </div>
  );
}
```

---

## In-App Purchase Flow (End-to-End)

### Step-by-Step

```
1. User taps "Unlock Hosting — £1.99" in the Android app
            ↓
2. Capacitor calls Google Play Billing API
            ↓
3. Google shows native payment sheet (user's saved Google Pay card)
            ↓
4. User confirms → Google returns a purchaseToken to the app
            ↓
5. App sends purchaseToken + userId to your server
   POST /api/validate-purchase
            ↓
6. Server calls Google Play Developer API to verify:
   - Is this token real? ✓
   - Has it been refunded? ✗
   - Is the product ID correct? ✓
            ↓
7. Server issues a JWT signed with your server's secret
   { sub: userId, isEntitled: true, purchaseToken, iat, ... }
            ↓
8. App stores JWT in AsyncStorage (persists across restarts)
            ↓
9. From now on, every "Host Game" → server call includes the JWT
            ↓
10. Server validates the JWT signature → allows createRoom
```

### Why Two Tokens?
- **Google's purchaseToken**: Proof that money changed hands. You need it to re-verify with Google.
- **Your JWT**: What your server actually uses for every request. It's faster to verify (just check the signature) than calling Google's API every time someone hosts a game.

### Re-Validation on App Open
Every time the app opens, you call `/api/refresh-token`. Your server re-checks with Google that the original purchase hasn't been refunded, then issues a fresh JWT. This means:
- Refunds are caught automatically (next app open)
- Legitimate users are never locked out
- The app still works if Google's API is temporarily slow (use the previous JWT as fallback with a grace period)

---

## What Happens If Someone Tries to Hack It

| Attack | What Happens |
|---|---|
| Browser console: `socket.emit('createRoom', ...)` | Server checks for JWT → no JWT → rejected with `ENTITLEMENT_REQUIRED` |
| Forge a JWT | Server validates signature with its secret → invalid signature → rejected |
| Reuse another user's real JWT | Tied to their `userId` + `purchaseToken` → works, but they'd have to share their app and purchase — not a scalable attack |
| Buy → refund → keep hosting | Next app open calls `/api/refresh-token` → Google says refunded → new JWT not issued → hosting stops |
| Screenshot the JWT and use it in browser | Browser doesn't have the hosting UI to begin with; and the server could also add an additional `platform: 'android'` claim to the JWT |

---

## Post-Game Purchase Prompt (Android — Free Trial Expired)

After a host's free trial game ends, show a one-time prompt before returning to the home screen:

```
┌───────────────────────────────────────┐
│                                       │
│   🎉 Great game!                      │
│                                       │
│   Enjoyed hosting? Unlock unlimited   │
│   games for a one-time £1.99.         │
│                                       │
│   ┌───────────────────────────────┐   │
│   │    Unlock Hosting — £1.99     │   │
│   └───────────────────────────────┘   │
│                                       │
│   ┌───────────────────────────────┐   │
│   │    Maybe Later                │   │
│   └───────────────────────────────┘   │
│                                       │
│   Your friends can always join free.  │
└───────────────────────────────────────┘
```

Key UX decisions:
- "Maybe Later" always available — never trap the user
- Shown **after** the game, not before (they've experienced the value first)
- Framing: "your friends always join free" — removes the objection that they'd be making friends pay too

---

## Entitlement State Machine

```
                ┌──────────────────────┐
                │   First App Open     │
                └──────────┬───────────┘
                           ↓
                ┌──────────────────────┐
                │  FREE_TRIAL_AVAILABLE │ ← Can host 1 game
                └──────────┬───────────┘
                           ↓ (after 1 game)
                ┌──────────────────────┐
                │  FREE_TRIAL_USED     │ ← Purchase prompt shown
                └──────────┬───────────┘
                    ↓              ↓
           (buys)               (skips)
             ↓                     ↓
  ┌───────────────────┐   ┌───────────────────┐
  │    ENTITLED       │   │   JOIN_ONLY        │
  │  (can host ∞)     │   │  (join games only) │
  └───────────────────┘   └───────────────────┘
           ↑                         ↑
           └─────────────────────────┘
                  (can purchase any time from
                   the home screen CTA)
```

---

## "Get the App" CTA — Browser UX Notes

- **Show it on the home screen only** — not during gameplay. Once they've joined a game, they should be fully immersed. The upsell is at the natural transition point (home screen).
- **Never block gameplay** — browser players can always join without seeing friction.
- **Make the value prop clear**: "Your friends join free" removes the #1 objection ("will this cost my friends money?").
- **QR code alternative**: The Play Store link could also be shown as a QR code in-game (from the host's screen) so players can scan it after a session.
