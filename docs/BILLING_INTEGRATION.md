# Google Play Billing — RevenueCat Integration

Status: reference — Android/RevenueCat plan; web checkout + Supabase webhooks are roadmap item 5.

> **Superseded — do not implement.** The host-token design in this document is
> retired: it minted a host JWT from a client-supplied `userId` without verifying
> the purchase, which amounted to trusting the client. Roadmap item 5 is the only
> approved flow: a separate Supabase project + Edge Function verifies the purchase
> and mints a short-lived room token that the Worker checks through
> `authorizeHost()` with `AUTH_MODE=token`. Keep the RevenueCat/Google Play setup
> notes below, but do not build `POST /api/get-host-token`.

## Why RevenueCat?

Implementing Google Play Billing from scratch requires you to:
- Build a full server-side receipt validation endpoint against Google's API
- Handle refunds, reinstalls, offline purchases, and device changes yourself
- Manage a Google Play service account just for receipt validation

RevenueCat is a free third-party service (free up to ~$2,500/mo revenue ≈ 1,000 purchases at £1.99) that handles all of that. You write ~20 lines of client code instead of ~400 lines across client + server. **Use it.**

---

## Overview

```
Android App (Capacitor)            RevenueCat              Google Play
        │                               │                       │
        │── user taps "Unlock" ─────────→│                       │
        │                               │── verify purchase ────→│
        │                               │←── receipt valid ──────│
        │←── entitlement: 'hosting' ────│                       │
        │                               │                       │
        │                          Your Server                  │
        │                               │                       │
        │── request short-lived token ──→│                       │
        │   (after RevenueCat confirms)  │ verifies entitlement  │
        │←── room token ────────────────│                       │
        │                               │                       │
        │── socket createRoom(token) ───→│                       │
        │                               │ verifies token, creates room
        │←── roomCode + hostSecret ─────│                       │
```

RevenueCat talks to Google. Your server talks to RevenueCat's simple state (via the JWT your server issues). The two are cleanly separated.

---

## Part 1: RevenueCat Dashboard Setup

Before writing any code, set up RevenueCat in their web dashboard.

### 1.1 Create Account
Go to [app.revenuecat.com](https://app.revenuecat.com) → Sign Up (free).

### 1.2 Create a New Project
- Project name: `Bamboozle`
- Platform: **Google Play**

### 1.3 Connect Google Play
RevenueCat needs read access to your Play Console to validate purchases.
1. In Play Console → **Setup → API access**
2. Link to a Google Cloud project
3. Create a service account → grant **Financial data** permission
4. Download the JSON key
5. In RevenueCat dashboard → **Google Play** → paste the JSON key

This is the same Google Cloud setup you'd need for DIY receipt validation — RevenueCat just uses it on their end so you don't have to.

### 1.4 Create the Product
In RevenueCat dashboard → **Products** → Add Product:
- **Product identifier**: `bamboozle_host_unlock` (must match exactly what you create in Play Console)
- **Type**: One-time purchase

### 1.5 Create an Entitlement
**Entitlements → Add Entitlement**:
- **Identifier**: `hosting` ← this is the string you check in code
- Attach the `bamboozle_host_unlock` product to it

### 1.6 Create an Offering
**Offerings → Add Offering**:
- **Identifier**: `default`
- Add a package containing the `bamboozle_host_unlock` product

### 1.7 Get Your API Key
**Project Settings → API Keys** → copy the **Android public SDK key** (starts with `goog_...`)

---

## Part 2: Google Play Console Setup

### 2.1 Create the In-App Product
1. Play Console → Your app → **Monetise → Products → In-app products**
2. **Create product**:
   - **Product ID**: `bamboozle_host_unlock`
   - **Name**: Host Unlock
   - **Description**: Unlock the ability to host unlimited games for your friends
   - **Price**: £1.99 GBP
   - **Status**: Active

### 2.2 Set Up Test Accounts
1. Play Console → **Setup → License testing**
2. Add your own Google account(s) as license testers
3. Purchases made by license testers are free and reversible — perfect for dev/QA

---

## Part 3: Client-Side Code (Capacitor)

### 3.1 Install Plugin

```bash
npm install @revenuecat/purchases-capacitor
npx cap sync android
```

### 3.2 Billing Service

```typescript
// services/billingService.ts
import { Purchases, LOG_LEVEL } from '@revenuecat/purchases-capacitor';
import { Capacitor } from '@capacitor/core';

const RC_ANDROID_KEY = import.meta.env.VITE_REVENUECAT_ANDROID_KEY;

export async function initBilling(userId: string) {
  if (!Capacitor.isNativePlatform()) return; // No-op in browser/dev

  await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG }); // Disable in production
  await Purchases.configure({
    apiKey: RC_ANDROID_KEY,
    appUserID: userId, // Your own user ID — ties the purchase to the user
  });
}

// Check entitlement on app open (call this after initBilling)
export async function getEntitlementStatus(): Promise<'entitled' | 'trial' | 'none'> {
  if (!Capacitor.isNativePlatform()) return 'entitled'; // Dev: always entitled

  try {
    const { customerInfo } = await Purchases.getCustomerInfo();
    if (customerInfo.entitlements.active['hosting']) {
      return 'entitled';
    }
  } catch (e) {
    console.warn('[Billing] Could not fetch entitlement status:', e);
  }
  return 'none';
}

// Trigger the purchase flow — shows the Google Play payment sheet
export async function purchaseHosting(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true; // Dev: always succeed

  try {
    const offerings = await Purchases.getOfferings();
    const pkg = offerings.current?.availablePackages[0];
    if (!pkg) throw new Error('No package found');

    const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
    return !!customerInfo.entitlements.active['hosting'];
  } catch (e: any) {
    if (e.code !== 'PURCHASE_CANCELLED') {
      console.error('[Billing] Purchase error:', e);
    }
    return false;
  }
}

// Required by Play Store rules — must always be available to users
export async function restorePurchases(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;

  try {
    const { customerInfo } = await Purchases.restorePurchases();
    return !!customerInfo.entitlements.active['hosting'];
  } catch (e) {
    console.error('[Billing] Restore error:', e);
    return false;
  }
}
```

### 3.3 Entitlement Hook

```typescript
// hooks/useEntitlement.ts
import { useState, useEffect } from 'react';
import { getEntitlementStatus } from '../services/billingService';

export type EntitlementStatus = 'loading' | 'entitled' | 'trial' | 'none';

export function useEntitlement() {
  const [status, setStatus] = useState<EntitlementStatus>('loading');

  useEffect(() => {
    getEntitlementStatus().then(setStatus);
  }, []);

  return {
    isLoading: status === 'loading',
    isEntitled: status === 'entitled',
    canTrial: status === 'trial',
    canHost: status === 'entitled' || status === 'trial',
  };
}
```

---

## Part 4: Server-Side Changes

The key insight: **your server doesn't talk to RevenueCat directly**. RevenueCat lives on the client. Your server only validates its own JWTs (which it issued after the client confirmed entitlement).

### 4.1 New Dependency

```bash
# In /server
npm install jsonwebtoken
```

### 4.2 JWT Helpers

```javascript
// server/entitlement.js
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET; // Set in Railway env vars

function issueHostToken(userId) {
  return jwt.sign(
    { sub: userId, isEntitled: true, platform: 'android' },
    JWT_SECRET,
    { expiresIn: '7d' } // Refresh weekly on app open
  );
}

function validateHostToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

module.exports = { issueHostToken, validateHostToken };
```

### 4.3 New Server Endpoint — superseded, do not implement

> **Superseded — do not implement.** The old `POST /api/get-host-token` endpoint
> signed a host JWT from a client-supplied `userId` without verifying the
> RevenueCat/Play purchase. It must not be implemented. Roadmap item 5 replaces it
> with a short-lived room token minted by the entitlement service and verified by
> the Worker through `authorizeHost()`.

### 4.4 Gate `createRoom`

```javascript
// In the createRoom socket handler
socket.on('createRoom', ({ hostId, token }, callback) => {
  // Dev bypass
  if (process.env.NODE_ENV !== 'production') {
    const roomCode = generateRoomCode();
    rooms[roomCode] = { hostSocketId: socket.id, hostId, /* ... */ };
    callback({ roomCode });
    return;
  }

  // Production: validate JWT
  const entitlement = validateHostToken(token);
  if (!entitlement) {
    callback({ error: 'ENTITLEMENT_REQUIRED' });
    return;
  }

  // Concurrent room cap
  const hostRoomCount = Object.values(rooms).filter(r => r.hostId === hostId).length;
  if (hostRoomCount >= 2) {
    callback({ error: 'MAX_CONCURRENT_ROOMS' });
    return;
  }

  const roomCode = generateRoomCode();
  rooms[roomCode] = { hostSocketId: socket.id, hostId, /* ... */ };
  callback({ roomCode });
});
```

---

## Part 5: Development Workflow

This is the part that matters most day-to-day.

### Local Dev (Browser — `npm run dev`)
- `Capacitor.isNativePlatform()` returns `false`
- All billing functions return dev defaults (always entitled)
- Server runs with `NODE_ENV=development` → skips JWT check
- **Your current workflow is completely unchanged**

### Testing Purchases (Android Device / Emulator)
1. Add your Google account as a license tester in Play Console
2. Build the Android app via Android Studio
3. Make a "purchase" → Google shows the native sheet but charges NOTHING
4. RevenueCat SDK receives the test receipt → `entitlements.active['hosting']` becomes true
5. App requests a short-lived room token from the entitlement service → can now host

### Sandbox vs Production
RevenueCat automatically detects sandbox purchases (from license testers) and handles them correctly. No extra config needed.

---

## Part 6: New Environment Variables

| Variable | Where | Description |
|---|---|---|
| `VITE_REVENUECAT_ANDROID_KEY` | Frontend `.env` | Your RC Android SDK key (`goog_...`) |
| `JWT_SECRET` | Server Railway env | Secret for signing/verifying host tokens |

---

## Part 7: RevenueCat Dashboard — Ongoing Use

Once live, the RC dashboard gives you:
- **Charts**: Revenue, active subscribers, conversion rate
- **Customer lookup**: Search any user, see their purchase history
- **Refund handling**: RC picks up refunds automatically from Google; revokes entitlement on next app open
- **Restore purchases**: Handled automatically by `restorePurchases()` — user reinstalls, taps restore, gets access back

---

## Play Store Rules Checklist

These are required by Google or your app will be rejected:

- [ ] **"Restore Purchases" button** must exist and be accessible to users
- [ ] **Clear pricing** displayed before purchase dialog
- [ ] **Privacy Policy URL** (required in Play Console)
- [ ] **Terms of Service URL**
- [ ] **No mention of other payment methods** (can't say "buy on our website instead")

---

## Rough Implementation Timeline

| Task | Est. Time | Notes |
|---|---|---|
| RevenueCat dashboard setup | 1-2 hours | Link Play Console, create product/entitlement |
| Play Console product setup | 30 min | Create the £1.99 in-app product |
| Client billing service | 2 hours | The code above, wired into the UI |
| Server JWT endpoint + gating | 1-2 hours | Small additions to existing server |
| Android Studio install + test build | 2-4 hours | First time setup always takes longer |
| End-to-end test purchase | 1-2 hours | With license tester account |
| **Total** | **~8-12 hours** | Spread over 2-3 sessions |
