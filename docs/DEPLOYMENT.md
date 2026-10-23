# Bamboozle Deployment Guide

Status: phase 1 — production realtime and TTS run on the Cloudflare Worker; Railway is decommissioned. Migration history is in `docs/CLOUDFLARE_MIGRATION_PLAN.md` §13.

## Deployed pieces

| Piece | Where | Notes |
|---|---|---|
| Frontend | Netlify (`bamboozlegame`) | `VITE_SERVER_URL` baked at build time |
| Realtime + TTS | Cloudflare Worker `bamboozle-rooms` | Workers Free + Durable Objects (SQLite) |
| Audio cache | `gs://bamboozle-audio-assets` | 3,159 existing MP3s; do not change the MD5 key |
| Rollback | Worker deployments | `npx wrangler rollback`; Railway is decommissioned |

- Worker: `https://bamboozle-rooms.gabathanasiou.workers.dev`
- Health: `/health`, version: `/api/version`, TTS: `POST /api/tts`, sockets: `/ws`

## Local development

```bash
# terminal 1 — Worker on :8787
cd workers/bamboozle-rooms
npm install
cp .dev.vars.example .dev.vars          # or create it with the secret below
npm run dev

# terminal 2 — frontend on :3000
npm run dev                             # defaults to http://localhost:8787

# unit tests
npm run test:unit                       # client-adapter tests (root)
npm run test:worker                     # workerd/DO tests
npm run test:e2e                        # Playwright starts the Worker + preview

# protocol/TTS smoke against a running Worker
cd workers/bamboozle-rooms && npm run smoke
```

`.dev.vars` (gitignored) needs the compact service-account JSON:

```text
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account",...}
```

The old local server (`node server/index.js`, :3001) still works as rollback: enable **Settings → Developer Mode → Use Local Server** and set `http://localhost:3001`.

## First-time Worker setup

```bash
cd workers/bamboozle-rooms
npm install

# One KV namespace is used only for the short-lived Google access token.
npx wrangler kv namespace create TTS_KV
# put the returned id in wrangler.toml under [[kv_namespaces]]

npx wrangler deploy
node -e "const fs=require('fs');process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync('../../google-credentials.json','utf8'))))" \
  | npx wrangler secret put GOOGLE_APPLICATION_CREDENTIALS_JSON

# Optional ops-only TTS API. Without this secret POST /api/tts returns 404.
# Generate a long random value and keep it out of git:
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" \
  | npx wrangler secret put TTS_API_TOKEN
```

Rotate `TTS_API_TOKEN` every 90 days (or immediately if it appears outside
`wrangler secret`): generate a new value, run `wrangler secret put` again, then
update the caller. The old value stops working as soon as the new secret is
deployed; there is no dual-token window.

`wrangler.toml` already declares:

- `ROOMS` → `BambooRoom`, `DIRECTORY` → `Directory`, migration tag `v1`, `new_sqlite_classes`
- `AUTH_MODE = "none"` (phase 1 only)
- `GCS_BUCKET_NAME = "bamboozle-audio-assets"`
- `ALLOWED_ORIGINS`: Netlify production, deploy-preview pattern, localhost, Capacitor
- `HOST_GRACE_MS`, `PLAYER_KICK_MS`, `EMPTY_ROOM_MS` (default 60000; e2e overrides to 8000)
- `TTS_DAILY_CHARS = "50000"`, `TTS_IP_DAILY_CHARS = "5000"` (shared by the ops
  API and room narration; cache hits are free)
- `TTS_DAILY_REQUESTS = "5000"`, `TTS_IP_DAILY_REQUESTS = "500"` (durable
  request caps; they also cover cache hits)
- `MAX_SOCKETS_PER_IP`, `MAX_SOCKETS_TOTAL`, `MAX_TOTAL_ROOMS`,
  `MAX_CREATES_PER_HOUR = "10"`, `MAX_PLAYERS_PER_ROOM`, `MAX_AUDIENCE_PER_ROOM`,
  `MAX_STATE_BYTES` (abuse caps)

Rollout note: rooms indexed before the host-secret deploy have no hash and can
never be reclaimed. The Directory drains them on the next sweep/create; hosts
active across that deploy get a fresh room. This is a one-time loss, not a
recurring migration.

## CI gate

`.github/workflows/ci.yml` runs on every PR and on pushes to `main`: app lint
(roadmap + doc budget), `tsc --noEmit`, unit tests, worker typecheck/tests, the
production build, then Playwright. `main` is protected against force pushes and
deletion, and the `Lint, typecheck, test, build` check is required on any PR.
Routine work may be merged locally and pushed directly to `main`; CI still runs
on every push, so check that run after pushing. Prefer a PR when the change is
risky or needs review. Netlify no longer builds on push (see Netlify), so
merging and shipping are separate steps.

The root `tsconfig.json` excludes `workers/**` (the Worker has its own tsconfig)
and the unused `data/_oldquestions.ts` backup; the live question banks are
`i18n/questions/{en,el}.ts`.

## Netlify

Production, branch deploys, deploy previews and local builds all use the Worker URL:

```bash
npx netlify env:set VITE_SERVER_URL https://bamboozle-rooms.gabathanasiou.workers.dev \
  --context production branch-deploy deploy-preview dev
npm run build
npx netlify deploy --prod --dir=dist --no-build
```

Automatic builds are off (`build_settings.stop_builds = true`): pushes to `main`
and PRs produce no deploy and no deploy preview. Shipping is the three lines
above, on demand; for a throwaway preview URL run `npx netlify deploy --dir=dist`
(draft, no `--prod`). To re-enable, PATCH the site with the **full**
`build_settings` object — a partial one is accepted but silently ignored.

`VITE_SERVER_URL` is baked at build time: after changing it, rebuild and
redeploy, or the old URL stays in the bundle. `netlify deploy --build` may
rebuild without your shell env; either export `VITE_SERVER_URL` for the build or
set it in the Netlify UI. Both the production origin and the preview pattern
(`https://<deploy-id>--bamboozlegame.netlify.app`) are already allowed by the
Worker's `ALLOWED_ORIGINS`.

CORS/WS origins are never `*` in production. Add a custom domain to
`ALLOWED_ORIGINS` before pointing DNS at it.

## Google Cloud

1. Keep the existing public bucket `bamboozle-audio-assets`.
2. The service account needs **Storage Object Admin** and **Cloud Text-to-Speech API User**.
3. Never commit `google-credentials.json`; production uses `wrangler secret`.
4. GCS object names stay `md5(text + "-" + language).mp3`. Changing the hash orphans
   the existing 3,159 lines and re-bills every phrase.

### Cost guardrails (required once)

The Worker limits the ops API to 50k characters/day (5k/IP/day) and the room path
only synthesizes host narration, but the project-level quota and budget are the
last line of defence:

1. **Hard TTS quota** — Console → APIs & Services → Cloud Text-to-Speech API →
   Quotas → set the characters/requests-per-minute limits to a value that matches
   normal play (for example 1,000 characters/minute per project). A per-minute
   quota caps a runaway loop even if the application limits are bypassed.
2. **Budget + alert** — Billing → Budgets & alerts → create a budget for the
   project with 50/80/100% thresholds and an email/Pub/Sub notification. Example:

   ```bash
   gcloud billing budgets create \
     --billing-account=BILLING_ACCOUNT_ID \
     --display-name="Bamboozle TTS" \
     --budget-amount=5GBP \
     --filter-projects=projects/PROJECT_ID \
     --threshold-rule=percent=0.5 \
     --threshold-rule=percent=0.8 \
     --threshold-rule=percent=1.0
   ```

3. Record the project, quota and budget ids here when set: `PROJECT_ID=`,
   `BILLING_ACCOUNT_ID=`, `BUDGET_ID=`.

## Rollout / rollback

1. Preview (done): Worker deployed, Netlify deploy-preview points at it.
2. Manual checklist (done): see `docs/CLOUDFLARE_MIGRATION_PLAN.md` §12.
3. Production cutover (done 2026-10-23): Netlify production `VITE_SERVER_URL` is the Worker.
4. After a stable week, archive the legacy `server/` directory (do not delete history).
5. Rollback: redeploy the previous Worker version
   (`cd workers/bamboozle-rooms && npx wrangler rollback`). Railway is
   decommissioned and cannot be used as a rollback target.

## Verification

```bash
curl https://bamboozle-rooms.gabathanasiou.workers.dev/health
cd workers/bamboozle-rooms
SMOKE_URL=https://bamboozle-rooms.gabathanasiou.workers.dev npm run smoke
npx wrangler tail
```

Healthy signs: `[TTS] CACHE HIT`, `[Room] close <CODE> reason=...`, no `INTERNAL_ERROR`
or `TTS_CREDENTIALS_INVALID_JSON` in the tail.
