# Bamboozle Deployment Guide

Status: phase 1 — Cloudflare Worker is live for preview; Railway remains the production rollback until the rollout in `docs/CLOUDFLARE_MIGRATION_PLAN.md` §13.

## Deployed pieces

| Piece | Where | Notes |
|---|---|---|
| Frontend | Netlify (`bamboozlegame`) | `VITE_SERVER_URL` baked at build time |
| Realtime + TTS | Cloudflare Worker `bamboozle-rooms` | Workers Free + Durable Objects (SQLite) |
| Audio cache | `gs://bamboozle-audio-assets` | 3,159 existing MP3s; do not change the MD5 key |
| Rollback | Railway `server/` | Keep until production cutover |

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

Set the **deploy-preview** context (production stays on Railway for now):

```bash
npx netlify env:set VITE_SERVER_URL https://bamboozle-rooms.gabathanasiou.workers.dev --context deploy-preview
npm run build                           # with VITE_SERVER_URL set
npx netlify deploy --dir=dist --no-build # draft preview URL
```

`netlify deploy --build` may rebuild without your shell env; either export
`VITE_SERVER_URL` for the build or set it in the Netlify UI. The preview origin
(`https://<deploy-id>--bamboozlegame.netlify.app`) is already allowed by the
Worker's `ALLOWED_ORIGINS` pattern.

CORS/WS origins are never `*` in production. Add a custom domain to
`ALLOWED_ORIGINS` before pointing DNS at it.

## Google Cloud

1. Keep the existing public bucket `bamboozle-audio-assets`.
2. The service account needs **Storage Object Admin** and **Cloud Text-to-Speech API User**.
3. Never commit `google-credentials.json`; production uses `wrangler secret`.
4. GCS object names stay `md5(text + "-" + language).mp3`. Changing the hash orphans
   the existing 3,159 lines and re-bills every phrase.

## Rollout / rollback

1. Preview (done): Worker deployed alongside Railway, Netlify deploy-preview points at it.
2. Run the manual checklist in `docs/CLOUDFLARE_MIGRATION_PLAN.md` §12.
3. Switch production `VITE_SERVER_URL` to the Worker; monitor `wrangler tail` + analytics for 48h.
4. After a stable week, retire the Railway service and archive `server/` (do not delete history).
5. Rollback at any time before step 4: set `VITE_SERVER_URL` back to the Railway URL and redeploy Netlify.

## Verification

```bash
curl https://bamboozle-rooms.gabathanasiou.workers.dev/health
cd workers/bamboozle-rooms
SMOKE_URL=https://bamboozle-rooms.gabathanasiou.workers.dev npm run smoke
npx wrangler tail
```

Healthy signs: `[TTS] CACHE HIT`, `[Room] close <CODE> reason=...`, no `INTERNAL_ERROR`
or `TTS_CREDENTIALS_INVALID_JSON` in the tail.
