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
```

`wrangler.toml` already declares:

- `ROOMS` → `BambooRoom`, `DIRECTORY` → `Directory`, migration tag `v1`, `new_sqlite_classes`
- `AUTH_MODE = "none"` (phase 1 only)
- `GCS_BUCKET_NAME = "bamboozle-audio-assets"`
- `ALLOWED_ORIGINS`: Netlify production, deploy-preview pattern, localhost, Capacitor
- `HOST_GRACE_MS`, `PLAYER_KICK_MS`, `EMPTY_ROOM_MS` (default 60000; e2e overrides to 8000)

## Netlify

Production, branch deploys, deploy previews and local builds all use the Worker URL:

```bash
npx netlify env:set VITE_SERVER_URL https://bamboozle-rooms.gabathanasiou.workers.dev \
  --context production branch-deploy deploy-preview dev
npm run build
npx netlify deploy --prod --dir=dist --no-build
```

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
