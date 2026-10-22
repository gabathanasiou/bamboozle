import { defineConfig } from '@playwright/test';
import { availableParallelism } from 'node:os';

// Set PLAYWRIGHT_PORT to choose the port. Every run OWNS its server
// (`reuseExistingServer: false`) so a foreign process fails fast instead of
// being silently tested. Specs navigate via baseURL (`page.goto('/')`), never a
// hardcoded host:port.
const PORT = Number(process.env.PLAYWRIGHT_PORT) || 4173;
const SERVER_URL = 'http://127.0.0.1:8787';
const devCmd = `npm run dev -- --port=${PORT} --strictPort`;
const previewCmd = `npm run build && npm run preview -- --port=${PORT} --strictPort`;
// E2E uses shorter reconnect windows so grace/kick behaviour is testable
// without a 60s wait. Production keeps 60s.
const workerCmd = 'npm --prefix workers/bamboozle-rooms run dev:e2e';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: true,
  // Retry once locally (twice on CI) so a transient flake doesn't read as a
  // regression. The first retry records a trace. Chronic flakers are tagged
  // @quarantine (excluded below) rather than retried forever — docs/TESTING.md.
  retries: process.env.CI ? 2 : 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    // Motion off removes animation races; a spec about animation opts back in.
    contextOptions: { reducedMotion: 'reduce' },
    // Never make noise on the developer's machine: Chromium's speech API is
    // disabled (the app treats it as unavailable) and all output is muted.
    launchOptions: { args: ['--disable-speech-api', '--mute-audio'] },
  },
  workers: process.env.PLAYWRIGHT_WORKERS
    ? Number(process.env.PLAYWRIGHT_WORKERS)
    : Math.min(5, availableParallelism()),
  reporter: [['list']],
  // Production preview by default (faster boots); PLAYWRIGHT_DEV=1 uses dev.
  webServer: [
    process.env.PLAYWRIGHT_DEV
      ? {
          command: devCmd,
          url: `http://localhost:${PORT}`,
          reuseExistingServer: false,
          timeout: 120000,
          env: { PORT: String(PORT), VITE_SERVER_URL: SERVER_URL },
        }
      : {
          command: previewCmd,
          url: `http://localhost:${PORT}`,
          reuseExistingServer: false,
          timeout: 180000,
          env: { PORT: String(PORT), VITE_SERVER_URL: SERVER_URL },
        },
    {
      command: workerCmd,
      url: `${SERVER_URL}/health`,
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
  // @perf / @quarantine are outside the default suite; run explicitly by grep.
  grepInvert: /@perf|@quarantine/,
});
