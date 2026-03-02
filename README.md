<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1PPv_q90q-7H5lO9aANaXaVBljBuSCMtD

## Documentation

- [Technical Overview](docs/TECHNICAL.md): Detailed information about the architecture, audio system, and Safari compatibility.
- [Architecture](docs/ARCHITECTURE.md): High-level overview of the tech stack and system design.
- [Android & Capacitor](docs/CAPACITOR_ANDROID.md): Guide for the native Android app, bundling, and deployment.
- [Game Systems](docs/GAME_SYSTEMS.md): Explanation of the game loop, phases, and logic.
- [Networking](docs/NETWORKING.md): Guide to Socket.IO events and synchronization.
- [Best Practices](docs/BEST_PRACTICES.md): Coding standards and guidelines.
- [Multiplayer Plan](docs/MULTIPLAYER_PLAN.md): The master roadmap for Online Friends Mode and monetisation.
- [Implementation Plan](plan.md): The original plan for Online Friends Mode.

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

---

## 🛠 Admin & Asset Management

The project includes a persistent audio caching system using Google Cloud Storage.
- **Admin Dashboard**: Access at `/admin` to manage the audio cache.
- **Static Generation**: Pre-generate all narrator voice lines and trivia questions to minimize costs.
- **Monitoring**: Real-time tracking of cloud storage uploads and API health.

---

## 🤖 AI Agent Guidelines

**ATTENTION AGENTS:** If you are a coding assistant working on this repository, you **MUST** follow these guidelines.

### 1. Consult the Knowledge Base
Before starting any task, read the relevant documentation in the `docs/` folder.
- **New Feature?** Read `docs/ARCHITECTURE.md` and `docs/GAME_SYSTEMS.md`.
- **Bug Fix?** Read `docs/TECHNICAL.md` for known quirks (especially Audio/Safari).
- **Refactoring?** Follow `docs/BEST_PRACTICES.md`.

### 2. Use Available Skills
Reference the skills located in `.agent/skills/` to perform complex tasks correctly:
- **`documentation-standards`**: **REQUIRED READ.** Defines the coding style and documentation rules.
- **`create-game-action`**: Use this when adding new events (e.g., "Use Powerup").
- **`manage-game-phases`**: Use this when adding new game states (e.g., "Wager Phase").
- **`narrator-management`**: Use this for anything related to TTS, Audio, or Narrator voice lines.

### 3. Update Documentation
**CRITICAL:** If you modify the codebase, you **must** update the corresponding documentation.
- Changed an event? Update `docs/NETWORKING.md`.
- Changed the game loop? Update `docs/GAME_SYSTEMS.md`.
- Added a new system? Create a new markdown file in `docs/` and link it here.

**Do not leave the documentation stale.** Future agents rely on your updates.
