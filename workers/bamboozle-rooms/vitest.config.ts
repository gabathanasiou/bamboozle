import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Worker tests run inside workerd with real Durable Object SQLite storage.
// Root Vitest excludes this folder; run with `npm test` in this directory.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          AUTH_MODE: 'none',
          GCS_BUCKET_NAME: 'bamboozle-audio-assets',
          HOST_GRACE_MS: '60000',
          PLAYER_KICK_MS: '60000',
          EMPTY_ROOM_MS: '60000',
          TTS_DAILY_CHARS: '100',
          TTS_IP_DAILY_CHARS: '60',
          TTS_DAILY_REQUESTS: '3',
          TTS_IP_DAILY_REQUESTS: '2',
          MAX_PLAYERS_PER_ROOM: '2',
          MAX_AUDIENCE_PER_ROOM: '2',
          MAX_STATE_BYTES: '1000',
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
