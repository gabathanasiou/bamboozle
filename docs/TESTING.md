# Testing — Agent Manual

Status: **read this before writing, changing, retiring, or debugging tests.**
`playwright.config.ts`, `vitest.config.ts`, and `scripts/smart-test.mjs` are the harness;
this file is the policy. Imported from the portable `repo-quality-kit`.

## Mental model

1. **The suite is the app's regression net, not a spec of everything.** Keep it fast and
   trustworthy: a small unit layer, a few integration probes, and a thin e2e layer.
2. **Two-run cost is the enemy.** Retries absorb transient flake; chronic flake is
   **quarantined**, not tolerated.
3. **A red run is not proof of a regression.** Answer "was it me?" with smart-test
   selection + a clean-HEAD baseline — never by `git checkout` (it destroys work).

## Test sizes & the pyramid

The industry model (~70% unit / 20% integration / 10% e2e) exists because feedback must
be fast, reliable, and failure-isolating.

| Size | Here | Use it for | Cost |
|---|---|---|---|
| **Small / unit** | Vitest — `npm run test:unit`, `**/*.test.ts`, node env | Pure logic: parsers, state reducers, scoring, validation, i18n, date/time math | ~ms, hermetic |
| **Medium / integration** | e2e specs driven by a debug bridge/API, minimal DOM | One surface + its state: a form commits, a room joins, a record persists | seconds |
| **Large / e2e** | Playwright — boot, cross-surface flows, real browser behaviour | Auth flows, drag/canvas, print, overlay geometry, mobile/touch | tens of seconds, flaky-prone |

**Rule of thumb:** if a bug can be reproduced without a browser, it belongs in a unit
test; keep ONE e2e test proving the feature is wired end-to-end. Never assert the same
behaviour at both layers — when you move a case down, retire the e2e case.

### Bamboozle specifics

- **Unit (Vitest):** `i18n/` (`getQuestions`, `getText`, `getNarratorPhrase`,
  `getBotNames`), pure game/scoring helpers as they are extracted, the server rules
  (`sanitize`, room-code generation, rate limiting) once moved to an importable module,
  and the TTS cache key (**must stay `md5(text + "-" + language)`**).
- **Worker (phase 1+):** `BambooRoom` / `Directory` protocol and alarm logic belong in
  `workers/**/*.test.ts` with `@cloudflare/vitest-pool-workers` — not in the browser.
- **e2e (Playwright):** home smoke now; then a two-context host/player room flow against
  the local server (`node server/index.js`, `:3001`) or the Cloudflare Worker once it
  ships. Reconnect/grace/cap cases are integration probes, not visual tests.
- **Manual:** visuals, animations, 3D avatars, audio unlock on iOS, and the reveal
  choreography — a human can confirm those by looking.
- **Legacy note:** `server/` is Railway/Socket.IO until the Cloudflare phase-1 checklist
  passes. When it is replaced, point `VITE_SERVER_URL` at `wrangler dev` and move the
  realtime specs to a separate config (keep `e2e/` capped).

## When to add a test (rubric)

Add one when it changes a future decision — a reasonable change could break it without
anyone noticing. Concretely:

1. **New user-visible behaviour or invariant** (persistence, computed value, ordering).
2. **A bug fix** — a regression test that fails before the fix and passes after.
3. **A hard-won edge case** (timezone boundary, empty state, retry path).

Do **not** add a test when:

- **The user can confirm it by looking.** A new label, icon, colour, spacing, menu item,
  or "the panel opens" is a manual check, not a browser test.
- It asserts implementation detail (CSS class, internal state shape) rather than
  user-visible behaviour.
- It duplicates an existing spec's coverage — extend that spec instead.
- It is a one-off probe for an investigation. Scratch file, not a spec.
- It can only "pass" by sleeping (`waitForTimeout`) — make it deterministic or don't add it.

## Manual verification (the user has eyes)

When a change is visually verifiable, **do not write a test — ask the user to verify it.**
End the task with a short numbered check (exact clicks + expected result):

> **Please verify manually (~30s):**
> 1. Open Settings → Theme.
> 2. Confirm "Dark" sits below "System".
> 3. Click it — the page switches without a reload.

Automate only when a silent break is plausible: data loss, wrong computed value,
persistence/round-trip, cross-surface propagation, or geometry that only fails at scale.

## Selector strategy (keeps tests from drifting)

Prefer, in order: `getByRole` / `getByLabel` / `getByText` → `getByTestId` → `[data-*]` →
**last resort** a stable class. Never use inline-style (`[style*=…]`), utility-class
(`div.flex-…`), parent (`..`), or `[class*=…]` selectors. When a component has no stable
hook, add a `data-testid` (and a `TEST_IDS` entry if the repo has one) rather than a
structural selector.

## Harness facts

- `playwright.config.ts` runs the **production preview** by default on port `4173`
  (`PLAYWRIGHT_DEV=1` uses the dev server instead) and starts the Cloudflare Worker on
  `:8787` with 8s grace/kick windows. Every run owns its servers
  (`reuseExistingServer: false`) so a foreign process fails fast instead of being tested.
  `PLAYWRIGHT_PORT=<n>` isolates the app port.
- Worker tests run in workerd via `npm run test:worker`; root `test:unit` excludes
  `workers/**` because it is a node-environment suite.
- Playwright launches Chromium with `--disable-speech-api --mute-audio`; the realtime
  spec installs a silent fake `speechSynthesis` so narration never reaches the host's
  speakers and the reveal advances immediately.
- Retries: 1 locally / 2 on CI; `trace: 'on-first-retry'`; `reducedMotion: 'reduce'`;
  `@perf` and `@quarantine` are excluded by default.
- `npm run test:smart` selects only specs the diff can affect (RULES map in
  `scripts/smart-test.mjs`), plus canaries and the last run's failures. `--list` prints
  the selection; `--full` runs everything.
- `npm run test:baseline -- e2e/<spec>.spec.ts` runs a spec against a clean `HEAD`
  worktree on an isolated port (symlinked `node_modules`), without touching your tree.
- Unit tests are co-located (`**/*.test.ts`) and run in node. `npm run test:coverage`
  is a guide for where the next unit test pays off, not a gate.
- Suite caps live in `scripts/check-doc-budget.mjs` (specs/tests) and fail `lint` when
  exceeded. Growth must be deliberate.
- CI (`.github/workflows/ci.yml`) runs on every PR and on `main`: lint, app
  typecheck, unit, worker typecheck/tests, build, Playwright. `main` requires that
  job, so the gate is the merge gate — see `docs/DEPLOYMENT.md` §CI gate.

## Rules (MUST NOT)

1. **Fixtures are seed-agnostic.** If a fixture exists, resolve ids/names/counts from it;
   never hardcode its content, so it can be swapped.
2. **Web-first assertions.** Prefer `expect` / `expect.poll` / `waitForFunction` over
   `waitForTimeout`. Only true interaction pacing (drag settle, canvas repaint) may wait,
   with a comment saying why.
3. **State reads go through the app's debug bridge/API** when one exists — sync, no
   debounced-save waits. Use a persistence helper only when persistence is under test.
4. **One spec base name per feature**, registered in `scripts/smart-test.mjs` RULES.
   A spec not in the map is an orphan: `npm run lint` fails.
5. **Never `git checkout` / `git stash` to test a baseline.** Use `npm run test:baseline`.
6. **Never leave a chronically flaky test retrying forever.** Quarantine it (tag +
   registry below).
7. **Retire dead specs.** A spec for removed behaviour is deleted — git preserves it.

## Flake policy

- **Transient** (passes on retry): leave it; the retry + trace handles it.
- **Chronic** (fails on repeated runs, unrelated to the diff):
  1. Tag the spec/test `@quarantine` (excluded from the default suite immediately).
  2. Record it in the registry below: spec · test · why · date · owner.
  3. Fix or delete it. A quarantined test nobody fixes is debt with a name.

### Quarantine registry

| Spec · test | Why | Since |
|---|---|---|
| _(none)_ | | |

## "Was it me?" workflow (red run)

1. **Did smart-test select it?** If the failing spec isn't in
   `npm run test:smart -- --list`, your change can't reach it — pre-existing/flaky.
2. **Re-run just that spec.** The retry often clears it.
3. **Baseline without touching your tree:** `npm run test:baseline -- e2e/<spec>.spec.ts`.
   Fails there too → pre-existing; passes there → your diff.
4. **Read the trace** from the first retry (`test-results/**/trace.zip`) before guessing.
5. Genuinely yours → fix it; flaky → quarantine it in the same change.

## Adding a spec

Adding is **deliberate, not automatic** — e2e is the expensive layer and the suite is
capped. In order of preference:

1. **Extend an existing spec** in the same area.
2. **Push the logic down to a unit test.**
3. **Merge** two tiny single-test specs for the same surface.
4. Only if the behaviour is genuinely new and UI-wired: add the spec, then prune
   something or consciously raise the cap (with a one-line reason).

Mechanics:

- Navigate via `baseURL` (`page.goto('/')`) — never a literal `http://localhost:…`.
- Keep a spec under ~300 lines; use shared helpers.
- Register its base name in `scripts/smart-test.mjs` and, if it guards a module, add a
  RULES entry (or `ALL` for core).
- `npm run lint` must pass; run the spec + canary before done.

## Verification

1. `npm run lint` — roadmap + docs + e2e hygiene.
2. `npm run test:unit`.
3. The touched spec(s) + the canary.
4. Full suite before done for logic/data/store changes.
