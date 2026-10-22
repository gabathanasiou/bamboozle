import type { Env as WorkerEnv } from '../src/env';

// The new Workers Vitest plugin types `env` as `Cloudflare.Env`. Wrangler
// normally generates this from wrangler.toml; we declare it from our Env.
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}

export {};
