# Bamboozle Game Systems Documentation

Status: reference — game loop/phases.

## Game Loop & Phasing

The game logic in Bamboozle is organized into distinct phases managed by `services/gameService.ts`.

### 1. **LOBBY** (`GamePhase.LOBBY`)
- **UI**: Room code display, player join list.
- **Actions**:
  - `joinRoom`: Players join.
  - `addBot`: Host adds simulated bots.
  - `startGame`: Host transitions to `INTRO`/`WRITING`.

### 2. **Question Phase** (`GamePhase.WRITING`)
- **Logic**:
  - Selects an unused question through `services/questionPicker.ts` (least-recently-
    offered categories + per-category bags, so nothing repeats until its pool is
    exhausted).
  - Displays the fact with `<BLANK>` placeholders.
- **Actions**:
  - `submitLie`: Players input their funny answers.
  - **Timer**: A countdown timer forces submission if time runs out. Bots auto-submit.

### 3. **Voting Phase** (`GamePhase.VOTING`)
- **Logic**:
  - Collects all lies + the correct answer (`Question.answer`).
  - Shuffles the options.
- **UI**: Displays list of answers on Host screen. Players vote on their devices.
- **Actions**:
  - `submitVote`: Choosing the "truth".

### 4. **Reveal Phase** (`GamePhase.REVEAL`)
- **Key Component**: `RevealSequence` (in `views/GameSharedComponents.tsx`).
- **Logic**:
  - Iterates through answers one by one.
  - Shows who wrote the lie (or if it's the truth).
  - Shows who voted for it.
  - Awards points based on votes and finding the truth.
- **Scoring**:
  - **Fooling**: +Points for every vote your lie gets.
  - **Truth**: +Points for finding the correct answer.

### 5. **Leaderboard** (`GamePhase.LEADERBOARD`)
- **UI**: Shows current scores and rankings.
- **Transition**: Host clicks "Next Round" or "End Game".

### 6. **End Game** (`GamePhase.GAME_OVER`)
- **UI**: Final winner celebration.
- **Actions**: Host can return to Lobby or Play Again.

## Progression Manager (`services/ProgressionManager.ts`)
Handles the timing and automatic transitions between sub-phases (especially during the Reveal sequence). It uses timeouts and `onAudioEnded` callbacks to synchronize narration with visual updates.

## Localization (`i18n/`)
- Supports **English** (`en`) and **Greek** (`el`).
- **Questions**: Loaded from `i18n/questions/index.ts` (stable IDs from the fact text).
- **UI Text**: Loaded from `i18n/index.ts` using `getText()`.
