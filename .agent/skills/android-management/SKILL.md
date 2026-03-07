---
name: android-management
description: "This skill should be used when managing, building, and troubleshooting the Capacitor-based Android application for Bamboozle."
version: 1.0.0
author: Gabriel Athanasiou
created: 2024-05-01
updated: 2026-03-07
platforms: [copilot, claude, codex]
category: development
tags: [android, capacitor, build]
risk: safe
---

# Android & Capacitor Management Guide

This skill covers the essential workflows for maintaining the Bamboozle Android application. 

## 1. Core Workflow

The Android app is a hybrid Capacitor application. The source of truth is the React code in the root directory.

### Local Development (Live Reload)
1. **Config**: In `capacitor.config.ts`, set `const IS_DEV = true`.
2. **Server**: Run `npm run dev -- --host` on the development machine.
3. **Sync**: Run `npx cap sync android`.
4. **Run**: Use Android Studio to launch on an emulator or physical device.

### Production Build (Bundling)
1. **Config**: In `capacitor.config.ts`, set `const IS_DEV = false`.
2. **Build**: Run `npm run build` (Web-only) or `npm run android:build` (Full Native sync).
3. **Sync**: Run `npx cap sync android` (Automatically handled by `android:build`).
4. **Deploy**: Build signed AAB/APK in Android Studio for the Play Store.

### Smart Native Build (`npm run android:build`)
This script automates the native workflow:
1. Checks the hash of `assets/icon.png` and `assets/splash.png`.
2. Regenerates native density folders **only if** source assets changed.
3. Performs a fresh production web build.
4. Syncs all assets to the `/android` directory.

## 2. Key Native Configurations

### AndroidManifest.xml
- **Cleartext**: `android:usesCleartextTraffic="true"` is enabled in the `<application>` tag to allow local dev server connectivity (HTTP).
- **Permissions**: `android.permission.INTERNET` is required.

### MainActivity.java
Custom native logic is implemented here:
- **Fullscreen**: Hides status bar via `WindowManager.LayoutParams.FLAG_FULLSCREEN`.
- **Orientation**: 
  - Phones: Locked to Portrait.
  - Tablets (sw600dp): Allowed to rotate.

## 3. Troubleshooting

### Connection Issues
- **Local Dev**: Ensure the IP in `capacitor.config.ts` matches the development machine's current local IP (use `ifconfig`).
- **Network Resolution**: If the app loads but cannot find the server, check `gameService.ts` logs for the `SOCKET_URL`.
- **Offline Error**: If the user has no internet, the app will show a custom "Bamboozled! Connection Lost" screen (defined in `App.tsx`).

### Out of Sync
If native changes (icons, permissions) are not reflecting:
1. Run `npx cap sync android`.
2. In Android Studio, go to **File > Sync Project with Gradle Files**.

## 4. Dependencies
- `@capacitor/core` & `@capacitor/cli`
- `@capacitor/android`
- `@capacitor/app` (Native back button)
- `@capacitor/network` (Offline detection)
- `@capacitor/status-bar`
- `@capacitor/splash-screen`
