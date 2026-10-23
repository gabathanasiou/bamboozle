---
name: design-lab-handoff
description: Turn a pasted "Bamboozle resize request" (design-lab handoff block from /designer) into responsive source changes. Use when the user pastes a resize request or a "Live changes (preview only)" list, says "apply this handoff", "these are the changes I want", "copy request", or asks to codify live lab edits into Tailwind/code. Project skill for this repo's design lab; not for general CSS work.
---

# Design-lab handoff

**Project skill.** Lives at `.opencode/skills/design-lab-handoff/` and ships with the
repo, because `/designer` is a Bamboozle-only feature. Paths below are relative to
the repo root.

The lab (`/designer`, see `docs/DESIGN_LAB.md`) lets the user drag elements, change
font size and line height, and then **Copy resize request**. That block is a
measurement dump, not a spec. Your job is to recover the intent, then express it
once in the shared component with responsive classes.

## Read the header first

```
- Scene: gameOver · online-host
- Viewport: 440×956 · base breakpoint
- Language: EN · Content: extreme
Reproduce: http://localhost:3000/designer#cfg=...
```

- **Scene / view** pick the source file and the renderer state.
- **Viewport / breakpoint** say where the user was looking. Changes apply at that
  breakpoint; everything else keeps its current behaviour.
- **Content: extreme** means the fixtures were stress-filled (long names, long
  answers). A box that only fits with normal copy is not fixed.
- **Reproduce URL** is the exact state to verify in. Load it before touching code.

## Triage every entry before coding

Keep an entry only if it describes a real, wanted change. Drop:

| Signal | Why it is probably noise |
|---|---|
| Avatar `56×56 → 70×87` | Non-uniform resize distorts the character. Square it. |
| Parent and child moved in opposite directions | Exploratory drags; the child size follows the parent, not an independent wish. |
| `box A×B → A×B` with a font change | Only the type changed; keep the box rule alone. |
| `similar elements: 6` on every node in a list | One shared component change, not six entries. |
| New width larger than the viewport | Leftover from an older viewport; applying it recreates overflow. |
| `text:` contains `.animate-bounce-subtle { … }` | Stale lab build leaking `<style>` text. Refresh and recapture; never treat CSS as copy. |
| A single 1–2px delta | Measurement jitter, not design intent. |

If two entries conflict, prefer the one on the element that owns the layout
(parents size children) and treat the child as reflow. When the intent is still
ambiguous, ask one short question — do not average the numbers.

## Map the breadcrumb to real source

The selector is a DOM path inside `[data-designer-app]`, not a React path.
Resolve it in this order:

1. Identify the scene's renderer (`views/OnlinePlayerView.tsx`,
   `views/PlayerView.tsx`, `views/GameSharedComponents.tsx`,
   `views/SettingsView.tsx`, …) and the component that renders the repeated block.
2. Use the visible `text:` fragment to `grep` the repo when the path is unclear.
3. Confirm shared vs scene-local: a component used by both host and player views
   must be fixed once in the shared file, never duplicated per view.
4. Note the element's role in the chain: page → card → row → avatar → badge. A
   change to a row must not fight the card's padding or the grid's gap.

## Write it as responsive code

- Base breakpoint = unprefixed class. Preserve the existing `md:` / `lg:` values
  unless the user explicitly wants them changed too.
- Translate sizes into the nearest Tailwind step or matching pair, e.g.
  row `112 → 72` becomes `p-2 md:p-4`, `border-b-4 md:border-b-8`, and a
  `52px` base avatar with `72px` at `md`.
- Never paste the lab's inline pixels as `style=` or one-off `!w-[398px]`. Use
  padding, gap, grid, `max-w`, and `w-full` so the block keeps filling the screen.
- Keep avatars square: `!w-[52px] !h-[52px] md:!w-[72px] md:!h-[72px]`.
  `components/Avatar.tsx` sets inline `width`/`height`, so a responsive override
  needs the `!` prefix (or a static `size={n}` when no breakpoint change is needed).
- Prefer trimming vertical chrome (padding, border, avatar, line-height) over
  shrinking text until it is unreadable.
- If the change only makes sense at one breakpoint, still check the next two.

## Verify

1. Start the dev server (`npm run dev`) and open the reproduce URL.
2. Measure the changed element in the preview frame — the target box, not a guess:

   ```js
   const frame = page.frames().find(f => f.url().includes('/designer/preview'));
   await frame.evaluate(() => {
     const li = document.querySelector('ul li');
     const r = li.getBoundingClientRect();
     return { w: Math.round(r.width), h: Math.round(r.height) };
   });
   ```

3. Re-run the same measurement at the adjacent breakpoints (`base`, `md`, `lg`),
   e.g. 440×956, 820×1180, 1920×1080.
4. `window.__bamboozleDesigner.getDiagnostics()` must report `issues: []` —
   check overflow and clipped text, especially with `Content: extreme`.
5. `npm run test:unit`, `npm run build`, `npm run lint`.
6. Screenshot the scene and compare it with the edited lab state before
   committing.

## Commit

One handoff per commit, imperative message, no mention of the lab's raw numbers:

```
feat: compact game-over leaderboard rows on mobile
fix: keep reveal voter avatars square at base
```

State in the reply what was applied, what was deliberately dropped and why, the
measured result at each breakpoint, and that live lab edits stay preview-only.

## Known repo traps

- `getAdaptiveTextClass()` returns only `break-words`, so a base text size passed
  to it can be ignored — add explicit `text-*` classes.
- Live lab edits persist across viewport changes and reset on scene remount.
  Reset them (**Reset all**) before concluding a box is broken.
- `Avatar` is shared by lobby, reveal, game-over, and audience views; a size
  change there hits every screen.
- `main` is not always the branch the lab was captured on. Check
  `git branch --show-current` and `git log --oneline -3` before editing; the
  Cloudflare branch may not have the lab at all.
