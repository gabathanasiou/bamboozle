# Design Lab

Status: **read this before changing the design lab or asking for visual QA.**

The Design Lab is a dev-only, in-app viewer/editor for every Bamboozle screen. It
mounts the **real production components** with deterministic fixture state, so a code
change in `views/`, `components/`, or the shared styles appears in the lab immediately.

- Open: `npm run dev` → <http://localhost:3000/designer>
- Preview target: `/designer/preview` (same-origin iframe)
- Roadmap: item 13 (design lab), item 14 (classic split-screen parity)

## 1:1 contract

| Lab does | Lab does not |
|---|---|
| Mount `OnlinePlayerView`, `HostView`, `PlayerView`, `HomeView`, `SettingsView`, `ChangelogModal`, `RoomManagerModal`, `OfflineView`, `AdminView` | Duplicate their JSX/CSS |
| Use the same shared components and Tailwind classes | Maintain a second design system |
| Run at the exact iframe viewport width/height | Fake responsiveness with a CSS-scaled div |
| Change fixture state, copy, role, phase, viewport | Write visual edits back into source |

Production components receive a few optional **preview props** (hide dev chrome, force
the join step, inject preview data). They are inert in normal app usage. The lab is
hidden outside dev builds; `VITE_DESIGNER=1` is available for an opt-in deployed preview.

## What it covers

**App shell:** Home (desktop/mobile), room manager modal (1–2 rooms), Settings
(dev section, premium voices, local server), Changelog (loaded/loading/error),
Offline, and the Admin console (Actions/Progress/Failures) with static data.

**Join:** code step, name step, saved-session card, code error, lobby vs in-progress.

**Game:** Lobby, Category, Intro, Writing, Voting, Reveal, Leaderboard, Game Over —
for **online** host/player/audience and the **classic** `HostView`/`PlayerView` set.
Reveal covers INTRO/CARD/VOTERS/AUTHOR × truth/lie; leaderboard covers
INTRO/REVEAL/LEADER. Host-disconnected and room-closed overlays are player-side.

## Controls

- **Screen / View:** pick the real component tree, then Online or Classic and the role.
- **Game state:** scoped to the selected screen. Lobby shows ready/total rounds;
  writing shows submitted lies/timer; voting shows player/audience voter counts/current vote;
  reveal shows stage + Found / Not found / Mistake and a people count;
  leaderboard shows score spread/stage. Unrelated controls are hidden.
- **Presentation:** language, overlay, narrator speaking, and emotes in a collapsed
  section (game screens only).
- **Content:** short/normal/long/extreme stress presets plus editable fact, category,
  truth answer, every lie, and player names — also scoped by screen. Overrides are
  cleared when you change the stress preset or press “Clear copy overrides”.
- **Viewport:** grouped Safari/Apple-style presets (iPhone, iPad, Mac, Desktop,
  Android, TV), drag handles, rotate, fit/100%, zoom. Presets use CSS viewport
  points, not panel pixels; Safari recommends a real simulator/device for exact
  safe-area and browser-chrome behaviour. The active Tailwind breakpoint
  (base / sm / md / lg / xl / 2xl) is shown next to the scene.
- **Motion:** the live app honours the OS `prefers-reduced-motion` setting. The
  lab’s Reduce motion toggle is on by default and can force full motion in the
  preview even when the OS prefers reduced.
- **Inspect:** overflow/clipped-text scan, outlines, hover inspector, issue markers,
  replay, reduced motion, mute.
- **Handoff skill:** the copy-paste request format is consumed by the project
  skill `.opencode/skills/design-lab-handoff/` (committed with the repo, since the
  lab is Bamboozle-only), which triages noise, maps selectors to shared
  components, and applies the intent as responsive code.
- **Live element editor:** toggle **Resize selected**, pick an element, then drag
  the yellow handle. The selected-element card also has **Font size** and
  **Line height** inputs. **Apply to similar** is on by default: changes are
  applied to every visible element with the same tag + class signature (shared
  components), and the handoff records the group count. This is a DOM heuristic,
  not a React tree: it can overmatch elements that happen to share classes, so
  toggle it off for a one-off. A grouped edit is one undo step. Changes are
  preview-only and reset when the scene remounts; use **Reset size**,
  **Reset all**, or **Copy resize request** so the agent can codify them.
  Live edits persist across viewport changes so you can compare the same adjusted
  design at another size. Use **Reset all** to return to the natural responsive
  layout; an element that stays fixed at a new viewport is an active inline edit,
  not a responsive bug.
- **Undo / redo:** header buttons and Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z (Ctrl+Y also
  redoes). This covers **live design edits only** — element box resize, font size,
  line height, grouped similar-element edits, reset size, and reset all. It
  deliberately does not undo screen, view, content, state, or viewport changes.
- **Live changes:** the Inspect panel lists every changed element with its
  before → after box/font sizes and a one-click resize request.
- **Share:** URL hash, copy JSON, paste JSON, copy agent brief, PNG export.

## Diagnostics

The scan runs inside the iframe and reports:

- page/root overflow;
- clipped text (unless it is an intentional `truncate`, line clamp, or scroll container);
- static/relative elements outside the viewport (scroll containers excluded).

Click an issue in the sidebar to scroll to and flash the element. The inspector shows
the CSS selector, rect, font metrics, overflow, scroll size, and text. “Show issues”
controls the red markers; “Outlines” outlines every element.

Safe-area insets (`env(safe-area-inset-*)`) are **not** simulated. Check a real iPhone
for notch/home-indicator behaviour.

## Agent bridge

The parent window exposes `window.__bamboozleDesigner`:

```js
window.__bamboozleDesigner.setScene('reveal', {
  view: 'online-player',
  game: { revealStage: 'VOTERS', revealOutcome: 'mistake', revealVoters: 2 },
  viewport: { preset: 'iphone-14-pro', width: 393, height: 852 },
});
window.__bamboozleDesigner.apply({ contentLength: 'extreme', language: 'el' });
window.__bamboozleDesigner.scan();
window.__bamboozleDesigner.getDiagnostics();
window.__bamboozleDesigner.undo();
window.__bamboozleDesigner.redo();
window.__bamboozleDesigner.getEditHistory();
window.__bamboozleDesigner.getResize();
window.__bamboozleDesigner.getResizeChanges();
window.__bamboozleDesigner.getAgentBrief();
```

Playwright recipe:

```ts
await page.goto('/designer');
await page.evaluate(() => window.__bamboozleDesigner?.setScene('writing', {
  view: 'online-player',
  contentLength: 'extreme',
  game: { players: 6, audience: 8 },
}));
const frame = page.frameLocator('[data-testid="designer-preview"]');
await frame.getByRole('button', { name: /submit/i }).screenshot();
```

“Copy agent brief” emits the current screen, role, viewport/breakpoint, content/state,
diagnostics, selected element, live resize changes, notes, and the reproducible URL.
Use the notes field for the specific change you want.

## Resize handoff

After a live box/font change, **Copy resize request** emits the exact handoff:

```md
# Bamboozle resize request
- Scene: lobby · online-player
- Viewport: 393×852 · base breakpoint

## Live changes (preview only)
- `#designer-preview-root > …`
  - box 97×20 → 161×48
  - font 14px/20px → 22px/20px
  - text: ROOM: BAMZ

Apply the intent at the base breakpoint, using responsive Tailwind/code rather
than blind inline pixels. Verify this viewport plus adjacent breakpoints.
```

The agent should reproduce the URL, read `getResizeChanges()` / `getElement()`,
translate the intent to responsive classes, and verify the same viewport plus
`md`/`lg`. Do not persist the lab's inline pixels as a one-off unless that
really is the intended responsive rule.

## URL / JSON

The full config is encoded in the URL hash (`#cfg=…`) and mirrored to localStorage.
Opening the link restores the exact scene. JSON copy/paste is the same config shape
and is normalized/clamped on apply. `DEFAULT_CONFIG` lives in `designer/types.ts`.

## Architecture

| File | Role |
|---|---|
| `designer/types.ts` | Config, preview models, diagnostics types, defaults |
| `designer/catalog.ts` | Screens, views, viewport presets, EN/EL stress copy |
| `designer/fixtures.ts` | Deterministic `GameState`/app models, no-op actions |
| `designer/bridge.ts` | Config normalization, URL codec, postMessage, agent API |
| `designer/DesignerView.tsx` | Parent shell, state, bridge, header/footer |
| `designer/ControlPanel.tsx` | Sidebar controls |
| `designer/PreviewFrame.tsx` | Iframe, fit/scale, resize handles, messaging |
| `designer/PreviewSurface.tsx` | Child renderer, inspector, scan, PNG export |
| `designer/diagnostics.ts` | DOM scan and element description |
| `designer/ui.tsx` | Lab-only controls |

Flow: parent `config` → `postMessage` → iframe `PreviewSurface` → `buildPreviewModel`
→ real component. Diagnostics and selected elements travel back by `postMessage`.

## Extending

1. Add the screen/state to `ScreenId` and `SCREENS`/`SCREEN_GROUPS`.
2. Add fixture data in `designer/fixtures.ts` (keep it deterministic — no
   `Date.now()`/`Math.random()`).
3. Add controls in `ControlPanel.tsx` and a render branch in `PreviewSurface.tsx`.
4. If a production component needs preview-only data, add an optional prop with a
   production-safe default; never fork the visual implementation.
5. Add the case to `designer/fixtures.test.ts` so the coverage test fails when a new
   phase is added without a scene.
6. Run `npm run test:unit`, `npm run build`, `npm run lint`.

## Testing

- Unit: `designer/fixtures.test.ts` covers every screen × view, reveal/leaderboard
  stages, app states, content-length ordering, URL round-trip, and clamping.
- Visual: the lab itself is the manual harness. Follow `docs/TESTING.md`; no e2e visual
  spec is added by default.
- PNG export uses the existing `html-to-image` dev dependency.

## Deliberate non-goals

- No Storybook/Ladle/React Cosmos: the unit is game state, not an isolated component.
- No click-to-source plugin: the maintained React 19 plugin needs Vite 7/8, this repo
  is on Vite 6. Revisit after a Vite upgrade.
- No persisted CSS/class editing: the agent edits source and the lab verifies it.
- Agentation annotation/MCP is deferred; the extension point is the preview iframe.
