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
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
