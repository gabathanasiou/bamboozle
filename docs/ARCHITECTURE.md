# Bamboozle Architecture Overview

## Introduction
Bamboozle is a real-time multiplayer party game inspired by Jackbox Games. It involves players submitting funny "lies" to fill in the blanks of trivia questions, then voting on the most believable ones.

## Core Architecture

### Tech Stack
- **Frontend**: React (Vite)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Networking**: Socket.IO (Client & Server)
- **Audio**: Web Audio API + Google Cloud Text-to-Speech
- **Animation**: Framer Motion
- **3D**: React Three Fiber (Avatars)
- **Native Wrapper**: Capacitor (Android)
- **Networking**: Socket.IO (Client & Server)
- **Hosting**: Netlify (Frontend) & Railway (Backend)
- **Database**: Redis (Session storage)

## Distribution Model

Bamboozle uses a **Hybrid Distribution Model**:

1. **Web (Free)**: Hosted on Netlify. Players can join games via browser without an account.
2. **Android App**: Powered by Capacitor. 
   - **Development**: Uses live-reload from the host machine.
   - **Production**: Bundles the code inside the app for performance and offline capability.
   - **Fullscreen**: Custom native implementation for immersive gameplay.
   - **Orientation**: Adaptive logic (Portrait for phones, Auto for tablets).

### Data Flow
1. **Host** acts as the game server for logic (in local dev mode) or coordinates with a backend server.
2. **Players** and **Audience** connect via WebSockets.
3. State is managed centrally in `useGameService`.
4. Updates are broadcast via `gameStateUpdate` events.

## Key Systems

### 1. Game State Management (`services/gameService.ts`)
The `useGameService` hook is the brain of the application. It:
- Manages the entire `GameState` object.
- Handles game phase transitions (LOBBY -> WRITING -> VOTING -> REVEAL).
- Processes player inputs (answers, votes, emotes).
- Syncs state with the server via `socket.emit('gameStateUpdate')`.

### 2. Networking & Online Play (`server/index.js`)
Real-time communication is powered by Socket.IO.
- **Rooms**: Players join rooms identified by a 4-letter code.
- **Events**:
  - `joinRoom`: Player entry.
  - `submitLie`: Player answer submission.
  - `submitVote`: Voting logic.
  - `playAudio`: Triggering TTS on all clients.
  - `hostEvent`: Host-specific actions (e.g., starting game).

### 3. Audio System (`services/audioService.ts`)
- **SFX**: Preloaded sound effects for game events.
- **TTS (Text-to-Speech)**:
  - **Local**: Uses browser `speechSynthesis` API as a fallback.
  - **Premium**: Uses Google Cloud TTS (Neural2 voices) generated on the server and hosted on **Google Cloud Storage (GCS)** for permanent caching and high-speed delivery.
- **Safari Compatibility**: A shared `Audio` element is unlocked via user gesture and reused for subsequent playback to prevent auto-play blocking.


### 4. Admin Dashboard (`views/AdminView.tsx`)
A secure (internal-only) dashboard for maintaining game assets.
- **Batch Generation**: Automates the process of pre-caching 1000+ voice lines.
- **Error Management**: Tracks failed TTS requests and enables bulk retries.
- **Cache Control**: Direct interface to clear or audit the GCS audio bucket.

### 5. UI/UX Design (`views/` & `components/`)
- **Responsive**: Mobile-first design ensures playability on phones. The Host view is optimized for large screens (TV/Projector).
- **Animations**: Framer Motion orchestrates smooth transitions between game phases.
- **Avatars**: 3D avatars are rendered using Three.js (via `@react-three/fiber`) based on a seed string.

## Directory Structure
- `/src/components`: Reusable UI elements.
- `/src/views`: Main game screens (Host, Player, Lobby).
- `/src/services`: Logic layers (Game, Audio).
- `/src/server`: Backend logic.
- `/src/types.ts`: TypeScript interfaces for State, Player, Question, etc.
