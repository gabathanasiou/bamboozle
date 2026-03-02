---
name: narrator-management
description: Comprehensive guide and utilities for managing the Bamboozle narrator system, including premium voices and Safari compatibility.
---

# Narrator & Audio Management

The Bamboozle narrator is a critical part of the game's personality. This skill explains how to modify narrator behavior, add new voice lines, and maintain the complex audio subsystem.

## 1. System Overview

The audio system (`services/audioService.ts` & `gameService.ts`) handles two types of audio:
1.  **SFX**: Preloaded sound effects (clicks, chimes).
2.  **Narrator (TTS)**:
    -   **Premium**: Google Cloud TTS (Neural2) generated on the server and streamed to clients.
    -   **Local**: Browser `speechSynthesis` fallback.

### Critical: Safari Compatibility
To play audio on iOS Safari without a user gesture for *every* line, we use a **Shared Audio Element** strategy:
-   A single `<audio>` element (`narratorAudioRef` in `gameService.ts`) is created.
-   It is "unlocked" (played silently) on the first user interaction (Join/Start).
-   All subsequent TTS tracks are played by swapping the `src` of this *exact same element*.

**⚠️ NEVER create a `new Audio()` instance for the narrator in the game loop. Always reuse the ref.**

## 2. Adding Narrator Lines

Narrator lines are stored in `i18n/narrator/`.

### File: `i18n/narrator/en.ts` (or `el.ts`)

**Steps:**
1.  Identify the category (e.g., `GREETINGS`, `REVEAL_LIE`, `GAME_OVER`).
2.  Add a new string to the array.
    -   Use `{player}` or `{points}` placeholders if the code supports them.
    -   Keep lines short (under 10 seconds) for better pacing.

**Example:**
```typescript
// i18n/narrator/en.ts
export const NARRATOR_EN = {
  // ...
  GENERIC_PRAISE: [
    "Not bad, human.",
    "I've seen worse.",
    "Impressive... for a meatbag." // New line
  ],
  // ...
};
```

## 3. Triggering Narration

### File: `services/gameService.ts`

Use the `speak()` function to trigger narration. It automatically handles:
-   Checking settings (`usePremiumVoices`).
-   Deduping (preventing double-speak).
-   Fallback to local TTS if the server fails.

**Design Pattern:**
```typescript
// inside gameService.ts or a component with access to actions
speak("Welcome to Bamboozle!", true); // true = force interrupt
```

**Using Localized Lines:**
```typescript
// helper to get random line
const line = getNarratorPhrase(state.language, 'GENERIC_PRAISE', {});
speak(line);
```

### Android/Capacitor Audio
The Android app runs in a WebView. While it behaves similarly to Chrome, there are native considerations:
- **Local Dev Server**: In development, audio from `http://localhost:3001` will fail on Android. You **must** use the Mac's local IP (e.g., `http://192.168.x.x:3001`).
- **Media Playback**: Capacitor requires `android:usesCleartextTraffic="true"` to load audio from non-HTTPS sources during development.
- **Hardware Volume**: The system volume buttons on Android will control the "Media" volume for the game.

## 4. Debugging & Maintenance

### Common Issues
-   **"Narrator is silent on iPhone"**: Check if `unlockAudio()` was called. Verify `narratorAudioRef.current` is being used.
-   **"Game hangs at Reveal"**: The `ProgressionManager` waits for `onAudioEnded`. If the audio errors out and doesn't fire `ended`, the game hangs.
    -   *Fix*: Ensure the "Safety Timeout" in `playNextPremium` (gameService.ts) is active (currently set to ~8s).

### Updating the Server (Premium Voices)
-   Server logic is in `server/index.js` (or `server/tts.ts`).
-   If you add a new language, you must map it to a Google Cloud Voice ID in the server config.

## Checklist
-   [ ] New lines added to `i18n/narrator`.
-   [ ] `speak()` called with correct localization key.
-   [ ] Verified Safari behavior (if modifying `audioService`).
-   [ ] (Start of Game) Ensure `unlockAudio` is attached to the "Start" button.
