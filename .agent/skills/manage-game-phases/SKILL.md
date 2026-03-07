---
name: manage-game-phases
description: "This skill should be used when adding or modifying a game phase (e.g., adding a 'Wager' phase) in Bamboozle."
version: 1.0.0
author: Gabriel Athanasiou
created: 2024-05-01
updated: 2026-03-07
platforms: [copilot, claude, codex]
category: development
tags: [game-phases, bamboozle, front-end]
risk: safe
---

# Managing Game Phases

Changing or adding a game phase is a major modification to the game loop. This skill outlines the necessary steps to ensure a smooth transition across all client views (Host, Player, Online Player).

## 1. Define the Phase

### File: `types.ts`

First, update the `GamePhase` enum to include the new phase.

**Steps:**
1.  Open `src/types.ts`.
2.  Locate the `GamePhase` enum (around line 5).
3.  Add a new enum member.

**Example:**
```typescript
// types.ts
export enum GamePhase {
  // ... existing phases
  WAGER = 'WAGER', // New phase for betting points
  // ...
}
```

## 2. Implement View Logic (Host & Player)

### Files: `views/HostView.tsx`, `views/PlayerView.tsx`, `views/OnlinePlayerView.tsx`

Each view requires knowledge of how to render the new phase.

**HostView (`views/HostView.tsx`):**
1.  Import the new `GamePhase` value.
2.  Add a conditional render block in the main JSX return:
    ```tsx
    {state.phase === GamePhase.WAGER && <WagerScreen state={state} />}
    ```
3.  Ensure transitions in/out of this phase are visually smooth (use Framer Motion `AnimatePresence` if possible).

**PlayerView (`views/PlayerView.tsx`):**
1.  Provide the player controls for this phase.
    ```tsx
    {state.phase === GamePhase.WAGER && (
      <div className="flex flex-col gap-4">
        <h2>Place Your Wager!</h2>
        {/* Wager Input Component */}
      </div>
    )}
    ```

**OnlinePlayerView (`views/OnlinePlayerView.tsx`):**
1.  Similar to PlayerView but usually merges Host visuals with Player controls for single-screen play.

## 3. Manage Transitions

### File: `services/gameService.ts`

Logic is required to enter and exit this phase. This usually happens in `processHostEvent` or via `ProgressionManager`.

**Scenario A: Timer-Based Transition (e.g., Wager -> Reveal)**
1.  In `processHostEvent`, locate the timer logic or creating a new timer effect.
2.  When `state.timeLeft <= 0` in the current phase, trigger the next phase:
    ```typescript
    if (state.phase === GamePhase.WAGER && state.timeLeft <= 0) {
      next.phase = GamePhase.REVEAL; // Transition
      changed = true;
    }
    ```

**Scenario B: User-Action Transition (e.g., Host clicks "Start Wager")**
1.  Add a `START_WAGER` event (using the `create-game-action` skill).
2.  In `processHostEvent`, handle the event to set `next.phase = GamePhase.WAGER`.

## 5. Cross-Platform UI Optimization

When designing the UI for a new phase:
- **Host View (TV)**: Focus on high-visibility text, animations, and large avatars. Optimize for 1080p and 4K displays.
- **Player View (Phone)**: Keep inputs accessible and large (min 48px tap targets). Ensure the layout works in Portrait orientation.
- **Tablets**: Test that the "OnlinePlayerView" (shared view) scales well for tablet users rotating their devices.

## Checklist
- [ ] Phase added to `GamePhase` enum.
- [ ] Host view renders component for new phase (TV optimized).
- [ ] Player view renders controls for new phase (Phone/Portrait optimized).
- [ ] Transition logic implemented in `gameService.ts`.
- [ ] State cleanup handled for new round/game over.
- [ ] Tested on Android Simulator (Phone & Tablet).
