# Bamboozle Networking Documentation

Status: reference — Socket.IO event contract to preserve in the native-WS migration.

## Introduction

Bamboozle uses **Socket.IO** for real-time multiplayer functionality. The communication is event-driven between clients (Host, Players, Audience) and the server.

## Socket Events Reference

### Client -> Server (Emitted by `gameService.ts`)

| Event Name         | Payload                                | Description                                      |
| ------------------ | -------------------------------------- | ------------------------------------------------ |
| `createRoom`       | `{ hostId }`                           | Host creates a new room.                         |
| `joinRoom`         | `{ roomCode, player }`                 | Player joins an existing room.                   |
| `gameStateUpdate`  | `{ roomCode, gameState }`              | Host syncs the complete game state.              |
| `submitLie`        | `{ roomCode, playerId, text }`         | Player submits their lie for a question.         |
| `submitVote`       | `{ roomCode, playerId, answerId }`     | Player votes for an answer.                      |
| `requestNarrator`  | `{ roomCode, text, language, requestId }` | Host requests TTS generation from the server. |

### Server -> Client (Received by `gameService.ts`)

| Event Name         | Payload                                | Description                                      |
| ------------------ | -------------------------------------- | ------------------------------------------------ |
| `playerEvent`      | `GameEvent`                            | Generic event wrapper for game actions.          |
| `gameStateUpdate`  | `GameState`                            | Full state replacement for clients.              |
| `hostEvent`        | `GameEvent`                            | Host-specific action (e.g., `START_GAME`).       |
| `playAudio`        | `{ audioUrl, text, requestId }`        | Triggers playback of generated TTS audio.        |
| `roomClosed`       | -                                      | Notify clients that the room has been closed.    |
| `hostDisconnected` | -                                      | Notify clients that the host connection is lost. |
| `hostReconnected`  | -                                      | Notify clients that the host is back online.     |

## State Synchronization Strategy

1. **Authority**: The **Host** client is currently the authoritative source of game logic (in local dev). It computes state transitions.
2. **Sync**: The Host emits `gameStateUpdate` to the server, which broadcasts it to all other clients in the room.
3. **Clients**: Players and Audience members receive the updated state and re-render their UI.

## Connection Lifecycle

1. **Connect**: Client connects to Socket.IO server.
2. **Room**: Client joins a specific room via `socket.join(roomCode)`.
3. **Disconnect**: Server handles cleanup (removing player from list, notifying others).
4. **Reconnect**: Clients attempt to rejoin using stored `playerId` and `roomCode` in `localStorage`.
