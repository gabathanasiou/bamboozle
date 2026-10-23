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
- [Networking](docs/NETWORKING.md): Native-WebSocket envelope, events, acks and reconnect lifecycle.
- [Deployment](docs/DEPLOYMENT.md): Cloudflare Worker + Netlify, secrets, deploy and rollback.
- [Server Hardening](docs/SERVER_HARDENING.md): Room caps, rate limits, sanitisation, alarms and free-tier limits.
- [Best Practices](docs/BEST_PRACTICES.md): Coding standards and guidelines.
- [Multiplayer Plan](docs/MULTIPLAYER_PLAN.md): The master roadmap for Online Friends Mode and monetisation.
- [Cloudflare Migration Plan](docs/CLOUDFLARE_MIGRATION_PLAN.md): Phase 1 — move the realtime backend off Railway to Workers + Durable Objects (free tier).
- [Roadmap](docs/ROADMAP.md): Open work only; completed items live in [the archive](docs/ROADMAP-ARCHIVE.md). The portable workflow is [Roadmap Kit](docs/ROADMAP-KIT.md).
- [Testing](docs/TESTING.md): The pyramid, when to add a test, flake policy, and the local harness. Known drift causes live in [Known Test Failures](docs/KNOWN-TEST-FAILURES.md).
- [Asset Generator Guide](docs/ASSET_GENERATOR.md): How to use the built-in branding tool.
- [Android Asset Guide](docs/ANDROID_ASSET_GUIDE.md): Practical steps for native graphics integration.
- [Implementation Plan](plan.md): The original plan for Online Friends Mode.

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Start the realtime Worker in `workers/bamboozle-rooms/` (`npm install && npm run dev`) and the app (`npm run dev`); the client defaults to `http://localhost:8787`.
4. For the legacy Express/Socket.IO server, enable **Settings → Developer Mode → Use Local Server** and point it at `http://localhost:3001`.

---

## 🛠 Admin & Asset Management

The project includes a persistent audio caching system using Google Cloud Storage.
- **Admin Dashboard**: Legacy dev-only `/admin` (talks to the Express server, not the Worker). Cache keys must stay `md5(text + "-" + language).mp3`.
- **Asset Generator**: Run `npm run asset-generator` to create high-res icons and splash screens.
- **Native Smart Build**: Run `npm run android:build` to build the app and intelligently update graphics.
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
