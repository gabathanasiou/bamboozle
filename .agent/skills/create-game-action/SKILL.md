---
name: create-game-action
description: "This skill should be used when adding a new game action or event to the Bamboozle codebase."
version: 1.0.0
author: Gabriel Athanasiou
created: 2024-05-01
updated: 2026-03-07
platforms: [copilot, claude, codex]
category: development
tags: [game-logic, events, bamboozle]
risk: safe
---

# Creating a New Game Action

This skill guides developers through adding a new action/event to the Bamboozle game loop. Since the game is event-driven via Socket.IO, adding a new feature usually requires updates across the shared types, the game logic service, and the UI components.

## 1. Define the Action Type

### File: `types.ts`

To ensure end-to-end type safety, first define the new action in the `GameEvent` union type.

**Steps:**
1.  Open `src/types.ts`.
2.  Locate the `GameEvent` type definition (around line 100).
3.  Add a new union member following the pattern `{ type: 'YOUR_ACTION_NAME'; payload: { ... } }`.

**Example:**
```typescript
// types.ts
export type GameEvent =
  // ... existing events
  | { type: 'USE_POWERUP'; payload: { playerId: string; powerupId: string } };
```

## 2. Implement Game Logic Handler

### File: `services/gameService.ts`

The `gameService.ts` file contains the central state reducer in the `processHostEvent` function. This is where the game state is updated in response to actions.

**Steps:**
1.  Open `src/services/gameService.ts`.
2.  Locate the `processHostEvent` function (around line 740).
3.  Add a new `case` block inside the `switch (event.type)` statement.
4.  Implement the logic to update `next` state based on `prev` state and `event.payload`.
5.  Set `changed = true` to trigger a state broadcast.

**Example:**
```typescript
// services/gameService.ts
case 'USE_POWERUP': {
  const { playerId, powerupId } = event.payload;
  // Validation: Check if player can use powerup
  if (!next.players[playerId].hasPowerup) break;

  // Logic: Apply powerup effect
  next.players[playerId].isBoosted = true;
  
  // SFX: Play sound effect (Host only)
  sfx.play('POWERUP');
  
  changed = true;
  break;
}
```

## 3. Trigger the Action from UI

### File: `views/PlayerView.tsx` (or HostView/OnlinePlayerView)

Dispatch the action from a component in the user interface.

**Steps:**
1.  In the component, access the `actions` prop or the `processHostEvent` function (if available).
2.  Usually, actions are passed down or triggered via `socket.emit`.
3.  For player actions, typically emit a socket event that the host listens for.

**Example (Player side):**
```typescript
// views/PlayerView.tsx
const handlePowerup = () => {
  // Option A: If using a socket directly
  socket.emit('playerEvent', {
    type: 'USE_POWERUP',
    payload: { playerId: myPlayerId, powerupId: 'double-points' }
  });
};
```

**Note:** Ensure `gameService.ts` on the Host side is listening for this event. Most player events are automatically routed to `processHostEvent` via the `playerEvent` listener.

## 4. Native Considerations (Android/Capacitor)

When adding a new action that affects the UI, remember:
- **Haptic Feedback**: For high-impact actions (scoring, winning), consider adding haptic feedback using `@capacitor/haptics`.
- **Back Button**: If the action opens a modal or a sub-view, ensure it integrates with the back button handler in `App.tsx`.
- **Safe Areas**: Ensure any new UI elements (like a "Powerup" tray) respect `env(safe-area-inset-bottom)`.

## Checklist
- [ ] Action added to `GameEvent` in `types.ts`.
- [ ] Logic implemented in `processHostEvent` in `gameService.ts`.
- [ ] UI component triggers the action.
- [ ] Tested for mobile responsiveness (safe areas, tap targets).
- [ ] (If applicable) Sound effect added in `processHostEvent`.
