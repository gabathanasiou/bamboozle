# Known Test Failures — Triage & Fix Plan

Status: **no known failures on record.** Add an entry here when a failure is
pre-existing/flaky and you have diagnosed it, so the next agent doesn't re-debug it.

## Summary

| Spec | Test | Root cause | Kind |
|---|---|---|---|
| _(none)_ | | | |

## Drift causes worth knowing

Fill these in as they bite; keep each entry short (symptom → cause → fix).

### A. Selector drift

- Symptom: a locator times out after a UI refactor.
- Cause: the test targeted an implementation detail (class, tag, structure).
- Fix: target a role/label/test id; add `data-testid` if none exists.

### B. Geometry / viewport

- Specs run Desktop Chrome at the configured viewport. A click can land off-screen on
  tall content — `scrollIntoViewIfNeeded()` first, or use a role-based click.
- Only assert geometry that matters (overflow, clipping, fixed chrome).

### C. Timing

- A bare `waitForTimeout` passed locally and failed under load. Replace with
  `expect.poll` / `waitForFunction`; keep a sleep only for real drag/canvas pacing.

## How to triage

1. `npm run test:smart -- --list` — is the failing spec even selected?
2. Re-run the single spec.
3. `npm run test:baseline -- <spec>` — clean HEAD, isolated port.
4. Read the trace; fix the test or the app, then record the cause here.
