# Entitlement & Access Control System

Status: **superseded — not implemented.** Phase 1 ships `workers/bamboozle-rooms/src/auth.ts` with `authorizeHost()` and `AUTH_MODE=none`; `createRoom` accepts an optional `token` but ignores it. Roadmap item 5 replaces this design with a separate Supabase project + short-lived room tokens.

> **Superseded — do not implement.** This document's client-trusted JWT design is
> retired. It issued host tokens from client input without independently verifying
> the purchase. Roadmap item 5 is the approved design: a separate Supabase project
> with `profiles`/`entitlements`/`purchases`, RevenueCat/Paddle webhooks, and a
> short-lived room token minted by an Edge Function and verified by the Worker's
> `authorizeHost()` seam (`AUTH_MODE=token`).

## Overview

This document details the server-side entitlement system that gates game hosting behind a verified Google Play purchase. Browser users cannot host — this is enforced entirely on the server.

## Token Schema (JWT)

```json
{
  "sub": "user_abc123",           // Unique user ID (generated on first app open)
  "purchaseToken": "GPA.xxxx",    // Google Play purchase token
  "productId": "bamboozle_host",  // The product SKU
  "isEntitled": true,             // Whether hosting is unlocked
  "freeTrialUsed": false,         // Whether the 1 free trial game has been used
  "iat": 1708000000,              // Issued at
  "exp": 1708086400               // Expires (24h — refreshed on each app open)
}
```

## Server Endpoints

### `POST /api/validate-purchase`
Called by the Android app after a successful Google Play purchase.

**Request:**
```json
{
  "userId": "user_abc123",
  "purchaseToken": "GPA.3383-xxxx",
  "productId": "bamboozle_host"
}
```

**Server Logic:**
1. Call Google Play Developer API to verify the purchase receipt
2. Check `purchaseState === 0` (purchased, not refunded)
3. Store the entitlement: `{ userId, productId, purchaseToken, verified: true }`
4. Generate and return a signed JWT

**Response:**
```json
{
  "token": "eyJhbGciOi...",
  "isEntitled": true
}
```

### `POST /api/refresh-token`
Called on each app open to refresh the entitlement token.

**Request:**
```json
{
  "userId": "user_abc123",
  "existingToken": "eyJhbGciOi..."
}
```

**Server Logic:**
1. Decode the existing JWT
2. Re-validate the purchase with Google Play API
3. If still valid → issue new JWT
4. If refunded → return `{ isEntitled: false }`

**Response:**
```json
{
  "token": "eyJhbGciOi...",
  "isEntitled": true
}
```

## Room Creation Gating — superseded, do not implement

> **Superseded — do not implement.** The `createRoom` / JWT snippet that used to
> live here trusted a client-supplied token. Roadmap item 5 replaces it: the
> entitlement service mints a short-lived room token after verifying the purchase,
> and the Worker checks it through `authorizeHost()` with `AUTH_MODE=token`.

## Free Trial Logic

- First-time Android users get **1 free hosted game** without purchasing
- This is tracked server-side by `hostId` (stored in a simple map or database)
- After the free game ends, the host sees a prompt: "Enjoyed hosting? Unlock unlimited games for £1.99"
- Browser users **never** get a free trial (they cannot access hosting UI)

## Google Play Purchase Validation

### API Endpoint
```
GET https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{packageName}/purchases/products/{productId}/tokens/{purchaseToken}
```

### Required Setup
1. **Google Play Console**: Create a service account with `Financial` permissions
2. **Server**: Store the service account JSON (or env var) for API authentication
3. **Validation Response**: Check `purchaseState === 0` and `consumptionState === 0`

### Edge Cases
| Scenario | Handling |
|---|---|
| **Valid purchase** | Issue JWT, allow hosting |
| **Refunded purchase** | Token refresh fails, hosting blocked |
| **Reinstall / new device** | Purchase restored via Google Play, re-validated |
| **Multiple devices** | Same Google account = same entitlement |
| **Network error on validation** | Use cached entitlement, retry on next refresh |

## Security Considerations

### What's Protected
- Room creation is **server-gated** — client cannot bypass
- JWTs are **signed with server secret** — cannot be forged
- Purchase tokens are **validated with Google Play** — cannot be faked
- Browser clients **never receive** hosting UI components

### Attack Vectors & Mitigations
| Attack | Mitigation |
|---|---|
| Forged JWT | Server validates signature with secret key |
| Stolen token | Tokens expire in 24h, tied to userId |
| Browser console `createRoom` | Server rejects without valid token |
| Bot room creation | Rate limiting (max 3 rooms per host) |
| Token sharing | Tokens tied to Google Play purchase receipt |

## Environment Variables (New)

| Variable | Description |
|---|---|
| `JWT_SECRET` | Secret key for signing/verifying JWT tokens |
| `GOOGLE_PLAY_SERVICE_ACCOUNT` | Service account JSON for Play API validation |
| `MAX_ROOMS_PER_HOST` | Maximum concurrent rooms per host (default: 3) |
| `FREE_TRIAL_ENABLED` | Whether to allow 1 free trial game (default: true) |
